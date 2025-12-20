/**
 * Pixel Events API - Ingests checkout_completed events from App Pixel
 * 
 * Security Model (Defense in Depth):
 * ===================================
 * 
 * PRIMARY SECURITY BOUNDARIES:
 * 1. TLS Encryption - All traffic is HTTPS
 * 2. Origin Validation - Only Shopify domains and sandbox "null" origin accepted (403 for others)
 * 3. Rate Limiting - Per-shop and global limits prevent abuse
 * 4. Order Verification - orderId must match ORDERS_PAID webhook before CAPI is sent
 * 
 * SECONDARY FILTERING (ingestion_key):
 * - The ingestion_key is a CORRELATION TOKEN, NOT a security credential
 * - It is visible in browser network traffic (anyone viewing checkout can see it)
 * - Purpose: Filter noise/misconfigured requests, correlate events with shops
 * - Missing/invalid key results in 204 (silent drop) - defense against misconfiguration
 * - NOT the primary defense against forged receipts - that's handled by webhook verification
 * 
 * CONSENT VERIFICATION:
 * - Pixel sends consent state, but this is EVIDENCE, not proof
 * - In strict mode, we require PixelEventReceipt with consent to send marketing CAPI
 * - Receipt existence + consent + webhook order confirmation = trusted conversion
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
// P1-04: Use unified match key generation for consistent deduplication
import { generateEventId, generateMatchKey } from "../utils/crypto";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "../utils/rate-limiter";
import { checkCircuitBreaker } from "../utils/circuit-breaker";
import { getShopForVerification } from "../utils/shop-access";
// P1-2: Import platform consent functions for pre-filtering
import { isMarketingPlatform, isAnalyticsPlatform } from "../utils/platform-consent";
// P1-06: Centralized origin validation
import { 
  isValidShopifyOrigin, 
  isValidDevOrigin, 
  isDevMode,
  validateOrigin,
} from "../utils/origin-validation";

import { logger } from "../utils/logger";

const MAX_BODY_SIZE = 32 * 1024;

// P1-05: Timestamp validation window (±10 minutes)
// Allows for minor clock drift between client and server
const TIMESTAMP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// P0-03: Single rate limit config (no more signed/unsigned distinction)
const RATE_LIMIT_CONFIG = { maxRequests: 50, windowMs: 60 * 1000 };

const CIRCUIT_BREAKER_CONFIG = {
  threshold: 10000,     
  windowMs: 60 * 1000,  
};

// P1-06: Origin validation functions moved to utils/origin-validation.ts
// See that module for documentation on allowed origins and security model

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");

  const baseSecurityHeaders = {
    "X-Content-Type-Options": "nosniff",
  };

  // P1-02: Handle sandboxed iframe (origin === "null") 
  // This is the expected case for Web Pixel sandbox
  if (origin === "null") {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Key, X-Tracking-Guardian-Timestamp",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // P1-02: Missing Origin header is now rejected (no CORS headers)
  // This prevents server-to-server requests without Origin
  if (!origin) {
    return {
      ...baseSecurityHeaders,
      "Vary": "Origin",
    };
  }

  // Valid Shopify origins get full CORS headers with the actual origin
  if (isValidShopifyOrigin(origin)) {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Key, X-Tracking-Guardian-Timestamp",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // Dev mode allows localhost
  if (isDevMode() && isValidDevOrigin(origin)) {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Key, X-Tracking-Guardian-Timestamp",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // P0-03 + P1-01: Reject non-Shopify origins in production
  // Return minimal CORS headers (no Access-Control-Allow-Origin)
  // P1-06: Origin tracking is handled by origin-validation module
  return {
    ...baseSecurityHeaders,
    "Vary": "Origin",
  };
}

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

// P0-02: Only checkout_completed is processed
type PixelEventName = "checkout_completed";

// P1-02: Field length limits for defense-in-depth
const FIELD_LIMITS = {
  orderId: 64,
  orderNumber: 32,
  checkoutToken: 64,
  currency: 8,
  itemId: 64,
  itemName: 200,
};

interface PixelEventPayload {
  eventName: PixelEventName;
  timestamp: number;
  shopDomain: string;
  
  consent?: {
    marketing?: boolean;
    analytics?: boolean;
  };
  
  data: {
    // P0-02: Only checkout_completed data fields
    orderId?: string | null;
    orderNumber?: string;
    value?: number;
    currency?: string;
    tax?: number;
    shipping?: number;
    checkoutToken?: string | null;
    
    items?: Array<{
      id: string;
      name: string;
      price: number;
      quantity: number;
    }>;
  };
}

/**
 * P1-02: Sanitize string fields to prevent PII leakage
 * - Truncate to max length
 * - Remove potential PII patterns (emails, phone numbers)
 */
