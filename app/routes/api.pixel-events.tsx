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
 * Security:
 * P0-1: Signature Strategy (Hybrid Approach)
 * - Signed requests: Full trust, normal rate limits
 * - Unsigned requests: Accepted with strict rate limiting and reduced trust
 * - This ensures pixel events work even if signing fails in sandbox
 * 
 * P0-2: CORS Policy
 * - Allows null/missing Origin (common in strict sandbox)
 * - Returns * for null Origin to prevent CORS blocking
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { generateEventId, normalizeOrderId } from "../utils/crypto";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";
import { checkCircuitBreaker } from "../utils/circuit-breaker";

// Signature verification time window (5 minutes)
const SIGNATURE_TIME_WINDOW_MS = 5 * 60 * 1000;

// P0-1: Rate limit configs for signed vs unsigned requests
const SIGNED_RATE_LIMIT = { maxRequests: 100, windowMs: 60 * 1000 }; // 100/min
const UNSIGNED_RATE_LIMIT = { maxRequests: 20, windowMs: 60 * 1000 }; // 20/min (stricter)

// P0-3: Circuit breaker configuration
// Now uses shared storage (Redis when REDIS_URL is set, otherwise in-memory)
const CIRCUIT_BREAKER_CONFIG = {
  threshold: 10000,     // 10k requests per minute
  windowMs: 60 * 1000,  // 1 minute window
};

/**
 * P0-1: Signature verification result type
 * - signed: Request has valid signature (full trust)
 * - unsigned: Request has no signature (allowed only when secret not configured or dev mode)
 * - unsigned_rejected: Request has no signature but shop has secret configured (REJECT in production)
 * - invalid: Request has invalid signature (reject)
 */
type SignatureResult = 
  | { status: "signed"; trusted: true }
  | { status: "unsigned"; trusted: false; reason: string }
  | { status: "unsigned_rejected"; trusted: false; error: string }
  | { status: "invalid"; trusted: false; error: string };

/**
 * Check if we're in development/test mode
 * In dev mode, we allow unsigned requests even if secret is configured
 */
function isDevMode(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true"
  );
}

/**
 * P0-1: Verify HMAC-SHA256 signature from the Web Pixel
 * 
 * SECURITY UPDATE (P0-2):
 * - If shop has ingestionSecret configured, signature is REQUIRED in production
 * - Unsigned requests are only allowed when:
 *   1. Shop has no ingestionSecret configured (new/unconfigured shop)
 *   2. Running in development/test mode
 *   3. ALLOW_UNSIGNED_PIXEL_EVENTS=true (for specific testing scenarios)
 * 
 * This prevents attackers from spoofing shopDomain to pollute conversion logs.
 */
function verifySignature(
  secret: string | null,
  timestamp: string | null,
  body: string,
  signature: string | null,
  isExplicitlyUnsigned: boolean
): SignatureResult {
  // If shop has no secret configured, accept as unsigned
  // This allows new shops to work before they configure the pixel
  if (!secret) {
    return { 
      status: "unsigned", 
      trusted: false, 
      reason: "Shop ingestion secret not configured" 
    };
  }
  
  // P0-2: Shop has secret configured - signature is required in production
  // If request is explicitly unsigned or has no signature headers, check environment
  if (isExplicitlyUnsigned || (!signature && !timestamp)) {
    if (isDevMode()) {
      // Allow in dev mode for testing
      console.info(
        `[DEV MODE] Allowing unsigned request despite shop having ingestionSecret configured`
      );
      return { 
        status: "unsigned", 
        trusted: false, 
        reason: "Unsigned request allowed in development mode" 
      };
    }
    
    // PRODUCTION: Reject unsigned requests when shop has secret configured
    // This is the key security fix - prevents shopDomain spoofing
    return { 
      status: "unsigned_rejected", 
      trusted: false, 
      error: "Signature required. Shop has ingestionSecret configured but request was unsigned." 
    };
  }
  
  // If only one of signature/timestamp is present, that's suspicious
  if (!signature || !timestamp) {
    return { 
      status: "invalid", 
      trusted: false, 
      error: "Incomplete signature headers (one of signature/timestamp missing)" 
    };
  }
  
  // Verify timestamp is within acceptable window (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { status: "invalid", trusted: false, error: "Invalid timestamp format" };
  }
  
  const now = Date.now();
  if (Math.abs(now - requestTime) > SIGNATURE_TIME_WINDOW_MS) {
    return { 
      status: "invalid", 
      trusted: false, 
      error: "Request timestamp out of range (possible replay attack)" 
    };
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
      return { status: "invalid", trusted: false, error: "Invalid signature" };
    }
    
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { status: "invalid", trusted: false, error: "Invalid signature" };
    }
    
    return { status: "signed", trusted: true };
  } catch {
    return { status: "invalid", trusted: false, error: "Invalid signature format" };
  }
}

/**
 * P0-2: Generate CORS headers for cross-origin requests from Web Pixel sandbox
 * 
 * CRITICAL: Strict sandbox may send requests with:
 * - Origin: null (opaque origin in sandboxed iframe)
 * - No Origin header at all (worker context)
 * 
 * We MUST handle these cases or requests will be CORS-blocked.
 * 
 * Security notes:
 * - CORS is browser-enforced; server-side requests bypass it
 * - Signature verification (P0-1) provides actual security
 * - CORS is mainly to enable legitimate browser requests
 */
