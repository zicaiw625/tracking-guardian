

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac, timingSafeEqual } from "crypto";
import prisma from "../db.server";
// P1-04: Use unified match key generation for consistent deduplication
import { generateEventId, normalizeOrderId, generateMatchKey } from "../utils/crypto";
import { checkRateLimit, createRateLimitResponse, SECURITY_HEADERS } from "../utils/rate-limiter";
import { checkCircuitBreaker } from "../utils/circuit-breaker";
import { getShopForVerification, verifyWithGraceWindow } from "../utils/shop-access";

import { logger } from "../utils/logger";

const SIGNATURE_TIME_WINDOW_MS = 5 * 60 * 1000;

const MAX_BODY_SIZE = 32 * 1024;

const SIGNED_RATE_LIMIT = { maxRequests: 100, windowMs: 60 * 1000 }; 
const UNSIGNED_RATE_LIMIT = { maxRequests: 20, windowMs: 60 * 1000 }; 

const CIRCUIT_BREAKER_CONFIG = {
  threshold: 10000,     
  windowMs: 60 * 1000,  
};

type SignatureResult = 
  | { status: "signed"; trusted: true }
  | { status: "unsigned"; trusted: false; reason: string }
  | { status: "unsigned_rejected"; trusted: false; error: string }
  | { status: "invalid"; trusted: false; error: string };

/**
 * P0-04: Check if running in development mode (allows unsigned requests)
 * 
 * SECURITY: In production, ALLOW_UNSIGNED_PIXEL_EVENTS should NEVER be true.
 * The app startup check in entry.server.tsx will crash the app if this is violated,
 * but we add a runtime check here as defense-in-depth.
 */
function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const allowUnsigned = process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true";

  // P0-04: In production, NEVER allow unsigned - startup check should have caught this
  // but we enforce it here too as defense-in-depth
  if (nodeEnv === "production") {
    if (allowUnsigned) {
      // This should never happen if startup checks are working
      // Log as error and treat as NOT dev mode (reject unsigned)
      logger.error(
        "[P0-04 CRITICAL] ALLOW_UNSIGNED_PIXEL_EVENTS=true in production! " +
        "This should have been caught at startup. Treating as secure mode."
      );
    }
    // Production is NEVER dev mode, regardless of ALLOW_UNSIGNED_PIXEL_EVENTS
    return false;
  }
  
  // In development/test, allow unsigned for easier testing
  return nodeEnv === "development" || nodeEnv === "test" || allowUnsigned;
}

/**
 * P0-04: Track shops with missing ingestion secrets for monitoring
 * In production, this is a security concern that should be investigated
 */
const missingSecretWarnings = new Map<string, number>();
const MISSING_SECRET_LOG_INTERVAL_MS = 5 * 60 * 1000; // Log at most once per 5 minutes per shop

function logMissingIngestionSecret(shopDomain: string, shopId: string): void {
  const now = Date.now();
  const lastWarning = missingSecretWarnings.get(shopDomain) || 0;
  
  if (now - lastWarning > MISSING_SECRET_LOG_INTERVAL_MS) {
    logger.warn(
      `[P0-04 SECURITY ALERT] Shop missing ingestionSecret: ${shopDomain} (id: ${shopId}). ` +
      "This shop cannot verify pixel event signatures. " +
      "The afterAuth hook should have set this - investigate why it's missing.",
      { shopDomain, shopId, securityIssue: "missing_ingestion_secret" }
    );
    missingSecretWarnings.set(shopDomain, now);
  }
}

