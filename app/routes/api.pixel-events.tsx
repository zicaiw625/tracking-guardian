/**
 * Pixel Events API Endpoint
 * 
 * Receives tracking events from the Web Pixel extension and records them
 * for deduplication with webhook-based server-side tracking.
 * 
 * IMPORTANT ARCHITECTURE DECISION:
 * - This endpoint does NOT directly send events to platform CAPI
 * - It only records that a client-side event was fired (clientSideSent = true)
 * - Actual CAPI sending is done by the ORDERS_PAID webhook handler
 * - This prevents duplicate conversions and ensures consistent dedup
 * 
 * Why this design?
 * 1. Webhooks are more reliable (not affected by ad blockers, browser issues)
 * 2. Webhooks have access to complete order data including PII (when enabled)
 * 3. Single source of truth for CAPI sends prevents double-counting
 * 4. Pixel events still useful for marking client-side tracking status
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
import { generateEventId, normalizeOrderId } from "../utils/crypto";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";

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
  // P1-1: SECURITY - Require ingestion secret for all requests
  // Unsigned requests are rejected to prevent unauthorized event submission
  // Shop's ingestion secret is generated on installation and can be rotated
  if (!secret) {
    return { 
      valid: false, 
      error: "Shop ingestion secret not configured. Please reinstall the app or contact support." 
    };
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
 * P1-2: Generate CORS headers for cross-origin requests from Web Pixel sandbox
 * 
 * SECURITY: We validate the origin to only allow Shopify domains.
 * The Web Pixel runs in a Shopify-controlled sandbox, so we can trust
 * requests from *.myshopify.com domains.
 * 
 * Note: CORS is a browser-enforced policy. Server-side requests (like bots)
 * can bypass it, so we also require signature verification (P1-1).
 */
function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  
  // P1-2: Only allow Shopify domains
  // Valid patterns: *.myshopify.com, *.shopify.com (for checkout pages)
  const isValidOrigin = origin && (
    /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(origin) ||
    /^https:\/\/checkout\.[a-zA-Z0-9][a-zA-Z0-9\-]*\.com$/.test(origin) ||
    origin === "https://shopify.com" ||
    /^https:\/\/[a-zA-Z0-9\-]+\.shopify\.com$/.test(origin)
  );
  
  // Log unexpected origins for monitoring (but don't block - signature handles security)
  if (origin && !isValidOrigin) {
    console.warn(`Unexpected origin in pixel request: ${origin}`);
  }
  
  return {
    // Only echo back valid origins, otherwise use restrictive policy
    "Access-Control-Allow-Origin": isValidOrigin ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp",
    "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
    // Add Vary header to ensure proper caching per origin
    "Vary": "Origin",
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
 * Check if this order has already been recorded from pixel (deduplication)
 */
async function isClientEventRecorded(
  shopId: string,
  orderId: string,
  eventType: string
): Promise<boolean> {
  const existing = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      eventType,
      clientSideSent: true,
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

    // ==========================================
    // RECORD CLIENT-SIDE EVENT (NO CAPI SENDING)
    // ==========================================
    // 
    // IMPORTANT: This endpoint does NOT send events to platform CAPI directly.
    // It only records that a client-side pixel event was fired.
    // 
    // Why?
    // 1. ORDERS_PAID webhook is more reliable for CAPI (has full order data)
    // 2. Single source of truth prevents duplicate conversions
    // 3. Webhook can check clientSideSent to know if pixel fired
    // 4. Unified eventId ensures platform-level deduplication works

    // Extract and normalize the order ID
    const rawOrderId = payload.data.orderId!;
    const orderId = normalizeOrderId(rawOrderId);
    
    // Generate deterministic eventId for platform deduplication
    // This same eventId will be used by the webhook when sending CAPI
    const eventId = generateEventId(orderId, "purchase", shop.shopDomain);
    
    // Check if we already recorded this client event
    const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, "purchase");
    if (alreadyRecorded) {
      return jsonWithCors({
        success: true,
        eventId,
        message: "Client event already recorded",
        clientSideSent: true,
      }, { request });
    }

    // Get active pixel configs to know which platforms to track
    const pixelConfigs = await prisma.pixelConfig.findMany({
      where: {
        shopId: shop.id,
        isActive: true,
        serverSideEnabled: true,
      },
      select: {
        platform: true,
      },
    });

    // If no platforms configured, just acknowledge receipt
    if (pixelConfigs.length === 0) {
      return jsonWithCors({ 
        success: true, 
        eventId,
        message: "No server-side tracking configured - client event acknowledged" 
      }, { request });
    }

    // Record client-side event for each configured platform
    // The actual CAPI sending will be done by the ORDERS_PAID webhook
    const recordedPlatforms: string[] = [];
    
    for (const config of pixelConfigs) {
      try {
        await prisma.conversionLog.upsert({
          where: {
            shopId_orderId_platform_eventType: {
              shopId: shop.id,
              orderId: orderId,  // Use real orderId (not eventId!)
              platform: config.platform,
              eventType: "purchase",
            },
          },
          update: {
            // If webhook already created the record, just mark client side as sent
            clientSideSent: true,
            eventId: eventId,  // Store the dedup eventId
          },
          create: {
            shopId: shop.id,
            orderId: orderId,
            eventId: eventId,  // Store the dedup eventId for CAPI
            orderNumber: payload.data.orderNumber || null,
            orderValue: payload.data.value || 0,
            currency: payload.data.currency || "USD",
            platform: config.platform,
            eventType: "purchase",
            status: "pending",  // Will be updated to "sent" by webhook
            attempts: 0,
            clientSideSent: true,  // Mark that pixel fired
            serverSideSent: false, // Not yet sent by webhook
          },
        });
        recordedPlatforms.push(config.platform);
      } catch (error) {
        console.warn(`Failed to record client event for ${config.platform}:`, error);
      }
    }

    return jsonWithCors({
      success: true,
      eventId,
      message: "Client event recorded, CAPI will be sent via webhook",
      clientSideSent: true,
      platforms: recordedPlatforms,
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
