import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { jsonWithCors, getCorsHeadersPreBody, emptyResponseWithCors, optionsResponse } from "./api.pixel-events/cors";
import type { PixelEventPayload } from "./api.pixel-events/types";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger, metrics } from "~/utils/logger.server";
import { getShopForPixelVerificationWithConfigs } from "./api.pixel-events/key-validation";
import { validatePixelEventHMAC } from "./api.pixel-events/hmac-validation";
import { verifyWithGraceWindowAsync } from "~/utils/shop-access";
import { validateRequest, isPrimaryEvent } from "./api.pixel-events/validation";
import { API_CONFIG, RATE_LIMIT_CONFIG, CIRCUIT_BREAKER_CONFIG } from "~/utils/config";
import {
  isDevMode,
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
} from "~/utils/origin-validation";
import {
  generateEventIdForType,
  generateOrderMatchKey,
  isClientEventRecorded,
  createEventNonce,
  upsertPixelEventReceipt,
  evaluateTrustLevel,
} from "./api.pixel-events/receipt-handler";
import type { KeyValidationResult } from "./api.pixel-events/types";
import { checkInitialConsent, filterPlatformsByConsent, logConsentFilterMetrics } from "./api.pixel-events/consent-filter";
import { checkRateLimitAsync, createRateLimitResponse, trackAnomaly } from "~/utils/rate-limiter";
import { checkCircuitBreaker } from "~/utils/circuit-breaker";
import { safeFireAndForget } from "~/utils/helpers";
import { trackEvent } from "~/services/analytics.server";
import { normalizePlanId } from "~/services/billing/plans";
import { isPlanAtLeast } from "~/utils/plans";
import prisma from "~/db.server";

const MAX_BATCH_SIZE = 100;
const MAX_BODY_SIZE = API_CONFIG.MAX_BODY_SIZE;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const INGEST_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS;
const CIRCUIT_BREAKER_CONFIG_LOCAL = {
  threshold: CIRCUIT_BREAKER_CONFIG.DEFAULT_THRESHOLD,
  windowMs: CIRCUIT_BREAKER_CONFIG.DEFAULT_WINDOW_MS,
};

