/**
 * Pixel Events API Endpoint
 * 
 * Receives tracking events from the Web Pixel extension and forwards them to
 * platform CAPI (Meta, TikTok, Google GA4 Measurement Protocol).
 * 
 * This approach is more stable than injecting third-party scripts in the
 * Web Pixel sandbox, as it uses native fetch() and server-side APIs.
 * 
 * Security (P1-1):
 * - Requests can be signed with HMAC-SHA256 to prevent forgery
 * - Signature is verified using shop's ingestion secret
 * - Unsigned requests are still accepted but may be rate-limited more aggressively
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac, timingSafeEqual } from "crypto";
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

// Signature verification time window (5 minutes)
const SIGNATURE_TIME_WINDOW_MS = 5 * 60 * 1000;

/**
 * P1-1: Verify HMAC-SHA256 signature from the Web Pixel
 * Returns true if signature is valid or if no signature is required
 */
function verifySignature(
  secret: string | null,
  timestamp: string | null,
  body: string,
  signature: string | null
): { valid: boolean; error?: string } {
  // If shop has no ingestion secret configured, accept unsigned requests
  // This allows gradual rollout and backwards compatibility
  if (!secret) {
    return { valid: true };
  }
  
  // If secret is configured but request is unsigned, reject
  if (!signature || !timestamp) {
    return { valid: false, error: "Missing signature or timestamp" };
  }
  
  // Verify timestamp is within acceptable window (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, error: "Invalid timestamp" };
  }
  
  const now = Date.now();
  if (Math.abs(now - requestTime) > SIGNATURE_TIME_WINDOW_MS) {
    return { valid: false, error: "Request timestamp out of range" };
  }
  
  // Compute expected signature: HMAC-SHA256(secret, timestamp + body)
  const message = `${timestamp}${body}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Invalid signature" };
    }
    
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { valid: false, error: "Invalid signature" };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid signature format" };
  }
}

/**
 * Generate CORS headers for cross-origin requests from Web Pixel sandbox
 * The Web Pixel runs in a strict sandbox and needs CORS to communicate with our API
 */
function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  return {
    // Echo back the origin or use * if no origin (for direct requests)
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp",
    "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
    // Add Vary header when echoing origin to ensure proper caching
    ...(origin ? { "Vary": "Origin" } : {}),
  };
}

/**
 * Helper to create JSON response with CORS headers
 */
function jsonWithCors<T>(data: T, init: ResponseInit & { request: Request }): Response {
  const { request, ...responseInit } = init;
  const corsHeaders = getCorsHeaders(request);
  return json(data, {
    ...responseInit,
    headers: {
      ...corsHeaders,
      ...(responseInit.headers || {}),
    },
  });
}

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
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  // Only accept POST
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }

  // Rate limiting
  const rateLimit = checkRateLimit(request, "pixel-events");
  if (rateLimit.isLimited) {
    // Add CORS headers to rate limit response
    const rateLimitResponse = createRateLimitResponse(rateLimit.retryAfter);
    const corsHeaders = getCorsHeaders(request);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      rateLimitResponse.headers.set(key, value);
    });
    return rateLimitResponse;
  }

  // P1-1: Get signature headers for verification
  const signature = request.headers.get("X-Tracking-Guardian-Signature");
  const timestamp = request.headers.get("X-Tracking-Guardian-Timestamp");

  try {
    // Read raw body for signature verification
    const bodyText = await request.text();
    
    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return jsonWithCors({ error: "Invalid JSON body" }, { status: 400, request });
    }

    // Validate request
    const validation = validateRequest(rawBody);
    if (!validation.valid) {
      return jsonWithCors({ error: validation.error }, { status: 400, request });
    }

    const { payload } = validation;

    // Only process purchase events for now (most critical for CAPI)
    // Other events can be added later
    if (payload.eventName !== "checkout_completed") {
      // Acknowledge receipt but don't process non-purchase events server-side
      return jsonWithCors({ 
        success: true, 
        message: "Event received (client-side only for this event type)" 
      }, { request });
    }

    // Find the shop (include ingestionSecret for signature verification)
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: payload.shopDomain },
      select: {
        id: true,
        shopDomain: true,
        isActive: true,
        ingestionSecret: true, // P1-1: For signature verification
        pixelConfigs: {
          where: { isActive: true, serverSideEnabled: true },
          select: {
            id: true,
            platform: true,
            platformId: true,
            credentialsEncrypted: true,
          },
        },
      },
    });

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }
    
    // P1-1: Verify request signature
    const signatureVerification = verifySignature(
      shop.ingestionSecret,
      timestamp,
      bodyText,
      signature
    );
    
    if (!signatureVerification.valid) {
      // Log invalid signature attempts (without revealing the secret)
      console.warn(`Invalid signature for shop ${shop.shopDomain}: ${signatureVerification.error}`);
      return jsonWithCors(
        { error: "Invalid request signature" },
        { status: 401, request }
      );
    }

    // No pixel configs with server-side enabled
    if (shop.pixelConfigs.length === 0) {
      return jsonWithCors({ 
        success: true, 
        message: "No server-side tracking configured" 
      }, { request });
    }

    // Generate event ID for deduplication
    const orderId = payload.data.orderId!;
    const eventId = payload.eventId || generateEventId(orderId, payload.eventName, payload.timestamp);

    // Build conversion data (P0-5: Default to not using PII unless explicitly enabled)
    const conversionData: ConversionData = {
      orderId,
      orderNumber: payload.data.orderNumber || null,
      value: payload.data.value || 0,
      currency: payload.data.currency || "USD",
      // PII fields are intentionally not passed from pixel events by default
      // Server-side tracking via webhooks handles PII with proper consent
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

    return jsonWithCors({
      success: true,
      eventId,
      results,
    }, { request });
  } catch (error) {
    console.error("Pixel events API error:", error);
    return jsonWithCors(
      { error: "Internal server error" },
      { status: 500, request }
    );
  }
};

// Health check endpoint with CORS support
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Handle CORS preflight for GET requests (though typically not needed for simple GET)
  return jsonWithCors({ status: "ok", endpoint: "pixel-events" }, { request });
};