function sanitizeString(value: string | undefined | null, maxLength: number): string | null {
  if (!value) return null;
  
  let sanitized = String(value).substring(0, maxLength);
  
  // P1-02: Strip potential email patterns from unexpected places
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED]");
  
  // P1-02: Strip potential phone patterns (various formats)
  sanitized = sanitized.replace(/\+?[\d\s\-()]{10,}/g, "[REDACTED]");
  
  return sanitized;
}

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

  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(data.shopDomain as string)) {
    return { valid: false, error: "Invalid shop domain format" };
  }

  if (!data.timestamp || typeof data.timestamp !== "number") {
    return { valid: false, error: "Missing or invalid timestamp" };
  }

  if (data.eventName === "checkout_completed") {
    const eventData = data.data as Record<string, unknown> | undefined;
    if (!eventData?.orderId && !eventData?.checkoutToken) {
      return { valid: false, error: "Missing orderId and checkoutToken for checkout_completed event" };
    }
  }

  return {
    valid: true,
    payload: {
      eventName: data.eventName as PixelEventName,
      
      timestamp: data.timestamp as number,
      shopDomain: data.shopDomain as string,
      
      consent: data.consent as PixelEventPayload["consent"] | undefined,
      data: (data.data as PixelEventPayload["data"]) || {},
    },
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }

  // P1-2: Validate Content-Type header
  const contentType = request.headers.get("Content-Type");
  if (!contentType || !contentType.includes("application/json")) {
    return jsonWithCors(
      { error: "Content-Type must be application/json" },
      { status: 415, request }
    );
  }

  // P0-03 + P1-01 + P1-08: Strict Origin validation with anomaly tracking
  const origin = request.headers.get("Origin");
  if (!isValidShopifyOrigin(origin)) {
    // In dev mode, allow localhost
    if (!(isDevMode() && isValidDevOrigin(origin))) {
      // P1-08: Track anomaly for invalid origins
      const originShopDomain = request.headers.get("x-shopify-shop-domain") || "unknown";
      const anomalyCheck = trackAnomaly(originShopDomain, "invalid_origin");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`[P1-08] Circuit breaker triggered for ${originShopDomain}: ${anomalyCheck.reason}`);
      }
      logger.warn(`[P0-03] Rejected non-Shopify origin: ${origin?.substring(0, 100) || "null"}`);
      return jsonWithCors(
        { error: "Invalid origin" },
        { status: 403, request }
      );
    }
  }

  // P1-05 + P1-08: Validate timestamp header to prevent replay attacks and filter noise
  const timestampHeader = request.headers.get("X-Tracking-Guardian-Timestamp");
  const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
  
  if (timestampHeader) {
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
      // P1-08: Track anomaly for invalid timestamp format
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`[P1-08] Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug("[P1-05] Invalid timestamp format, dropping request");
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      // P1-08: Track anomaly for expired timestamps
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`[P1-08] Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug(`[P1-05] Timestamp outside window: diff=${timeDiff}ms, dropping request`);
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }
  }
  // Note: Missing timestamp is allowed for backwards compatibility
  // New pixel versions always send timestamp

  // P0-03: Single rate limit config (no signed/unsigned distinction)
  // P0-2 FIX: Use async rate limiter to ensure Redis mode actually blocks requests
  const rateLimit = await checkRateLimitAsync(request, "pixel-events", RATE_LIMIT_CONFIG);
  if (rateLimit.isLimited) {
    logger.warn(`[P0-2] Rate limit exceeded for pixel-events`, {
      retryAfter: rateLimit.retryAfter,
      remaining: rateLimit.remaining,
    });
    const rateLimitResponse = createRateLimitResponse(rateLimit.retryAfter);
    const corsHeaders = getCorsHeaders(request);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      rateLimitResponse.headers.set(key, value);
    });
    return rateLimitResponse;
  }

  try {
    
    const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_BODY_SIZE) {
      logger.warn(`[P1-02] Payload too large: ${contentLength} bytes (max ${MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: MAX_BODY_SIZE },
        { status: 413, request }
      );
    }

    const bodyText = await request.text();

    if (bodyText.length > MAX_BODY_SIZE) {
      logger.warn(`[P1-02] Actual payload too large: ${bodyText.length} bytes (max ${MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: MAX_BODY_SIZE },
        { status: 413, request }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return jsonWithCors({ error: "Invalid JSON body" }, { status: 400, request });
    }

    const validation = validateRequest(rawBody);
    if (!validation.valid) {
      return jsonWithCors({ error: validation.error }, { status: 400, request });
    }

    const { payload } = validation;

    const circuitCheck = await checkCircuitBreaker(payload.shopDomain, CIRCUIT_BREAKER_CONFIG);
    if (circuitCheck.blocked) {
      logger.warn(`Circuit breaker blocked request for ${payload.shopDomain}`);
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

    // P0-02: Only checkout_completed events are processed
    // The pixel extension only sends checkout_completed, but we add this check
    // as defense-in-depth in case of misconfiguration or abuse attempts
    if (payload.eventName !== "checkout_completed") {
      // Return 204 No Content - we acknowledge receipt but don't process or log
      // This aligns with our privacy disclosure that we only process conversion events
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    const shop = await getShopForVerification(payload.shopDomain);

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }

    // P0-03 + P1-03: Ingestion key validation
    // PURPOSE: Correlation token for filtering noise/misconfiguration, NOT a security boundary
    // - Valid key: Request is processed and correlated with shop
    // - Invalid/missing key: Silent 204 rejection (no database writes)
    // NOTE: Real security comes from Origin validation + webhook order verification
    const ingestionKey = request.headers.get("X-Tracking-Guardian-Key");
    let keyValidation: { matched: boolean; reason: string; usedPreviousSecret?: boolean };
    
    if (!shop.ingestionSecret) {
      // Shop doesn't have a key configured - unusual, but allow for backwards compatibility
      // New shops will always have a key generated on install
      keyValidation = { matched: false, reason: "shop_no_key_configured" };
      logger.info(`[P0-03] Shop ${shop.shopDomain} has no ingestion key configured - allowing request`);
    } else if (!ingestionKey) {
      // P1-03 + P1-08: Request missing ingestion key when shop has one configured
      // Silent drop to filter misconfigured or stale pixel installations
      // NOTE: This is filtering, not security - forged receipts are blocked by webhook verification
      const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`[P1-08] Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
      }
      logger.warn(`[P1-03] Dropped: Pixel request from ${shop.shopDomain} missing ingestion key`);
      return new Response(null, {
        status: 204, // Silent rejection - don't reveal we're blocking
        headers: getCorsHeaders(request),
      });
    } else {
      // P1-03: Actually verify the ingestion key matches (with grace window support)
      const { verifyWithGraceWindow } = await import("../utils/shop-access");
      const matchResult = verifyWithGraceWindow(shop, (secret) => secret === ingestionKey);
      
      if (matchResult.matched) {
        keyValidation = { 
          matched: true, 
          reason: matchResult.usedPreviousSecret ? "matched_previous_secret" : "matched",
          usedPreviousSecret: matchResult.usedPreviousSecret,
        };
      } else {
        // P1-03 + P1-08: Key provided but doesn't match
        // Likely stale pixel configuration or key rotation issue
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`[P1-08] Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        logger.warn(`[P1-03] Dropped: Ingestion key mismatch for shop ${shop.shopDomain}`);
        return new Response(null, {
          status: 204, // Silent rejection
          headers: getCorsHeaders(request),
        });
      }
    }

    // P0-03: Trust level for this receipt
    // - Origin must be valid Shopify domain/sandbox
    // - Key correlation must match (for diagnostics/filtering)
    // NOTE: This "trust" is for receipt recording, not for CAPI authorization
    // CAPI authorization requires: webhook order confirmation + consent strategy check
    const isTrusted = isValidShopifyOrigin(origin) && keyValidation.matched;

    const rawOrderId = payload.data.orderId;
    const checkoutToken = payload.data.checkoutToken;

    // P1-04: Use unified match key generation for consistent deduplication
    let matchKeyResult;
    try {
      matchKeyResult = generateMatchKey({
        orderId: rawOrderId,
        checkoutToken: checkoutToken,
      });
    } catch (error) {
      // Neither orderId nor checkoutToken available
      return jsonWithCors(
        { error: "Missing orderId and checkoutToken" },
        { status: 400, request }
      );
    }

    const orderId = matchKeyResult.matchKey;
    const usedCheckoutTokenAsFallback = !matchKeyResult.isOrderId;
    
    if (usedCheckoutTokenAsFallback) {
      logger.info(
        `[P1-04] Using checkoutToken as fallback for shop ${shop.shopDomain}. ` +
        `Webhook matching will use checkoutToken index.`
      );
    }

    const eventId = generateEventId(orderId, "purchase", shop.shopDomain);

    const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, "purchase");
    if (alreadyRecorded) {
      return jsonWithCors({
        success: true,
        eventId,
        message: "Client event already recorded",
        clientSideSent: true,
      }, { request });
    }

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

    if (pixelConfigs.length === 0) {
      return jsonWithCors({ 
        success: true, 
        eventId,
        message: "No server-side tracking configured - client event acknowledged" 
      }, { request });
    }

    try {
      // P0-03: Updated to use origin-based trust instead of HMAC signatures
      await prisma.pixelEventReceipt.upsert({
        where: {
          shopId_orderId_eventType: {
            shopId: shop.id,
            orderId,
            eventType: "purchase",
          },
        },
        create: {
          shopId: shop.id,
          orderId,
          eventType: "purchase",
          eventId,
          checkoutToken: checkoutToken || null,
          pixelTimestamp: new Date(payload.timestamp),
          consentState: payload.consent ?? null,
          // P0-03: Trust is now based on Origin validation
          isTrusted: isTrusted,
          // P0-03: signatureStatus now reflects key validation (for diagnostics)
          signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        },
        update: {
          eventId,
          checkoutToken: checkoutToken || undefined,
          pixelTimestamp: new Date(payload.timestamp),
          consentState: payload.consent ?? null,
          isTrusted: isTrusted,
          signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        },
      });
    } catch (error) {
      logger.warn(`Failed to write PixelEventReceipt for order ${orderId}:`, error);
    }

    const recordedPlatforms: string[] = [];
    const skippedPlatforms: string[] = [];
    
    // P1-2: Pre-filter platforms based on consent before writing ConversionLog
    // This ensures we don't create marketing platform records when only analytics is consented
    const consent = payload.consent;
    const hasMarketingConsent = consent?.marketing === true;
    const hasAnalyticsConsent = consent?.analytics === true;
    
    for (const config of pixelConfigs) {
      // P1-2: Consent-based pre-filtering
      // Marketing platforms (Meta, TikTok, etc.) require marketing consent
      // Analytics platforms (Google GA4) require analytics consent
      if (isMarketingPlatform(config.platform) && !hasMarketingConsent) {
        logger.debug(
          `[P1-2] Skipping ${config.platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consent?.marketing})`
        );
        skippedPlatforms.push(config.platform);
        continue;
      }
      
      if (isAnalyticsPlatform(config.platform) && !hasAnalyticsConsent) {
        logger.debug(
          `[P1-2] Skipping ${config.platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consent?.analytics})`
        );
        skippedPlatforms.push(config.platform);
        continue;
      }
      
      try {
        await prisma.conversionLog.upsert({
          where: {
            shopId_orderId_platform_eventType: {
              shopId: shop.id,
              orderId: orderId,
              platform: config.platform,
              eventType: "purchase",
            },
          },
          update: {
            clientSideSent: true,
            eventId,
          },
          create: {
            shopId: shop.id,
            orderId: orderId,
            orderNumber: payload.data.orderNumber || null,
            orderValue: payload.data.value || 0,
            currency: payload.data.currency || "USD",
            platform: config.platform,
            eventType: "purchase",
            eventId,
            status: "pending",
            attempts: 0,
            clientSideSent: true,  
            serverSideSent: false,
          },
        });
        recordedPlatforms.push(config.platform);
      } catch (error) {
        logger.warn(`Failed to record client event for ${config.platform}:`, error);
      }
    }
    
    if (skippedPlatforms.length > 0) {
      logger.info(
        `[P1-2] Consent-filtered platforms for order ${orderId}: ` +
        `skipped=${skippedPlatforms.join(",")}, recorded=${recordedPlatforms.join(",")}`
      );
    }

    return jsonWithCors({
      success: true,
      eventId,
      message: "Pixel event recorded, CAPI will be sent via webhook",
      clientSideSent: true,
      platforms: recordedPlatforms,
      // P1-2: Include skipped platforms for transparency
      skippedPlatforms: skippedPlatforms.length > 0 ? skippedPlatforms : undefined,
      trusted: isTrusted,
      consent: payload.consent || null,
    }, { request });
  } catch (error) {
    logger.error("Pixel events API error:", error);
    return jsonWithCors(
      { error: "Internal server error" },
      { status: 500, request }
    );
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  
  return jsonWithCors({ status: "ok", endpoint: "pixel-events" }, { request });
};