function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("text/plain") || lower.includes("application/json");
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
        `Rejected pixel origin at Stage 1 in /ingest: ${origin?.substring(0, 100) || "null"}, ` +
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
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request }
      );
    }
  }
  let bodyText: string;
  let bodyData: unknown;
  try {
    bodyText = await request.text();
    if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Request body too large: ${bodyText.length} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return jsonWithCors(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413, request }
      );
    }
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonWithCors(
        { error: "Invalid JSON body" },
        { status: 400, request }
      );
    }
    return jsonWithCors(
      { error: "Failed to read request body" },
      { status: 400, request }
    );
  }
  const isBatchFormat =
    typeof bodyData === "object" &&
    bodyData !== null &&
    "events" in bodyData &&
    Array.isArray((bodyData as { events?: unknown }).events);
  if (isBatchFormat) {
    const batchData = bodyData as { events: unknown[]; timestamp?: number };
    const events = batchData.events || [];
    if (events.length === 0) {
      return jsonWithCors(
        { error: "events array cannot be empty" },
        { status: 400, request }
      );
    }
    if (events.length > MAX_BATCH_SIZE) {
      return jsonWithCors(
        { error: `events array exceeds maximum size of ${MAX_BATCH_SIZE}` },
        { status: 400, request }
      );
    }
    const firstEventValidation = validateRequest(events[0]);
    if (!firstEventValidation.valid) {
      return jsonWithCors(
        { error: "Invalid event in batch", details: firstEventValidation.error },
        { status: 400, request }
      );
    }
    const firstPayload = firstEventValidation.payload;
    const shopDomain = firstPayload.shopDomain;
    const timestamp = batchData.timestamp || firstPayload.timestamp;
    const signature = request.headers.get("X-Tracking-Guardian-Signature");
    const isProduction = !isDevMode();
    const environment = (firstPayload.data as { environment?: "test" | "live" })?.environment || "live";
    const shop = await getShopForPixelVerificationWithConfigs(shopDomain, environment);
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
    const referer = request.headers.get("Referer");
    const shopOriginValidation = validatePixelOriginForShop(origin, shopAllowedDomains, {
      referer,
      shopDomain: shop.shopDomain,
    });
    if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
      logger.warn(
        `Rejected pixel origin at Stage 2 in /ingest for ${shop.shopDomain}: ` +
          `origin=${origin?.substring(0, 100) || "null"}, referer=${referer?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
      );
      return jsonWithCors({ error: "Origin not allowlisted" }, { status: 403, request, shopAllowedDomains });
    }
    const isNullOrigin = origin === "null" || origin === null;
    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shopDomain} in production - HMAC verification required`);
        if (isNullOrigin) {
          logger.error(`Null origin request without ingestionSecret for ${shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_secret_null_origin" },
            { status: 403, request }
          );
        }
        return jsonWithCors(
          { error: "Server configuration error", errorCode: "missing_secret" },
          { status: 500, request }
        );
      }
      if (!signature) {
        logger.error(`Missing HMAC signature for ${shopDomain} in production - rejecting`);
        if (isNullOrigin) {
          logger.error(`Null origin request without HMAC signature for ${shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_signature_null_origin" },
            { status: 403, request }
          );
        }
        return jsonWithCors(
          { error: "Missing signature", errorCode: "missing_signature" },
          { status: 403, request }
        );
      }
      const verifyWithSecret = async (secret: string) => {
        const result = await validatePixelEventHMAC(
          request,
          bodyText,
          secret,
          timestamp,
          TIMESTAMP_WINDOW_MS
        );
        return result.valid;
      };
      const graceResult = await verifyWithGraceWindowAsync(shop, verifyWithSecret);
      const hmacValid = graceResult.matched;
      const usedPreviousSecret = graceResult.usedPreviousSecret;
      if (!hmacValid) {
        logger.error(`HMAC verification failed for ${shopDomain} in production: both current and previous secrets failed`);
        return jsonWithCors(
          { error: "Invalid signature", errorCode: "invalid_signature" },
          { status: 403, request }
        );
      }
      if (isNullOrigin) {
        const allowNullOrigin = process.env.PIXEL_ALLOW_NULL_ORIGIN === "true" || process.env.PIXEL_ALLOW_NULL_ORIGIN === "1";
        if (!allowNullOrigin) {
          logger.error(`Null origin request rejected for ${shopDomain} in production: PIXEL_ALLOW_NULL_ORIGIN not set. If ingestionSecret is compromised, null origin requests pose significant security risk. Production environment must set PIXEL_ALLOW_NULL_ORIGIN=true to allow null origin requests from Shopify Web Worker sandbox environments.`);
          return jsonWithCors(
            { error: "Null origin not allowed", errorCode: "null_origin_blocked" },
            { status: 403, request }
          );
        }
        if (usedPreviousSecret) {
          logger.warn(`Null origin request accepted with previous secret for ${shopDomain} in production. Previous secret expires: ${shop.previousSecretExpiry?.toISOString()}. If ingestionSecret is compromised, immediately rotate secret and review access logs. Null origin requests cannot be validated via Origin header and rely solely on HMAC signature.`);
        } else {
          logger.debug(`Null origin request accepted with valid HMAC and ingestionSecret for ${shopDomain} in production (PIXEL_ALLOW_NULL_ORIGIN=true). Null origin requests are allowed but require valid HMAC signature as they cannot be validated via Origin header.`);
        }
      } else {
        logger.debug(`HMAC signature verified for ${shopDomain} in production${usedPreviousSecret ? " (using previous secret)" : ""}`);
      }
    }
    const rateLimit = await checkRateLimitAsync(request, "pixel-events", INGEST_RATE_LIMIT);
    if (rateLimit.isLimited) {
      logger.warn(`Rate limit exceeded for ingest`, {
        shopDomain,
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
    const pixelConfigs = shop.pixelConfigs;
    let mode: "purchase_only" | "full_funnel" = "purchase_only";
    for (const config of pixelConfigs) {
      if (config.clientConfig && typeof config.clientConfig === 'object') {
        if ('mode' in config.clientConfig) {
          const configMode = config.clientConfig.mode;
          if (configMode === 'full_funnel') {
            mode = "full_funnel";
            break;
          } else if (configMode === 'purchase_only' && mode !== 'full_funnel') {
            mode = "purchase_only";
          }
        }
      }
    }
    const validatedEvents: Array<{
      payload: PixelEventPayload;
      eventId: string | null;
      destinations: string[];
    }> = [];
    const serverSideConfigs = pixelConfigs.filter(config => config.serverSideEnabled === true);
    const keyValidation: KeyValidationResult = (() => {
      if (isProduction) {
        return {
          matched: true,
          reason: "hmac_verified",
        };
      } else {
        if (signature && shop.ingestionSecret) {
          return {
            matched: true,
            reason: "hmac_verified",
          };
        } else {
          return {
            matched: !signature || !shop.ingestionSecret,
            reason: !signature ? "no_signature_in_dev" : (!shop.ingestionSecret ? "no_secret_in_dev" : "hmac_not_verified"),
          };
        }
      }
    })();
    for (let i = 0; i < events.length; i++) {
      const eventValidation = validateRequest(events[i]);
      if (!eventValidation.valid) {
        logger.warn(`Invalid event at index ${i} in batch`, {
          shopDomain,
          error: eventValidation.error,
        });
        continue;
      }
      const payload = eventValidation.payload;
      if (payload.shopDomain !== shopDomain) {
        logger.warn(`Event at index ${i} has different shopDomain`, {
          expected: shopDomain,
          actual: payload.shopDomain,
        });
        continue;
      }
      if (!isPrimaryEvent(payload.eventName, mode)) {
        logger.debug(`Event ${payload.eventName} at index ${i} not accepted for ${shopDomain} (mode: ${mode}) - skipping`);
        continue;
      }
      const prdEventId = payload.nonce;
      const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
      const isPurchaseEvent = eventType === "purchase";
      const items = payload.data.items as Array<{
        id?: string;
        quantity?: number | string;
        variantId?: string;
        variant_id?: string;
        productId?: string;
        product_id?: string;
      }> | undefined;
      const normalizedItems = items?.map(item => ({
        id: String(
          item.variantId ||
          item.variant_id ||
          item.productId ||
          item.product_id ||
          item.id ||
          ""
        ).trim(),
        quantity: typeof item.quantity === "number"
          ? Math.max(1, Math.floor(item.quantity))
          : typeof item.quantity === "string"
          ? Math.max(1, parseInt(item.quantity, 10) || 1)
          : 1,
      })).filter(item => item.id) || [];
      let orderId: string | null = null;
      let usedCheckoutTokenAsFallback = false;
      let eventIdentifier: string | null = null;
      if (isPurchaseEvent) {
        try {
          const matchKeyResult = generateOrderMatchKey(
            payload.data.orderId,
            payload.data.checkoutToken,
            shopDomain
          );
          orderId = matchKeyResult.orderId;
          usedCheckoutTokenAsFallback = matchKeyResult.usedCheckoutTokenAsFallback;
          eventIdentifier = orderId;
          const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, eventType);
          if (alreadyRecorded) {
            logger.debug(`Purchase event already recorded for order ${orderId}, skipping`, {
              shopId: shop.id,
              orderId,
              eventType,
            });
            continue;
          }
          const nonceFromBody = prdEventId || payload.nonce;
          const nonceResult = await createEventNonce(
            shop.id,
            orderId,
            payload.timestamp,
            nonceFromBody,
            eventType
          );
          if (nonceResult.isReplay) {
            logger.debug(`Replay detected for order ${orderId}, skipping`, {
              shopId: shop.id,
              orderId,
              eventType,
            });
            continue;
          }
        } catch (error) {
          logger.warn(`Failed to process purchase event at index ${i}`, {
            shopDomain,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      } else {
        const checkoutToken = payload.data.checkoutToken;
        if (checkoutToken) {
          orderId = checkoutToken;
          eventIdentifier = checkoutToken;
        } else {
          orderId = `session_${payload.timestamp}_${shopDomain.replace(/\./g, "_")}`;
          eventIdentifier = null;
        }
      }
      const eventId = prdEventId || generateEventIdForType(
        eventIdentifier,
        eventType,
        shopDomain,
        payload.data.checkoutToken,
        normalizedItems.length > 0 ? normalizedItems : undefined,
        payload.nonce || null
      );
      const consentResult = checkInitialConsent(payload.consent);
      const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
        serverSideConfigs,
        consentResult
      );
      const destinations = platformsToRecord.map(p => p.platform);
      if (isPurchaseEvent && orderId) {
        logConsentFilterMetrics(
          shopDomain,
          orderId,
          platformsToRecord,
          skippedPlatforms,
          consentResult
        );
        try {
          const activeVerificationRun = await prisma.verificationRun.findFirst({
            where: {
              shopId: shop.id,
              status: "running",
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : null;
          await upsertPixelEventReceipt(
            shop.id,
            eventId,
            payload,
            origin,
            eventType,
            activeVerificationRun?.id || null,
            primaryPlatform || null,
            orderId || null
          );
        } catch (error) {
          logger.warn(`Failed to write receipt for purchase event at index ${i}`, {
            shopId: shop.id,
            orderId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (destinations.length === 0) {
        logger.debug(`Event at index ${i} has no allowed platforms after consent filtering, skipping`, {
          shopDomain,
          eventName: payload.eventName,
          consent: payload.consent,
        });
        continue;
      }
      validatedEvents.push({
        payload,
        eventId,
        destinations,
      });
    }
    if (validatedEvents.length === 0) {
      logger.debug(`All events filtered for ${shopDomain} (mode: ${mode}) - returning empty accepted_count`);
      return jsonWithCors(
        {
          accepted_count: 0,
          errors: [],
        },
        { request }
      );
    }
    safeFireAndForget(
      processBatchEvents(shop.id, validatedEvents, environment).then((results) => {
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        logger.info(`Batch ingest processed`, {
          shopDomain,
          total: validatedEvents.length,
          accepted: successCount,
          errors: errorCount,
        });
      }),
      {
        operation: "processBatchEvents",
        metadata: {
          shopId: shop.id,
          shopDomain,
          total: validatedEvents.length,
        },
      }
    );
    return jsonWithCors(
      {
        accepted_count: validatedEvents.length,
        errors: [],
      },
      { request }
    );
  } else {
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
      logger.warn(`Actual payload too large (max ${MAX_BODY_SIZE})`);
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
    const basicValidation = validateRequest(rawBody);
    if (!basicValidation.valid) {
      logger.debug(
        `Pixel payload validation failed: code=${basicValidation.code}, error=${basicValidation.error}`
      );
      const shopDomainFromPayload = (rawBody as { shopDomain?: string })?.shopDomain || "unknown";
      metrics.pxValidateFailed(shopDomainFromPayload, basicValidation.code || "unknown");
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
    const circuitCheck = await checkCircuitBreaker(payload.shopDomain, CIRCUIT_BREAKER_CONFIG_LOCAL);
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
    const rateLimit = await checkRateLimitAsync(request, "pixel-events", INGEST_RATE_LIMIT);
    if (rateLimit.isLimited) {
      logger.warn(`Rate limit exceeded for ingest`, {
        shopDomain: payload.shopDomain,
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
    const environment = (payload.data as { environment?: "test" | "live" })?.environment || "live";
    const shop = await getShopForPixelVerificationWithConfigs(payload.shopDomain, environment);
    if (!shop || !shop.isActive) {
      return jsonWithCors(
        { error: "Shop not found or inactive" },
        { status: 404, request }
      );
    }
    const shopWithPlan = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { plan: true },
    });
    const shopAllowedDomains = buildShopAllowedDomains({
      shopDomain: shop.shopDomain,
      primaryDomain: shop.primaryDomain,
      storefrontDomains: shop.storefrontDomains,
    });
    const signature = request.headers.get("X-Tracking-Guardian-Signature");
    const isProduction = !isDevMode();
    const isNullOrigin = origin === "null" || origin === null;
    let hmacValidationResult: { valid: boolean; reason?: string; errorCode?: string } | null = null;
    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shop.shopDomain} in production - HMAC verification required`);
        if (isNullOrigin) {
          logger.error(`Null origin request without ingestionSecret for ${shop.shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_secret_null_origin" },
            { status: 403, request, shopAllowedDomains }
          );
        }
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
          originType: isNullOrigin ? "null_origin_no_signature" : "production_required",
        });
        logger.error(`Missing HMAC signature for ${shop.shopDomain} in production - rejecting`);
        if (isNullOrigin) {
          logger.error(`Null origin request without HMAC signature for ${shop.shopDomain} in production - rejecting`);
          return jsonWithCors(
            { error: "Missing signature", errorCode: "missing_signature_null_origin" },
            { status: 403, request, shopAllowedDomains }
          );
        }
        return jsonWithCors(
          { error: "Missing signature", errorCode: "missing_signature" },
          { status: 403, request, shopAllowedDomains }
        );
      }
      const verifyWithSecret = async (secret: string) => {
        const result = await validatePixelEventHMAC(
          request,
          bodyText,
          secret,
          payload.timestamp,
          TIMESTAMP_WINDOW_MS
        );
        return result.valid;
      };
      const graceResult = await verifyWithGraceWindowAsync(shop, verifyWithSecret);
      const hmacValid = graceResult.matched;
      const usedPreviousSecret = graceResult.usedPreviousSecret;
      if (hmacValid) {
        hmacValidationResult = { valid: true };
      }
      if (!hmacValid) {
        const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
        if (anomalyCheck.shouldBlock) {
          logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
        }
        metrics.pixelRejection({
          shopDomain: shop.shopDomain,
          reason: "invalid_key",
          originType: "unknown",
        });
        logger.error(`HMAC verification failed for ${shop.shopDomain} in production: both current and previous secrets failed`);
        return jsonWithCors(
          { error: "Invalid signature", errorCode: "invalid_signature" },
          { status: 403, request, shopAllowedDomains }
        );
      }
      if (isNullOrigin) {
        const allowNullOrigin = process.env.PIXEL_ALLOW_NULL_ORIGIN === "true" || process.env.PIXEL_ALLOW_NULL_ORIGIN === "1";
        if (allowNullOrigin) {
          logger.debug(`Null origin request accepted with valid HMAC and ingestionSecret for ${shop.shopDomain} in production (PIXEL_ALLOW_NULL_ORIGIN=true)`);
        } else {
          logger.warn(`Null origin request accepted but PIXEL_ALLOW_NULL_ORIGIN not set for ${shop.shopDomain} - this may cause issues in production`);
        }
      } else {
        logger.debug(`HMAC signature verified for ${shop.shopDomain} in production${usedPreviousSecret ? " (using previous secret)" : ""}`);
      }
    } else if (shop.ingestionSecret && signature) {
      const verifyWithSecret = async (secret: string) => {
        const result = await validatePixelEventHMAC(
          request,
          bodyText,
          secret,
          payload.timestamp,
          TIMESTAMP_WINDOW_MS
        );
        return result.valid;
      };
      const graceResult = await verifyWithGraceWindowAsync(shop, verifyWithSecret);
      if (graceResult.matched) {
        hmacValidationResult = { valid: true };
        logger.debug(`HMAC signature verified in dev mode for ${shop.shopDomain}${graceResult.usedPreviousSecret ? " (using previous secret)" : ""}`);
      } else {
        hmacValidationResult = { valid: false, reason: "HMAC verification failed" };
        logger.warn(`HMAC verification failed in dev mode for ${shop.shopDomain}: both current and previous secrets failed`);
        logger.warn(`⚠️ This request would be rejected in production. Please ensure HMAC signature is valid.`);
      }
    }
    const pixelConfigs = shop.pixelConfigs;
    let mode: "purchase_only" | "full_funnel" = "purchase_only";
    let purchaseStrategy: "server_side_only" | "hybrid" = "hybrid";
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
    evaluateTrustLevel(keyValidation, !!payload.data.checkoutToken);
    metrics.pxIngestAccepted(shop.shopDomain);
    const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
    const isPurchaseEvent = eventType === "purchase";
    const orderId = payload.data.orderId || payload.data.checkoutToken || null;
    const eventIdentifier = orderId || `session_${payload.timestamp}_${shop.shopDomain.replace(/\./g, "_")}`;
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
    let riskScore: number | undefined;
    let assetCount: number | undefined;
    try {
      const latestScan = await prisma.scanReport.findFirst({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        select: { riskScore: true },
      });
      if (latestScan) {
        riskScore = latestScan.riskScore;
        const assets = await prisma.auditAsset.count({
          where: { shopId: shop.id },
        });
        assetCount = assets;
      }
    } catch (error) {
    }
    const planId = normalizePlanId(shopWithPlan?.plan ?? "free");
    const isAgency = isPlanAtLeast(planId, "agency");
    safeFireAndForget(
      trackEvent({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        event: "px_event_received",
        eventId: `px_event_received_${eventId}`,
        metadata: {
          pixel_event_name: payload.eventName,
          pixel_event_id: eventId,
          plan: shopWithPlan?.plan ?? "free",
          role: isAgency ? "agency" : "merchant",
          destination_type: pixelConfigs.length > 0 ? pixelConfigs[0].platform : "none",
          environment: environment,
          risk_score: riskScore,
          asset_count: assetCount,
        },
      })
    );
    const clientSideConfigs = pixelConfigs.filter(config => config.clientSideEnabled === true);
    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      clientSideConfigs,
      consentResult
    );
    if (isPurchaseEvent) {
      const activeVerificationRun = await prisma.verificationRun.findFirst({
        where: {
          shopId: shop.id,
          status: "running",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : pixelConfigs.length > 0 ? pixelConfigs[0].platform : null;
      await upsertPixelEventReceipt(
        shop.id,
        eventId,
        payload,
        origin,
        eventType,
        activeVerificationRun?.id || null,
        primaryPlatform || null,
        orderId
      );
    } else {
      logger.debug(`Non-purchase event ${payload.eventName} - skipping receipt`, {
        shopId: shop.id,
        eventName: payload.eventName,
        eventId,
      });
    }
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
          logger.info(`Purchase event recorded for verification`, {
            shopId: shop.id,
            eventId,
            platforms: platformNames,
          });
          logger.debug(`Purchase event ${eventId} recorded`, {
            shopId: shop.id,
            platforms: platformNames,
          });
        } else {
          logger.debug(`Purchase event ${eventId} recorded`, {
            shopId: shop.id,
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
        logger.info(`Event ${payload.eventName} recorded`, {
          shopId: shop.id,
          eventId,
          eventName: payload.eventName,
          platforms: platformNames,
        });
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
        trusted: true,
        consent: payload.consent || null,
      },
      { request, shopAllowedDomains }
    );
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonWithCors(
    {
      status: "ok",
      endpoint: "ingest",
      message: "This is the only pixel event ingestion endpoint. Use POST /ingest to send pixel events.",
    },
    { request }
  );
};
