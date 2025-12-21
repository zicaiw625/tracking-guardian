import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { generateEventId, generateMatchKey } from "../utils/crypto";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "../utils/rate-limiter";
import { checkCircuitBreaker } from "../utils/circuit-breaker";
import { getShopForVerification, timingSafeEquals } from "../utils/shop-access";
import { isMarketingPlatform, isAnalyticsPlatform } from "../utils/platform-consent";
import { 
  isValidShopifyOrigin, 
  isValidDevOrigin, 
  isDevMode,
  isValidPixelOrigin,
} from "../utils/origin-validation";
import {
  getDynamicCorsHeaders,
  getPixelEventsCorsHeaders,
  jsonWithCors as jsonWithCorsBase,
  handleCorsPreFlight,
  addCorsHeaders,
} from "../utils/cors";

import { logger, metrics } from "../utils/logger";

const MAX_BODY_SIZE = 32 * 1024;

const TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;

const RATE_LIMIT_CONFIG = { maxRequests: 50, windowMs: 60 * 1000 };

const CIRCUIT_BREAKER_CONFIG = {
  threshold: 10000,     
  windowMs: 60 * 1000,  
};

const PIXEL_CUSTOM_HEADERS = [
  "X-Tracking-Guardian-Key",
  "X-Tracking-Guardian-Timestamp",
];

/**
 * P0-2: Get CORS headers for pixel events endpoint.
 * 
 * Uses permissive CORS (Access-Control-Allow-Origin: *) because:
 * - Web Pixels run on storefronts with custom domains (e.g., https://brand.com)
 * - We cannot whitelist all possible custom domains
 * - Authentication is via ingestion key, not origin
 */
function getCorsHeaders(_request: Request): HeadersInit {
  return getPixelEventsCorsHeaders(PIXEL_CUSTOM_HEADERS);
}

function jsonWithCors<T>(data: T, init: ResponseInit & { request: Request }): Response {
  const { request, ...responseInit } = init;
  return jsonWithCorsBase(data, {
    ...responseInit,
    request,
    headers: responseInit.headers as HeadersInit | undefined,
  });
}

type PixelEventName = "checkout_completed";

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

function sanitizeString(value: string | undefined | null, maxLength: number): string | null {
  if (!value) return null;
  
  let sanitized = String(value).substring(0, maxLength);
  
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED]");
  
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

/**
 * P1-2: Validation result with detailed error codes for monitoring
 */
type ValidationError = 
  | "invalid_body"
  | "missing_event_name"
  | "missing_shop_domain"
  | "invalid_shop_domain_format"
  | "missing_timestamp"
  | "invalid_timestamp_type"
  | "missing_order_identifiers";