function verifySignature(
  secret: string | null,
  timestamp: string | null,
  body: string,
  signature: string | null,
  isExplicitlyUnsigned: boolean,
  shopContext?: { shopDomain: string; shopId: string }
): SignatureResult {

  if (!secret) {
    // P0-04: Log missing ingestion secret as security alert
    if (shopContext) {
      logMissingIngestionSecret(shopContext.shopDomain, shopContext.shopId);
    }
    return { 
      status: "unsigned", 
      trusted: false, 
      reason: "Shop ingestion secret not configured" 
    };
  }

  if (isExplicitlyUnsigned || (!signature && !timestamp)) {
    if (isDevMode()) {
      
      logger.info(
        `[DEV MODE] Allowing unsigned request despite shop having ingestionSecret configured`
      );
      return { 
        status: "unsigned", 
        trusted: false, 
        reason: "Unsigned request allowed in development mode" 
      };
    }

    return { 
      status: "unsigned_rejected", 
      trusted: false, 
      error: "Signature required. Shop has ingestionSecret configured but request was unsigned." 
    };
  }

  if (!signature || !timestamp) {
    return { 
      status: "invalid", 
      trusted: false, 
      error: "Incomplete signature headers (one of signature/timestamp missing)" 
    };
  }

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

  const message = `${timestamp}${body}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(message)
    .digest("hex");

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
 * P1-05: Non-Shopify origin tracking for monitoring
 * Track unusual origins to detect potential abuse patterns
 */
const nonShopifyOriginCounts = new Map<string, { count: number; firstSeen: number }>();
const NON_SHOPIFY_ORIGIN_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
const NON_SHOPIFY_ORIGIN_ALERT_THRESHOLD = 100; // Alert if >100 requests from non-Shopify origin

function trackNonShopifyOrigin(origin: string): void {
  const now = Date.now();
  const existing = nonShopifyOriginCounts.get(origin);
  
  if (!existing || (now - existing.firstSeen) > NON_SHOPIFY_ORIGIN_WINDOW_MS) {
    nonShopifyOriginCounts.set(origin, { count: 1, firstSeen: now });
  } else {
    existing.count++;
    
    if (existing.count === NON_SHOPIFY_ORIGIN_ALERT_THRESHOLD) {
      logger.warn(`[P1-05] High volume from non-Shopify origin: ${origin}`, {
        count: existing.count,
        windowHours: 1,
        securityAlert: "non_shopify_origin_volume",
      });
    }
  }
}

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin");

  // P1-05: Base security headers included in all CORS responses
  const baseSecurityHeaders = {
    "X-Content-Type-Options": "nosniff",
  };

  // Null origin is expected from Web Pixel sandbox
  if (!origin || origin === "null") {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp, X-Tracking-Guardian-Unsigned",
      "Access-Control-Max-Age": "86400",
    };
  }

  // Validate Shopify origins
  const isValidShopifyOrigin = (
    /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(origin) ||
    /^https:\/\/checkout\.[a-zA-Z0-9][a-zA-Z0-9\-]*\.com$/.test(origin) ||
    origin === "https://shopify.com" ||
    /^https:\/\/[a-zA-Z0-9\-]+\.shopify\.com$/.test(origin)
  );

  // P1-05: For non-Shopify origins, track for monitoring
  // Still allow (for compatibility) but monitor for abuse
  if (!isValidShopifyOrigin) {
    trackNonShopifyOrigin(origin);
    logger.info(`[P1-05] Non-Shopify origin in pixel request`, {
      origin: origin.substring(0, 100), // Truncate for logging
    });
  }

  // P1-05: For valid Shopify origins, reflect the origin (more secure than *)
  const allowOrigin = isValidShopifyOrigin ? origin : "*";
  
  return {
    ...baseSecurityHeaders,
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Tracking-Guardian-Signature, X-Tracking-Guardian-Timestamp, X-Tracking-Guardian-Unsigned",
    "Access-Control-Max-Age": "86400",
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

type PixelEventName = 
  | "page_viewed"
  | "product_viewed"
  | "product_added_to_cart"
  | "checkout_started"
  | "payment_info_submitted"
  | "checkout_completed";

interface PixelEventPayload {
  eventName: PixelEventName;
  
  timestamp: number;
  shopDomain: string;
  
  consent?: {
    marketing?: boolean;
    analytics?: boolean;
  };
  
  data: {
    
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
    
    productId?: string;
    productName?: string;
    productPrice?: number;
    
    pageTitle?: string;
    pageUrl?: string;
  };
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

  const signature = request.headers.get("X-Tracking-Guardian-Signature");
  const timestamp = request.headers.get("X-Tracking-Guardian-Timestamp");
  const isExplicitlyUnsigned = request.headers.get("X-Tracking-Guardian-Unsigned") === "true";

  const hasSignatureHeaders = !!(signature && timestamp);
  const rateLimitConfig = hasSignatureHeaders ? SIGNED_RATE_LIMIT : UNSIGNED_RATE_LIMIT;
  
  const rateLimit = checkRateLimit(request, "pixel-events", rateLimitConfig);
  if (rateLimit.isLimited) {
    
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

    if (payload.eventName !== "checkout_completed") {
      
      return jsonWithCors({ 
        success: true, 
        message: "Event received (client-side only for this event type)" 
      }, { request });
    }

    const shop = await getShopForVerification(payload.shopDomain);

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }

    let signatureResult = verifySignature(
      shop.ingestionSecret,
      timestamp,
      bodyText,
      signature,
      isExplicitlyUnsigned,
      { shopDomain: shop.shopDomain, shopId: shop.id }
    );

    let usedPreviousSecret = false;
    if (signatureResult.status === "invalid" && shop.previousIngestionSecret) {
      const previousResult = verifySignature(
        shop.previousIngestionSecret,
        timestamp,
        bodyText,
        signature,
        false 
      );
      
      if (previousResult.status === "signed") {
        signatureResult = previousResult;
        usedPreviousSecret = true;
        logger.info(
          `[Grace Window] Request verified using previous secret for ${shop.shopDomain}. ` +
          `Previous secret expires: ${shop.previousSecretExpiry?.toISOString()}`
        );
      }
    }

    if (signatureResult.status === "invalid") {
      logger.warn(
        `Invalid signature for shop ${shop.shopDomain}: ${signatureResult.error}`,
        { hasSignature: !!signature, hasTimestamp: !!timestamp }
      );
      return jsonWithCors(
        { error: "Invalid request signature" },
        { status: 401, request }
      );
    }

    if (signatureResult.status === "unsigned_rejected") {
      logger.warn(
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

    if (signatureResult.status === "unsigned") {
      logger.info(
        `Unsigned pixel request from ${shop.shopDomain}: ${signatureResult.reason}`
      );
    }

    const isTrusted = signatureResult.trusted;

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
          isTrusted: signatureResult.trusted,
          signatureStatus: signatureResult.status,
          
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        },
        update: {
          eventId,
          
          checkoutToken: checkoutToken || undefined,
          pixelTimestamp: new Date(payload.timestamp),
          
          consentState: payload.consent ?? null,
          isTrusted: signatureResult.trusted,
          signatureStatus: signatureResult.status,
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
        },
      });
    } catch (error) {
      logger.warn(`Failed to write PixelEventReceipt for order ${orderId}:`, error);
      
    }

    const recordedPlatforms: string[] = [];
    
    for (const config of pixelConfigs) {
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

    return jsonWithCors({
      success: true,
      eventId,
      message: "Pixel event recorded, CAPI will be sent via webhook",
      clientSideSent: true,
      platforms: recordedPlatforms,
      
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
