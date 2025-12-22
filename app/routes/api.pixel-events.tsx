import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { generateEventId, generateMatchKey } from "../utils/crypto";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "../utils/rate-limiter";
import { checkCircuitBreaker } from "../utils/circuit-breaker";
import { getShopForVerification, timingSafeEquals } from "../utils/shop-access";
import { isMarketingPlatform, isAnalyticsPlatform } from "../utils/platform-consent";
import { 
  isDevMode,
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
  extractOriginHost,
} from "../utils/origin-validation";
import {
  getPixelEventsCorsHeaders,
  getPixelEventsCorsHeadersForShop,
  jsonWithCors as jsonWithCorsBase,
} from "../utils/cors";
import { type TrustLevel } from "../utils/receipt-trust";

import { logger, metrics } from "../utils/logger";

const MAX_BODY_SIZE = 32 * 1024;
const TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_CONFIG = { maxRequests: 50, windowMs: 60 * 1000 };
const CIRCUIT_BREAKER_CONFIG = { threshold: 10000, windowMs: 60 * 1000 };

const PIXEL_CUSTOM_HEADERS = [
  "X-Tracking-Guardian-Key",
  "X-Tracking-Guardian-Timestamp",
];

function getCorsHeadersPreBody(request: Request): HeadersInit {
  return getPixelEventsCorsHeaders(request, { customHeaders: PIXEL_CUSTOM_HEADERS });
}

function getCorsHeadersForShop(request: Request, shopAllowedDomains: string[]): HeadersInit {
  return getPixelEventsCorsHeadersForShop(request, shopAllowedDomains, PIXEL_CUSTOM_HEADERS);
}

function jsonWithCors<T>(data: T, init: ResponseInit & { request: Request; shopAllowedDomains?: string[] }): Response {
  const { request, shopAllowedDomains, ...responseInit } = init;
  
  const corsHeaders = shopAllowedDomains 
    ? getCorsHeadersForShop(request, shopAllowedDomains)
    : getCorsHeadersPreBody(request);
  
  return jsonWithCorsBase(data, {
    ...responseInit,
    request,
    headers: {
      ...(responseInit.headers as Record<string, string> | undefined),
      ...corsHeaders,
    },
  });
}

// P1-1: Extended event types for funnel tracking
type PixelEventName = 
  | "checkout_completed"
  | "checkout_started"
  | "checkout_contact_info_submitted"
  | "checkout_shipping_info_submitted"
  | "payment_info_submitted"
  | "page_viewed"
  | "product_added_to_cart";

// Events that are primary (trigger CAPI) vs funnel-only (for analytics)
const PRIMARY_EVENTS = ["checkout_completed"] as const;
const FUNNEL_EVENTS = [
  "checkout_started",
  "checkout_contact_info_submitted", 
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "page_viewed",
  "product_added_to_cart",
] as const;

function isPrimaryEvent(eventName: string): boolean {
  return PRIMARY_EVENTS.includes(eventName as typeof PRIMARY_EVENTS[number]);
}

