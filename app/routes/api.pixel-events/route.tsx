

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "../../utils/rate-limiter";
import { checkCircuitBreaker } from "../../utils/circuit-breaker";
import {
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
  isDevMode,
} from "../../utils/origin-validation";
import { logger, metrics } from "../../utils/logger.server";
import {
  API_CONFIG,
  RATE_LIMIT_CONFIG as RATE_LIMITS,
  CIRCUIT_BREAKER_CONFIG as CIRCUIT_CONFIG,
} from "../../utils/config";

import {
  jsonWithCors,
  emptyResponseWithCors,
  optionsResponse,
  getCorsHeadersPreBody,
} from "./cors";
import { validateRequest, isPrimaryEvent } from "./validation";
import {
  checkInitialConsent,
  filterPlatformsByConsent,
  logNoConsentDrop,
  logConsentFilterMetrics,
} from "./consent-filter";
import {
  getShopForPixelVerificationWithConfigs,
  validateIngestionKey,
} from "./key-validation";
import {
  isClientEventRecorded,
  generateOrderMatchKey,
  evaluateTrustLevel,
  createEventNonce,
  upsertPixelEventReceipt,
  generatePurchaseEventId,
  generateEventIdForType,
} from "./receipt-handler";
import { validatePixelEventHMAC } from "./hmac-validation";

const MAX_BODY_SIZE = API_CONFIG.MAX_BODY_SIZE;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const RATE_LIMIT_CONFIG = RATE_LIMITS.PIXEL_EVENTS;
const CIRCUIT_BREAKER_CONFIG = {
  threshold: CIRCUIT_CONFIG.DEFAULT_THRESHOLD,
  windowMs: CIRCUIT_CONFIG.DEFAULT_WINDOW_MS,
};

function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("text/plain") || lower.includes("application/json");
}

