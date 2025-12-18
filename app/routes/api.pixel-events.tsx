/**
 * Pixel Events API Endpoint
 * 
 * Receives tracking events from the Web Pixel extension and forwards them to
 * platform CAPI (Meta, TikTok, Google GA4 Measurement Protocol).
 * 
 * This approach is more stable than injecting third-party scripts in the
 * Web Pixel sandbox, as it uses native fetch() and server-side APIs.
 */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { sendConversionToGoogle } from "../services/platforms/google.server";
import { sendConversionToMeta } from "../services/platforms/meta.server";
import { sendConversionToTikTok } from "../services/platforms/tiktok.server";
import { decryptJson } from "../utils/crypto";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import type {
  ConversionData,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
} from "../types";

// Event types we handle
type PixelEventName = 
  | "page_viewed"
  | "product_viewed"
  | "product_added_to_cart"
  | "checkout_started"
  | "payment_info_submitted"
  | "checkout_completed";

interface PixelEventPayload {
  eventName: PixelEventName;
  eventId: string;
  timestamp: number;
  shopDomain: string;
  // Event-specific data
  data: {
    // For checkout_completed
    orderId?: string;
    orderNumber?: string;
    value?: number;
    currency?: string;
    tax?: number;
    shipping?: number;
    // Customer data (hashed on client for privacy)
    email?: string;
    phone?: string;
    // Line items
    items?: Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
    }>;
    // For product events
    productId?: string;
    productName?: string;
    productPrice?: number;
  };
}

/**
 * Generate a deduplication event ID
 * Format: {orderId}_{eventName}_{5min_bucket}
 */
function generateEventId(orderId: string, eventName: string, timestamp: number): string {
  // 5-minute time bucket (300000ms)
  const timeBucket = Math.floor(timestamp / 300000);
  return `${orderId}_${eventName}_${timeBucket}`;
}

/**
 * Check if this event has already been processed (deduplication)
 */
async function isEventProcessed(
  shopId: string,
  eventId: string,
  platform: string
): Promise<boolean> {
  const existing = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId: eventId, // We store eventId in orderId for dedup
      platform,
      status: "sent",
    },
    select: { id: true },
  });
  return !!existing;
}

/**
 * Validate the incoming request
 */
