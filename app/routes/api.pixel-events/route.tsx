

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
import type { KeyValidationResult } from "./types";
import {
  checkInitialConsent,
  filterPlatformsByConsent,
  logNoConsentDrop,
  logConsentFilterMetrics,
} from "./consent-filter";
import {
  getShopForPixelVerificationWithConfigs,
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
import { processEventPipeline } from "../../services/events/pipeline.server";
import { safeFireAndForget } from "../../utils/helpers";
import { trackEvent } from "../../services/analytics.server";

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

    const basicValidation = validateRequest(rawBody);
    if (!basicValidation.valid) {
      logger.debug(
        `Pixel payload validation failed: code=${basicValidation.code}, error=${basicValidation.error}`
      );
      return jsonWithCors({ error: "Invalid request" }, { status: 400, request });
    }

    const { payload } = basicValidation;

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

    const environment = (payload.data as { environment?: "test" | "live" })?.environment || "live";
    const shop = await getShopForPixelVerificationWithConfigs(payload.shopDomain, environment);
    if (!shop || !shop.isActive) {
      return jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 404, request }
      );
    }

    const shopAllowedDomains = buildShopAllowedDomains({
      shopDomain: shop.shopDomain,
      primaryDomain: shop.primaryDomain,
      storefrontDomains: shop.storefrontDomains,
    });

    const signature = request.headers.get("X-Tracking-Guardian-Signature");
    const isProduction = !isDevMode();
    let hmacValidationResult: { valid: boolean; reason?: string; errorCode?: string } | null = null;

    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shop.shopDomain} in production - HMAC verification required`);
        return jsonWithCors(
          { error: "Server configuration error", errorCode: "missing_secret" },
          { status: 500, request, shopAllowedDomains }
        );
      }

      if (!signature) {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "invalid_key",
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

      hmacValidationResult = hmacResult;

      if (!hmacResult.valid) {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "invalid_key",
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

      hmacValidationResult = hmacResult;

      if (!hmacResult.valid) {
        logger.warn(`HMAC verification failed in dev mode for ${shop.shopDomain}: ${hmacResult.reason}`);
        logger.warn(`⚠️ This request would be rejected in production. Please ensure HMAC signature is valid.`);
      } else {
        logger.debug(`HMAC signature verified in dev mode for ${shop.shopDomain}`);
      }
    }

    const pixelConfigs = shop.pixelConfigs;
    let mode: "purchase_only" | "full_funnel" = "purchase_only";
    let purchaseStrategy: "server_side_only" | "hybrid" = "hybrid";

    let foundPurchaseStrategy = false;
    for (const config of pixelConfigs) {
      if (config.clientConfig && typeof config.clientConfig === 'object') {
        if ('mode' in config.clientConfig) {
          const configMode = config.clientConfig.mode;
          if (configMode === 'full_funnel') {
            mode = "full_funnel";
          } else if (configMode === 'purchase_only' && mode !== 'full_funnel') {
            mode = "purchase_only";
          }
        }
        if ('purchaseStrategy' in config.clientConfig) {
          foundPurchaseStrategy = true;
          const configStrategy = config.clientConfig.purchaseStrategy;
          if (configStrategy === 'hybrid') {
            purchaseStrategy = "hybrid";
          } else if (configStrategy === 'server_side_only' && purchaseStrategy !== 'hybrid') {
            purchaseStrategy = "server_side_only";
          }
        }
      }
    }

    if (pixelConfigs.length === 0) {
      mode = "purchase_only";
      purchaseStrategy = "hybrid";
    }

    if (!isPrimaryEvent(payload.eventName, mode)) {
      logger.debug(`Event ${payload.eventName} not accepted for ${payload.shopDomain} (mode: ${mode}) - skipping all DB writes`);
      return emptyResponseWithCors(request);
    }

    const consentResult = checkInitialConsent(payload.consent);
    if (!consentResult.hasAnyConsent) {
      logNoConsentDrop(payload.shopDomain, payload.consent);
      return emptyResponseWithCors(request);
    }

    const referer = request.headers.get("Referer");
    const shopOriginValidation = validatePixelOriginForShop(origin, shopAllowedDomains, {
      referer,
      shopDomain: shop.shopDomain,
    });
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
          `origin=${origin?.substring(0, 100) || "null"}, referer=${referer?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
      );
      return emptyResponseWithCors(request, shopAllowedDomains);
    }

    const keyValidation: KeyValidationResult = (() => {
      if (isProduction) {

        return {
          matched: true,
          reason: "hmac_verified",
        };
      } else {

        if (hmacValidationResult) {
          return {
            matched: hmacValidationResult.valid,
            reason: hmacValidationResult.valid ? "hmac_verified" : (hmacValidationResult.reason || "hmac_verification_failed"),
          };
        } else {

          return {
            matched: !signature || !shop.ingestionSecret,
            reason: !signature ? "no_signature_in_dev" : (!shop.ingestionSecret ? "no_secret_in_dev" : "hmac_not_verified"),
          };
        }
      }
    })();

    const trustResult = evaluateTrustLevel(keyValidation, !!payload.data.checkoutToken);

    const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
    const isPurchaseEvent = eventType === "purchase";

    let matchKeyResult;
    let orderId: string;
    let usedCheckoutTokenAsFallback = false;
    let eventIdentifier: string | null;

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

        eventIdentifier = null;
      }
    }

    const items = payload.data.items as Array<{
      id?: string;
      quantity?: number | string;
      variantId?: string;
      variant_id?: string;
      productId?: string;
      product_id?: string;
    }> | undefined;
    const normalizedItems = items?.map(item => {

      const itemId = String(
        item.variantId ||
        item.variant_id ||
        item.productId ||
        item.product_id ||
        item.id ||
        ""
      ).trim();

      const quantity = typeof item.quantity === "number"
        ? Math.max(1, Math.floor(item.quantity))
        : typeof item.quantity === "string"
        ? Math.max(1, parseInt(item.quantity, 10) || 1)
        : 1;

      return {
        id: itemId,
        quantity,
      };
    }).filter(item => item.id) || [];

    const eventId = generateEventIdForType(
      eventIdentifier || null,
      eventType,
      shop.shopDomain,
      payload.data.checkoutToken,
      normalizedItems.length > 0 ? normalizedItems : undefined,
      payload.nonce || null
    );
    safeFireAndForget(
      trackEvent({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        event: "px_event_received",
        eventId: `px_event_received_${eventId}`,
        metadata: {
          pixelEventName: payload.eventName,
          environment,
          pixelEventId: eventId,
        },
      })
    );

    if (isPurchaseEvent) {
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
    } else {

      logger.debug(`Non-purchase event ${payload.eventName} - skipping receipt/nonce, will only write EventLog via pipeline`, {
        shopId: shop.id,
        eventName: payload.eventName,
        eventId,
      });
    }

    const clientSideConfigs = pixelConfigs.filter(config => config.clientSideEnabled === true);

    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      clientSideConfigs,
      consentResult
    );

    logConsentFilterMetrics(
      shop.shopDomain,
      orderId,
      platformsToRecord,
      skippedPlatforms,
      consentResult
    );

    if (platformsToRecord.length > 0) {
      if (isPurchaseEvent) {
        if (purchaseStrategy === "hybrid") {

          const platformNames = platformsToRecord.map(p => p.platform);
          logger.info(`Processing purchase event in hybrid mode (client-side + server-side)`, {
            shopId: shop.id,
            eventId,
            orderId,
            platforms: platformNames,
            configCount: platformsToRecord.length,
          });

          safeFireAndForget(
            processEventPipeline(shop.id, payload, eventId, platformsToRecord, environment).then((result) => {
              if (result.success) {
                logger.info(`Purchase event successfully sent via client-side`, {
                  shopId: shop.id,
                  eventId,
                  destinations: result.destinations,
                  deduplicated: result.deduplicated,
                });
              } else {
                logger.warn(`Purchase event client-side processing failed, will rely on server-side`, {
                  shopId: shop.id,
                  eventId,
                  errors: result.errors,
                });
              }
            }),
            {
              operation: "processPurchaseEventPipeline",
              metadata: {
                shopId: shop.id,
                eventId,
                platforms: platformNames,
              },
            }
          );

          logger.debug(`Purchase event ${eventId} will also be sent via webhook (hybrid mode)`, {
            shopId: shop.id,
            orderId,
            platforms: platformNames,
          });
        } else {

          logger.debug(`Purchase event ${eventId} queued for webhook processing (server-side only)`, {
            shopId: shop.id,
            orderId,
            platforms: platformsToRecord.map(p => p.platform),
            configCount: platformsToRecord.length,
          });
        }
      } else {

        const platformNames = platformsToRecord.map(p => p.platform);
        logger.info(`Processing ${payload.eventName} event through pipeline for routing to destinations`, {
          shopId: shop.id,
          eventId,
          eventName: payload.eventName,
          platforms: platformNames,
          configCount: platformsToRecord.length,
          mode,
        });

        safeFireAndForget(
          processEventPipeline(shop.id, payload, eventId, platformsToRecord, environment).then((result) => {
            if (result.success) {
              logger.info(`Event ${payload.eventName} successfully routed to destinations`, {
                shopId: shop.id,
                eventId,
                eventName: payload.eventName,
                destinations: result.destinations,
                deduplicated: result.deduplicated,
              });
            } else {
              logger.warn(`Event ${payload.eventName} pipeline processing failed`, {
                shopId: shop.id,
                eventId,
                eventName: payload.eventName,
                errors: result.errors,
              });
            }
          }),
          {
            operation: "processEventPipeline",
            metadata: {
              shopId: shop.id,
              eventId,
              eventName: payload.eventName,
              platforms: platformNames,
            },
          }
        );
      }
    }

    const message = isPurchaseEvent
      ? purchaseStrategy === "hybrid"
        ? `Pixel event recorded, sending via client-side and server-side (hybrid mode)`
        : "Pixel event recorded, CAPI will be sent via webhook"
      : `Pixel event recorded and routing to ${platformsToRecord.length} destination(s) (GA4/Meta/TikTok)`;

    return jsonWithCors(
      {
        success: true,
        eventId,
        message,
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