async function parseBodyAsJson(request: Request): Promise<{
  success: true;
  data: unknown;
  bodyText: string;
  bodyLength: number;
} | {
  success: false;
  error: string;
}> {
  try {
    const bodyText = await request.text();

    if (bodyText.length > MAX_BODY_SIZE) {
      return { success: false, error: "payload_too_large" };
    }

    const data = JSON.parse(bodyText);
    return { success: true, data, bodyText, bodyLength: bodyText.length };
  } catch {
    return { success: false, error: "invalid_json" };
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }

  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }

  const contentType = request.headers.get("Content-Type");
  if (!isAcceptableContentType(contentType)) {
    return jsonWithCors(
      { error: "Content-Type must be text/plain or application/json" },
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
      reason: preBodyValidation.reason as "invalid_origin" | "invalid_origin_protocol",
      originType: preBodyValidation.reason,
    });
    if (preBodyValidation.shouldLog) {
      logger.warn(
        `Rejected pixel origin at Stage 1: ${origin?.substring(0, 100) || "null"}, ` +
          `reason: ${preBodyValidation.reason}`
      );
    }
    return jsonWithCors({ error: "Invalid origin" }, { status: 403, request });
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
      logger.debug("Invalid timestamp format in header, dropping request");
      return emptyResponseWithCors(request);
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug(`Timestamp outside window: diff=${timeDiff}ms, dropping request`);
      return emptyResponseWithCors(request);
    }
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

    const parseResult = await parseBodyAsJson(request);
    if (!parseResult.success) {
      if (parseResult.error === "payload_too_large") {
        logger.warn(`Actual payload too large (max ${MAX_BODY_SIZE})`);
        return jsonWithCors(
          { error: "Payload too large", maxSize: MAX_BODY_SIZE },
          { status: 413, request }
        );
      }
      return jsonWithCors({ error: "Invalid JSON body" }, { status: 400, request });
    }

    const rawBody = parseResult.data;
    const bodyText = parseResult.bodyText;

    const validation = validateRequest(rawBody);
    if (!validation.valid) {
      logger.debug(
        `Pixel payload validation failed: code=${validation.code}, error=${validation.error}`
      );
      return jsonWithCors({ error: "Invalid request" }, { status: 400, request });
    }

    const { payload } = validation;

    if (!timestampHeader) {
      const now = Date.now();
      const timeDiff = Math.abs(now - payload.timestamp);
      if (timeDiff > TIMESTAMP_WINDOW_MS) {
        const anomalyCheck = trackAnomaly(payload.shopDomain, "invalid_timestamp");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${payload.shopDomain}: ${anomalyCheck.reason}`);
        }
        logger.debug(`Body timestamp outside window: diff=${timeDiff}ms, dropping request`);
        return emptyResponseWithCors(request);
      }
    }

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

    const shop = await getShopForPixelVerificationWithConfigs(payload.shopDomain);
    if (!shop || !shop.isActive) {
      return jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 404, request }
      );
    }

    const pixelConfigs = shop.pixelConfigs;
    const mode = pixelConfigs.some(
      config => config.clientConfig &&
      typeof config.clientConfig === 'object' &&
      'mode' in config.clientConfig &&
      config.clientConfig.mode === 'full_funnel'
    ) ? "full_funnel" : (
      pixelConfigs.some(
        config => config.clientConfig &&
        typeof config.clientConfig === 'object' &&
        'mode' in config.clientConfig &&
        config.clientConfig.mode === 'purchase_only'
      ) ? "purchase_only" : "full_funnel"
    );

    if (!isPrimaryEvent(payload.eventName, mode)) {
      logger.debug(`Event ${payload.eventName} not accepted for ${payload.shopDomain} (mode: ${mode})`);
      return emptyResponseWithCors(request);
    }

    const consentResult = checkInitialConsent(payload.consent);
    if (!consentResult.hasAnyConsent) {
      logNoConsentDrop(payload.shopDomain, payload.consent);
      return emptyResponseWithCors(request);
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
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    const ingestionKeyFromBody = payload.ingestionKey;
    const ingestionKeyFromHeader = request.headers.get("X-Tracking-Guardian-Key");
    const ingestionKey = ingestionKeyFromBody || ingestionKeyFromHeader || null;

    const keyValidationOutcome = validateIngestionKey({
      shop,
      ingestionKey,
      shopAllowedDomains,
    });

    if (keyValidationOutcome.type === "missing_key_prod") {
      return jsonWithCors({ error: "Forbidden" }, { status: 403, request, shopAllowedDomains });
    }
    if (
      keyValidationOutcome.type === "missing_key_request" ||
      keyValidationOutcome.type === "key_mismatch"
    ) {
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    const keyValidation = keyValidationOutcome.result;

    const signature = request.headers.get("X-Tracking-Guardian-Signature");
    const isProduction = !isDevMode();

    if (isProduction) {

      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shop.shopDomain} in production - HMAC verification required`);
        return jsonWithCors(
          { error: "Server configuration error", errorCode: "missing_secret" },
          { status: 500, request, shopAllowedDomains }
        );
      }

      if (!signature) {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "missing_signature");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "missing_signature",
          originType: "production_required",
        });
        logger.warn(`Missing HMAC signature for ${shop.shopDomain} in production`);
        return jsonWithCors(
          { error: "Missing signature", errorCode: "missing_signature" },
          { status: 403, request, shopAllowedDomains }
        );
      }

      const hmacResult = await validatePixelEventHMAC(
        request,
        bodyText,
        shop.ingestionSecret,
        payload.timestamp,
        TIMESTAMP_WINDOW_MS
      );

      if (!hmacResult.valid) {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_signature");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "hmac_verification_failed",
          originType: hmacResult.errorCode || "unknown",
        });
        logger.warn(
          `HMAC verification failed for ${shop.shopDomain}: ${hmacResult.reason}`
        );
        return jsonWithCors(
          { error: "Invalid signature", errorCode: hmacResult.errorCode },
          { status: 403, request, shopAllowedDomains }
        );
      }

      logger.debug(`HMAC signature verified for ${shop.shopDomain}`);
    } else if (shop.ingestionSecret && signature) {

      const hmacResult = await validatePixelEventHMAC(
        request,
        bodyText,
        shop.ingestionSecret,
        payload.timestamp,
        TIMESTAMP_WINDOW_MS
      );

      if (!hmacResult.valid) {
        logger.warn(`HMAC verification failed in dev mode for ${shop.shopDomain}: ${hmacResult.reason}`);

      } else {
        logger.debug(`HMAC signature verified in dev mode for ${shop.shopDomain}`);
      }
    }

    const trustResult = evaluateTrustLevel(keyValidation, !!payload.data.checkoutToken);

    const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
    const isPurchaseEvent = eventType === "purchase";

    let matchKeyResult;
    let orderId: string;
    let usedCheckoutTokenAsFallback = false;
    let eventIdentifier: string;

    if (isPurchaseEvent) {
      try {
        matchKeyResult = generateOrderMatchKey(
          payload.data.orderId,
          payload.data.checkoutToken,
          shop.shopDomain
        );
        orderId = matchKeyResult.orderId;
        usedCheckoutTokenAsFallback = matchKeyResult.usedCheckoutTokenAsFallback;
        eventIdentifier = orderId;
      } catch (error) {
        logger.debug(`Match key generation failed for shop ${shop.shopDomain}: ${String(error)}`);
        return jsonWithCors({ error: "Invalid request" }, { status: 400, request, shopAllowedDomains });
      }
    } else {

      const checkoutToken = payload.data.checkoutToken;
      if (checkoutToken) {
        orderId = checkoutToken;
        eventIdentifier = checkoutToken;
      } else {

        orderId = `session_${payload.timestamp}_${shop.shopDomain.replace(/\./g, "_")}`;
        eventIdentifier = orderId;
      }
    }

    const items = payload.data.items as Array<{ id?: string; quantity?: number }> | undefined;
    const normalizedItems = items?.map(item => ({
      id: String(item.id || ""),
      quantity: item.quantity || 1,
    })).filter(item => item.id);

    const eventId = generateEventIdForType(
      eventIdentifier,
      eventType,
      shop.shopDomain,
      payload.data.checkoutToken,
      normalizedItems
    );

    const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, eventType);
    if (alreadyRecorded) {
      return jsonWithCors(
        {
          success: true,
          eventId,
          message: "Client event already recorded",
          clientSideSent: true,
        },
        { request, shopAllowedDomains }
      );
    }

    if (pixelConfigs.length === 0) {
      return jsonWithCors(
        {
          success: true,
          eventId,
          message: "No server-side tracking configured - client event acknowledged",
        },
        { request, shopAllowedDomains }
      );
    }

    const nonceFromBody = payload.nonce;
    const nonceResult = await createEventNonce(
      shop.id,
      orderId,
      payload.timestamp,
      nonceFromBody,
      eventType
    );
    if (nonceResult.isReplay) {
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "replay_detected",
        originType: "nonce_collision",
      });
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    await upsertPixelEventReceipt(
      shop.id,
      orderId,
      eventId,
      payload,
      keyValidation,
      trustResult,
      usedCheckoutTokenAsFallback,
      origin,
      eventType
    );

    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      pixelConfigs,
      consentResult
    );

    logConsentFilterMetrics(
      shop.shopDomain,
      orderId,
      platformsToRecord,
      skippedPlatforms,
      consentResult
    );

    return jsonWithCors(
      {
        success: true,
        eventId,
        message: "Pixel event recorded, CAPI will be sent via webhook",
        clientSideSent: true,
        platforms: platformsToRecord,
        skippedPlatforms: skippedPlatforms.length > 0 ? skippedPlatforms : undefined,
        trusted: trustResult.isTrusted,
        consent: payload.consent || null,
      },
      { request, shopAllowedDomains }
    );
  } catch (error) {
    logger.error("Pixel events API error:", error);
    return jsonWithCors({ error: "Internal server error" }, { status: 500, request });
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonWithCors({ status: "ok", endpoint: "pixel-events" }, { request });
};