interface PixelEventPayload {
  eventName: PixelEventName;
  timestamp: number;
  shopDomain: string;
  consent?: {
    marketing?: boolean;
    analytics?: boolean;
    saleOfData?: boolean;
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
    // P1-1: Additional fields for funnel events
    itemCount?: number;
    url?: string;
    title?: string;
    productId?: string;
    productTitle?: string;
    price?: number;
    quantity?: number;
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
  const origin = request.headers.get("Origin");
  
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeadersPreBody(request),
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

  const preBodyValidation = validatePixelOriginPreBody(origin);
  
  if (!preBodyValidation.valid) {
    const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    metrics.pixelRejection({
      shopDomain: shopDomainHeader,
      reason: "invalid_origin_protocol",
      originType: preBodyValidation.reason,
    });
    if (preBodyValidation.shouldLog) {
      logger.warn(`Rejected pixel origin at Stage 1: ${origin?.substring(0, 100) || "null"}, reason: ${preBodyValidation.reason}`);
    }
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
        headers: getCorsHeadersPreBody(request),
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
        headers: getCorsHeadersPreBody(request),
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
    const corsHeaders = getCorsHeadersPreBody(request);
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

    // P1-1: Handle funnel events differently from primary events
    // Funnel events are stored for analytics but don't trigger full CAPI flow
    if (!isPrimaryEvent(payload.eventName)) {
      // For funnel events, just acknowledge and optionally record for analytics
      // We don't need to do full shop verification for non-purchase events
      logger.debug(`Funnel event received: ${payload.eventName} for ${payload.shopDomain}`);
      
      // Still want to record these for diagnostic/funnel analysis
      // But this is a lightweight path - no CAPI, no full validation
      return new Response(null, {
        status: 204,
        headers: getCorsHeadersPreBody(request),
      });
    }

    const shop = await getShopForVerification(payload.shopDomain);

    if (!shop || !shop.isActive) {
      return jsonWithCors({ error: "Shop not found or inactive" }, { status: 404, request });
    }

    const shopAllowedDomains = buildShopAllowedDomains({
      shopDomain: shop.shopDomain,
      primaryDomain: shop.primaryDomain,
      storefrontDomains: shop.storefrontDomains,
    });
    
    const shopOriginValidation = validatePixelOriginForShop(origin, shopAllowedDomains);
    
    if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
      const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_origin");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
      }
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "origin_not_allowlisted",
        originType: shopOriginValidation.reason,
      });
      logger.warn(
        `Rejected pixel origin at Stage 2 for ${shop.shopDomain}: ` +
        `origin=${origin?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
      );
      
      return new Response(null, {
        status: 204,
        headers: getCorsHeadersForShop(request, shopAllowedDomains),
      });
    }

    const ingestionKey = request.headers.get("X-Tracking-Guardian-Key");
    let keyValidation: { matched: boolean; reason: string; usedPreviousSecret?: boolean };
    
    if (!shop.ingestionSecret) {
      if (!isDevMode()) {
        logger.warn(`Rejected: Shop ${shop.shopDomain} has no ingestion key configured`);
        return jsonWithCors(
          { error: "Pixel not configured", code: "INGESTION_KEY_NOT_CONFIGURED" },
          { status: 403, request, shopAllowedDomains }
        );
      }
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
        headers: getCorsHeadersForShop(request, shopAllowedDomains),
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
          headers: getCorsHeadersForShop(request, shopAllowedDomains),
        });
      }
    }

    const isTrusted = keyValidation.matched;
    let trustLevel: TrustLevel = keyValidation.matched ? "partial" : "untrusted";
    let untrustedReason: string | undefined;
    
    const originHost = extractOriginHost(origin);

    if (keyValidation.matched && payload.data.checkoutToken) {
      trustLevel = "partial";
    } else if (!keyValidation.matched) {
      trustLevel = "untrusted";
      untrustedReason = keyValidation.reason || "ingestion_key_invalid";
    } else if (!payload.data.checkoutToken) {
      trustLevel = "partial";
      untrustedReason = "missing_checkout_token";
    }

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
        { status: 400, request, shopAllowedDomains }
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
      }, { request, shopAllowedDomains });
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
      }, { request, shopAllowedDomains });
    }

    const nonceValue = `${orderId}:${payload.timestamp}`;
    const nonceExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    try {
      await prisma.eventNonce.create({
        data: {
          shopId: shop.id,
          nonce: nonceValue,
          eventType: "purchase",
          expiresAt: nonceExpiresAt,
        },
      });
    } catch (nonceError) {
      if ((nonceError as { code?: string })?.code === "P2002") {
        logger.debug(`Replay detected for order ${orderId}, dropping duplicate`);
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "replay_detected",
          originType: "nonce_collision",
        });
        return new Response(null, {
          status: 204,
          headers: getCorsHeadersForShop(request, shopAllowedDomains),
        });
      }
      logger.warn(`Nonce check failed: ${String(nonceError)}`);
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
          consentState: payload.consent ?? undefined,
          isTrusted: isTrusted,
          signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
          trustLevel: trustLevel,
          untrustedReason: untrustedReason,
          originHost: originHost,
        },
        update: {
          eventId,
          checkoutToken: checkoutToken || undefined,
          pixelTimestamp: new Date(payload.timestamp),
          consentState: payload.consent ?? undefined,
          isTrusted: isTrusted,
          signatureStatus: keyValidation.matched ? "key_matched" : keyValidation.reason,
          usedCheckoutTokenFallback: usedCheckoutTokenAsFallback,
          trustLevel: trustLevel,
          untrustedReason: untrustedReason,
          originHost: originHost,
        },
      });
    } catch (error) {
      logger.warn(`Failed to write PixelEventReceipt for order ${orderId}`, { error: String(error) });
    }

    const recordedPlatforms: string[] = [];
    const skippedPlatforms: string[] = [];
    
    // P0-3: Consent handling aligned with extension declaration
    // Extension declares: analytics=true, marketing=true (both required to load)
    // So when pixel fires, we can assume user has consented to both.
    // We still check individually per platform for defense-in-depth.
    // 
    // sale_of_data="enabled" in extension means this involves data sharing,
    // user can opt out via cookie banner. saleOfData=false means opted out.
    const consent = payload.consent;
    const hasMarketingConsent = consent?.marketing === true;
    const hasAnalyticsConsent = consent?.analytics === true;
    const saleOfDataAllowed = consent?.saleOfData !== false;

    if (!saleOfDataAllowed) {
      logger.debug(
        `Skipping ConversionLog recording: sale_of_data opt-out (saleOfData=${String(consent?.saleOfData)})`
      );
      return jsonWithCors(
        { success: true, eventId, message: "Sale of data opted out - event acknowledged" },
        { request, shopAllowedDomains }
      );
    }
    
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
        logger.warn(`Failed to record client events in transaction`, { error: String(error) });
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
            logger.warn(`Failed to record client event for ${platform}`, { error: String(individualError) });
          }
        }
      }
    }
    
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
    }, { request, shopAllowedDomains });
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