function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");
  
  // P0-2: Handle null/missing Origin (common in strict sandbox)
  // 
  // Cases where Origin may be null or missing:
  // 1. Strict sandbox iframe (Origin: null)
  // 2. Worker context (no Origin header)
  // 3. Redirect scenarios
  // 4. Privacy-focused browsers
  //
  // For these cases, we return * to allow the request.
  // This is safe because:
  // - We don't use credentials (no cookies)
  // - Signature verification provides actual authentication
  // - Rate limiting provides abuse protection
  
  if (!origin || origin === "null") {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp, X-Tracking-Guardian-Unsigned",
      "Access-Control-Max-Age": "86400",
    };
  }
  
  // Check if origin is a valid Shopify domain
  const isValidShopifyOrigin = (
    /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(origin) ||
    /^https:\/\/checkout\.[a-zA-Z0-9][a-zA-Z0-9\-]*\.com$/.test(origin) ||
    origin === "https://shopify.com" ||
    /^https:\/\/[a-zA-Z0-9\-]+\.shopify\.com$/.test(origin)
  );
  
  // For valid Shopify origins, echo back the origin
  // For other origins, still use * to not break legitimate requests
  // (signature verification is the real security layer)
  const allowOrigin = isValidShopifyOrigin ? origin : "*";
  
  // Log unexpected origins for monitoring
  if (!isValidShopifyOrigin) {
    console.warn(`Non-Shopify origin in pixel request: ${origin}`);
  }
  
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp, X-Tracking-Guardian-Unsigned",
    "Access-Control-Max-Age": "86400",
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
  // P0-5: eventId is now generated server-side, not sent from pixel
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
    // For checkout_started / payment_info_submitted
    checkoutToken?: string;
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
    // For page_viewed
    pageTitle?: string;
    pageUrl?: string;
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
      // P0-5: eventId removed - server generates it
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

  // P0-1: Get signature headers to determine rate limit config
  const signature = request.headers.get("X-Tracking-Guardian-Signature");
  const timestamp = request.headers.get("X-Tracking-Guardian-Timestamp");
  const isExplicitlyUnsigned = request.headers.get("X-Tracking-Guardian-Unsigned") === "true";
  
  // P0-1: Apply appropriate rate limit based on signature presence
  // Unsigned requests get stricter limits to prevent abuse
  const hasSignatureHeaders = !!(signature && timestamp);
  const rateLimitConfig = hasSignatureHeaders ? SIGNED_RATE_LIMIT : UNSIGNED_RATE_LIMIT;
  
  const rateLimit = checkRateLimit(request, "pixel-events", rateLimitConfig);
  if (rateLimit.isLimited) {
    // Add CORS headers to rate limit response
    const rateLimitResponse = createRateLimitResponse(rateLimit.retryAfter);
    const corsHeaders = getCorsHeaders(request);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      rateLimitResponse.headers.set(key, value);
    });
    return rateLimitResponse;
  }

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

    // P0-3: Check circuit breaker BEFORE database queries
    // Now uses shared storage (Redis when available) for multi-instance deployments
    const circuitCheck = await checkCircuitBreaker(payload.shopDomain, CIRCUIT_BREAKER_CONFIG);
    if (circuitCheck.blocked) {
      console.warn(`Circuit breaker blocked request for ${payload.shopDomain}`);
      return jsonWithCors(
        { 
          error: circuitCheck.reason,
          retryAfter: circuitCheck.retryAfter,
        },
        { 
          status: 429, 
          request,
          headers: circuitCheck.retryAfter 
            ? { "Retry-After": String(circuitCheck.retryAfter) }
            : undefined,
        }
      );
    }

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
        ingestionSecret: true,
      },
    });

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }
    
    // P0-1 & P0-2: Verify request signature
    const signatureResult = verifySignature(
      shop.ingestionSecret,
      timestamp,
      bodyText,
      signature,
      isExplicitlyUnsigned
    );
    
    // Reject requests with INVALID signatures (spoofing attempt)
    if (signatureResult.status === "invalid") {
      console.warn(
        `Invalid signature for shop ${shop.shopDomain}: ${signatureResult.error}`,
        { hasSignature: !!signature, hasTimestamp: !!timestamp }
      );
      return jsonWithCors(
        { error: "Invalid request signature" },
        { status: 401, request }
      );
    }
    
    // P0-2: Reject unsigned requests when shop has ingestionSecret configured (production)
    // This prevents shopDomain spoofing attacks
    if (signatureResult.status === "unsigned_rejected") {
      console.warn(
        `Unsigned request rejected for shop ${shop.shopDomain}: ${signatureResult.error}`,
        { shopHasSecret: !!shop.ingestionSecret }
      );
      return jsonWithCors(
        { 
          error: "Signature required",
          message: "This shop requires signed requests. Please ensure your Web Pixel is configured with the correct ingestion secret.",
          code: "SIGNATURE_REQUIRED"
        },
        { status: 401, request }
      );
    }
    
    // Log unsigned requests for monitoring (allowed in dev mode or when no secret configured)
    if (signatureResult.status === "unsigned") {
      console.info(
        `Unsigned pixel request from ${shop.shopDomain}: ${signatureResult.reason}`
      );
    }
    
    // Track trust level for the response
    const isTrusted = signatureResult.trusted;

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
      // P0-1: Include trust status for debugging
      trusted: isTrusted,
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