function validateRequest(body: unknown): { valid: true; payload: PixelEventPayload } | { valid: false; error: string; code: ValidationError } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body", code: "invalid_body" };
  }

  const data = body as Record<string, unknown>;

  if (!data.eventName || typeof data.eventName !== "string") {
    return { valid: false, error: "Missing eventName", code: "missing_event_name" };
  }

  if (!data.shopDomain || typeof data.shopDomain !== "string") {
    return { valid: false, error: "Missing shopDomain", code: "missing_shop_domain" };
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(data.shopDomain as string)) {
    return { valid: false, error: "Invalid shop domain format", code: "invalid_shop_domain_format" };
  }

  if (data.timestamp === undefined || data.timestamp === null) {
    return { valid: false, error: "Missing timestamp", code: "missing_timestamp" };
  }

  if (typeof data.timestamp !== "number") {
    return { valid: false, error: "Invalid timestamp type", code: "invalid_timestamp_type" };
  }

  if (data.eventName === "checkout_completed") {
    const eventData = data.data as Record<string, unknown> | undefined;
    if (!eventData?.orderId && !eventData?.checkoutToken) {
      return { valid: false, error: "Missing orderId and checkoutToken for checkout_completed event", code: "missing_order_identifiers" };
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

  const contentType = request.headers.get("Content-Type");
  if (!contentType || !contentType.includes("application/json")) {
    return jsonWithCors(
      { error: "Content-Type must be application/json" },
      { status: 415, request }
    );
  }

  // P0-2: Validate origin for pixel events
  // Allow any HTTPS origin (storefronts can have custom domains like https://brand.com)
  // Security is enforced via ingestion key + timestamp, not origin restriction
  const origin = request.headers.get("Origin");
  const originValidation = isValidPixelOrigin(origin);
  
  if (!originValidation.valid) {
    const originShopDomain = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(originShopDomain, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${originShopDomain}: ${anomalyCheck.reason}`);
    }
    // P3-3: Track rejection metric
    metrics.pixelRejection({
      shopDomain: originShopDomain,
      reason: "invalid_origin",
      originType: originValidation.reason,
    });
    logger.warn(`Rejected invalid pixel origin: ${origin?.substring(0, 100) || "null"}, reason: ${originValidation.reason}`);
    return jsonWithCors(
      { error: "Invalid origin" },
      { status: 403, request }
    );
  }

  const timestampHeader = request.headers.get("X-Tracking-Guardian-Timestamp");
  const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
  
  if (timestampHeader) {
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug("Invalid timestamp format, dropping request");
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug(`Timestamp outside window: diff=${timeDiff}ms, dropping request`);
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }
  } else {
    logger.debug(`Request from ${shopDomainHeader} missing timestamp header`);
  }

  const rateLimit = await checkRateLimitAsync(request, "pixel-events", RATE_LIMIT_CONFIG);
  if (rateLimit.isLimited) {
    logger.warn(`Rate limit exceeded for pixel-events`, {
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
      logger.warn(`Payload too large: ${contentLength} bytes (max ${MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: MAX_BODY_SIZE },
        { status: 413, request }
      );
    }

    const bodyText = await request.text();

    if (bodyText.length > MAX_BODY_SIZE) {
      logger.warn(`Actual payload too large: ${bodyText.length} bytes (max ${MAX_BODY_SIZE})`);
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
      // P1-2: Log validation failures with error codes for monitoring
      logger.debug(`Pixel payload validation failed: code=${validation.code}, error=${validation.error}`);
      return jsonWithCors({ error: validation.error, code: validation.code }, { status: 400, request });
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
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    const shop = await getShopForVerification(payload.shopDomain);

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }

    const ingestionKey = request.headers.get("X-Tracking-Guardian-Key");
    let keyValidation: { matched: boolean; reason: string; usedPreviousSecret?: boolean };
    
    if (!shop.ingestionSecret) {
      // Production: reject requests from shops without ingestion key configured
      // This prevents abuse from shops that haven't completed pixel setup
      if (!isDevMode()) {
        logger.warn(`Rejected: Shop ${shop.shopDomain} has no ingestion key configured`);
        return jsonWithCors(
          { error: "Pixel not configured", code: "INGESTION_KEY_NOT_CONFIGURED" },
          { status: 403, request }
        );
      }
      // Dev mode: allow for easier testing
      keyValidation = { matched: false, reason: "shop_no_key_configured_dev" };
      logger.info(`[DEV] Shop ${shop.shopDomain} has no ingestion key configured - allowing request`);
    } else if (!ingestionKey) {
      const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
      }
      logger.warn(`Dropped: Pixel request from ${shop.shopDomain} missing ingestion key`);
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    } else {
      const { verifyWithGraceWindow } = await import("../utils/shop-access");
      const matchResult = verifyWithGraceWindow(shop, (secret) => timingSafeEquals(secret, ingestionKey));
      
      if (matchResult.matched) {
        keyValidation = { 
          matched: true, 
          reason: matchResult.usedPreviousSecret ? "matched_previous_secret" : "matched",
          usedPreviousSecret: matchResult.usedPreviousSecret,
        };
      } else {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        logger.warn(`Dropped: Ingestion key mismatch for shop ${shop.shopDomain}`);
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request),
        });
      }
    }

    // P0-2: Trust is now based primarily on ingestion key validation
    // Since we allow custom domains, origin check is secondary
    // A request is trusted if the ingestion key matches
    const isTrusted = keyValidation.matched;

    const rawOrderId = payload.data.orderId;
    const checkoutToken = payload.data.checkoutToken;

    let matchKeyResult;
    try {
      matchKeyResult = generateMatchKey({
        orderId: rawOrderId,
        checkoutToken: checkoutToken,
      });
    } catch (error) {
      return jsonWithCors(
        { error: "Missing orderId and checkoutToken" },
        { status: 400, request }
      );
    }

    const orderId = matchKeyResult.matchKey;
    const usedCheckoutTokenAsFallback = !matchKeyResult.isOrderId;
    
    if (usedCheckoutTokenAsFallback) {
      logger.info(
        `Using checkoutToken as fallback for shop ${shop.shopDomain}. ` +
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
          isTrusted: isTrusted,
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

    // P3-1: Batch upserts in a transaction for better performance
    const recordedPlatforms: string[] = [];
    const skippedPlatforms: string[] = [];
    
    const consent = payload.consent;
    const hasMarketingConsent = consent?.marketing === true;
    const hasAnalyticsConsent = consent?.analytics === true;
    
    // Filter platforms based on consent
    const platformsToRecord: string[] = [];
    for (const config of pixelConfigs) {
      if (isMarketingPlatform(config.platform) && !hasMarketingConsent) {
        logger.debug(
          `Skipping ${config.platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consent?.marketing})`
        );
        skippedPlatforms.push(config.platform);
        continue;
      }
      
      if (isAnalyticsPlatform(config.platform) && !hasAnalyticsConsent) {
        logger.debug(
          `Skipping ${config.platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consent?.analytics})`
        );
        skippedPlatforms.push(config.platform);
        continue;
      }
      
      platformsToRecord.push(config.platform);
    }
    
    // P3-1: Execute all upserts in a single transaction
    if (platformsToRecord.length > 0) {
      try {
        await prisma.$transaction(
          platformsToRecord.map(platform => 
            prisma.conversionLog.upsert({
              where: {
                shopId_orderId_platform_eventType: {
                  shopId: shop.id,
                  orderId: orderId,
                  platform: platform,
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
                platform: platform,
                eventType: "purchase",
                eventId,
                status: "pending",
                attempts: 0,
                clientSideSent: true,  
                serverSideSent: false,
              },
            })
          )
        );
        recordedPlatforms.push(...platformsToRecord);
      } catch (error) {
        logger.warn(`Failed to record client events in transaction:`, error);
        // Fallback: try individual upserts
        for (const platform of platformsToRecord) {
          try {
            await prisma.conversionLog.upsert({
              where: {
                shopId_orderId_platform_eventType: {
                  shopId: shop.id,
                  orderId: orderId,
                  platform: platform,
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
                platform: platform,
                eventType: "purchase",
                eventId,
                status: "pending",
                attempts: 0,
                clientSideSent: true,  
                serverSideSent: false,
              },
            });
            recordedPlatforms.push(platform);
          } catch (individualError) {
            logger.warn(`Failed to record client event for ${platform}:`, individualError);
          }
        }
      }
    }
    
    // P3-3: Track consent filtering for monitoring
    if (skippedPlatforms.length > 0 || recordedPlatforms.length > 0) {
      metrics.consentFilter({
        shopDomain: shop.shopDomain,
        orderId,
        recordedPlatforms,
        skippedPlatforms,
        marketingConsent: hasMarketingConsent,
        analyticsConsent: hasAnalyticsConsent,
      });
    }

    return jsonWithCors({
      success: true,
      eventId,
      message: "Pixel event recorded, CAPI will be sent via webhook",
      clientSideSent: true,
      platforms: recordedPlatforms,
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