function validateRequest(body: unknown): { valid: true; payload: PixelEventPayload } | { valid: false; error: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body" };
  }

  const data = body as Record<string, unknown>;

  if (!data.eventName || typeof data.eventName !== "string") {
    return { valid: false, error: "Missing eventName" };
  }

  if (!data.shopDomain || typeof data.shopDomain !== "string") {
    return { valid: false, error: "Missing shopDomain" };
  }

  // Validate shop domain format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(data.shopDomain as string)) {
    return { valid: false, error: "Invalid shop domain format" };
  }

  if (!data.timestamp || typeof data.timestamp !== "number") {
    return { valid: false, error: "Missing or invalid timestamp" };
  }

  // For purchase events, orderId is required
  if (data.eventName === "checkout_completed") {
    const eventData = data.data as Record<string, unknown> | undefined;
    if (!eventData?.orderId) {
      return { valid: false, error: "Missing orderId for checkout_completed event" };
    }
  }

  return {
    valid: true,
    payload: {
      eventName: data.eventName as PixelEventName,
      eventId: (data.eventId as string) || "",
      timestamp: data.timestamp as number,
      shopDomain: data.shopDomain as string,
      data: (data.data as PixelEventPayload["data"]) || {},
    },
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Rate limiting
  const rateLimit = checkRateLimit(request, "pixel-events");
  if (rateLimit.isLimited) {
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  // Only accept POST
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Validate request
    const validation = validateRequest(rawBody);
    if (!validation.valid) {
      return json({ error: validation.error }, { status: 400 });
    }

    const { payload } = validation;

    // Only process purchase events for now (most critical for CAPI)
    // Other events can be added later
    if (payload.eventName !== "checkout_completed") {
      // Acknowledge receipt but don't process non-purchase events server-side
      return json({ 
        success: true, 
        message: "Event received (client-side only for this event type)" 
      });
    }

    // Find the shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: payload.shopDomain },
      include: {
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
        },
      },
    });

    if (!shop || !shop.isActive) {
      return json({ error: "Shop not found or inactive" }, { status: 404 });
    }

    // No pixel configs with server-side enabled
    if (shop.pixelConfigs.length === 0) {
      return json({ 
        success: true, 
        message: "No server-side tracking configured" 
      });
    }

    // Generate event ID for deduplication
    const orderId = payload.data.orderId!;
    const eventId = payload.eventId || generateEventId(orderId, payload.eventName, payload.timestamp);

    // Build conversion data
    const conversionData: ConversionData = {
      orderId,
      orderNumber: payload.data.orderNumber || null,
      value: payload.data.value || 0,
      currency: payload.data.currency || "USD",
      email: payload.data.email,
      phone: payload.data.phone,
      lineItems: payload.data.items?.map((item) => ({
        productId: item.id,
        variantId: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    const results: Array<{ platform: string; success: boolean; error?: string }> = [];

    // Process each configured platform
    for (const pixelConfig of shop.pixelConfigs) {
      // Check deduplication
      const alreadyProcessed = await isEventProcessed(shop.id, eventId, pixelConfig.platform);
      if (alreadyProcessed) {
        results.push({ 
          platform: pixelConfig.platform, 
          success: true, 
          error: "Duplicate event (already processed)" 
        });
        continue;
      }

      // Get credentials
      if (!pixelConfig.credentialsEncrypted) {
        results.push({ 
          platform: pixelConfig.platform, 
          success: false, 
          error: "No credentials configured" 
        });
        continue;
      }

      let credentials: PlatformCredentials | null = null;
      try {
        credentials = decryptJson<PlatformCredentials>(pixelConfig.credentialsEncrypted);
      } catch {
        results.push({ 
          platform: pixelConfig.platform, 
          success: false, 
          error: "Failed to decrypt credentials" 
        });
        continue;
      }

      // Create conversion log for tracking
      const conversionLog = await prisma.conversionLog.upsert({
        where: {
          shopId_orderId_platform_eventType: {
            shopId: shop.id,
            orderId: eventId,
            platform: pixelConfig.platform,
            eventType: "purchase",
          },
        },
        update: {
          status: "pending",
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
        create: {
          shopId: shop.id,
          orderId: eventId,
          orderNumber: conversionData.orderNumber,
          orderValue: conversionData.value,
          currency: conversionData.currency,
          platform: pixelConfig.platform,
          eventType: "purchase",
          status: "pending",
          attempts: 1,
          lastAttemptAt: new Date(),
          clientSideSent: true, // Came from pixel
        },
      });

      try {
        let result;
        
        switch (pixelConfig.platform) {
          case "google":
            result = await sendConversionToGoogle(
              credentials as GoogleCredentials,
              conversionData
            );
            break;
          case "meta":
            result = await sendConversionToMeta(
              credentials as MetaCredentials,
              conversionData
            );
            break;
          case "tiktok":
            result = await sendConversionToTikTok(
              credentials as TikTokCredentials,
              conversionData
            );
            break;
          default:
            results.push({ 
              platform: pixelConfig.platform, 
              success: false, 
              error: "Unsupported platform" 
            });
            continue;
        }

        // Update log with success
        await prisma.conversionLog.update({
          where: { id: conversionLog.id },
          data: {
            status: "sent",
            serverSideSent: true,
            sentAt: new Date(),
            platformResponse: result,
          },
        });

        results.push({ platform: pixelConfig.platform, success: true });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        // Update log with failure
        await prisma.conversionLog.update({
          where: { id: conversionLog.id },
          data: {
            status: "failed",
            errorMessage,
          },
        });

        results.push({ 
          platform: pixelConfig.platform, 
          success: false, 
          error: errorMessage 
        });
      }
    }

    return json({
      success: true,
      eventId,
      results,
    });
  } catch (error) {
    console.error("Pixel events API error:", error);
    return json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
};

// Health check endpoint
export const loader = async () => {
  return json({ status: "ok", endpoint: "pixel-events" });
};
