import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { jsonWithCors, emptyResponseWithCors, optionsResponse } from "~/lib/pixel-events/cors";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger, metrics } from "~/utils/logger.server";
import { API_CONFIG, RATE_LIMIT_CONFIG, isStrictSecurityMode } from "~/utils/config.server";
import { isDevMode, trackNullOriginRequest, validatePixelOriginPreBody, validatePixelOriginForShop, buildShopAllowedDomains } from "~/utils/origin-validation";
import { checkRateLimitAsync, shopDomainIpKeyExtractor, ipKeyExtractor } from "~/middleware/rate-limit";
import { safeFireAndForget } from "~/utils/helpers.server";
import { hashValueSync } from "~/utils/crypto.server";
import { trackAnomaly } from "~/utils/rate-limiter";
import { getShopForPixelVerificationWithConfigs } from "~/lib/pixel-events/key-validation";
import type { KeyValidationResult, PixelEventPayload } from "~/lib/pixel-events/types";
import { validateRequest } from "~/lib/pixel-events/validation";
import { validatePixelEventHMAC } from "~/lib/pixel-events/hmac-validation";
import { verifyWithGraceWindowAsync } from "~/utils/shop-access.server";
import { validateEvents, normalizeEvents, deduplicateEvents, distributeEvents } from "~/lib/pixel-events/ingest-pipeline.server";
import { readTextWithLimit } from "~/utils/body-reader";

const MAX_BATCH_SIZE = 100;
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;
const INGEST_RATE_LIMIT = RATE_LIMIT_CONFIG.PIXEL_EVENTS;

function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes("text/plain") || lower.includes("application/json");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return optionsResponse(request);
  }
  if (request.method !== "POST") {
    return jsonWithCors({ error: "Method not allowed" }, { status: 405, request });
  }
  const ipKey = ipKeyExtractor(request);
  const ipRateLimit = await checkRateLimitAsync(ipKey, 200, 60 * 1000);
  if (!ipRateLimit.allowed) {
    const ipHash = ipKey === "untrusted" || ipKey === "unknown" ? ipKey : hashValueSync(ipKey).slice(0, 12);
    logger.warn(`IP rate limit exceeded for ingest`, {
      ipHash,
      retryAfter: ipRateLimit.retryAfter,
    });
    return jsonWithCors(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: ipRateLimit.retryAfter,
      },
      {
        status: 429,
        request,
        headers: {
          "Retry-After": String(ipRateLimit.retryAfter || 60),
          "X-RateLimit-Limit": "200",
          "X-RateLimit-Remaining": String(ipRateLimit.remaining || 0),
          "X-RateLimit-Reset": String(Math.ceil((ipRateLimit.resetAt || Date.now()) / 1000)),
        },
      }
    );
  }
  const originHeaderPresent = request.headers.has("Origin");
  const origin = originHeaderPresent ? request.headers.get("Origin") : null;
  const isNullOrigin = origin === "null" || origin === null;
  const isProduction = !isDevMode();
  const allowUnsignedEvents = isProduction ? false : process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true";
  const signature = request.headers.get("X-Tracking-Guardian-Signature");
  const strictOrigin = (() => {
    const value = process.env.PIXEL_STRICT_ORIGIN?.toLowerCase().trim();
    return value === "true" || value === "1" || value === "yes";
  })();
  const contentType = request.headers.get("Content-Type");
  if (!isAcceptableContentType(contentType)) {
    return jsonWithCors(
      { error: "Content-Type must be text/plain or application/json" },
      { status: 415, request }
    );
  }
  const hasSignatureHeader = !!signature;
  
  if (!originHeaderPresent && isProduction) {
    const referer = request.headers.get("Referer");
    if (!referer) {
      const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
      logger.warn(
        `Origin header completely missing in production (no Origin, no Referer) for ${shopDomainHeader}`
      );
      metrics.pixelRejection({
        shopDomain: shopDomainHeader,
        reason: "invalid_origin",
        originType: "missing_origin",
      });
      return jsonWithCors({ error: "Invalid origin" }, { status: 403, request });
    }
  }
  
  const preBodyValidation = validatePixelOriginPreBody(origin, hasSignatureHeader, originHeaderPresent);
  if (!preBodyValidation.valid) {
    const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${shopDomainHeader}: ${anomalyCheck.reason}`);
    }
    if (preBodyValidation.shouldLog) {
      logger.warn(
        `Origin validation warning at Stage 1 in /ingest: ${origin?.substring(0, 100) || "null"}, ` +
          `reason: ${preBodyValidation.reason}`
      );
    }
    if (preBodyValidation.shouldReject && (isProduction || !hasSignatureHeader || strictOrigin)) {
      metrics.pixelRejection({
        shopDomain: shopDomainHeader,
        reason: preBodyValidation.reason as "invalid_origin" | "invalid_origin_protocol",
        originType: preBodyValidation.reason,
      });
      return jsonWithCors({ error: "Invalid origin" }, { status: 403, request });
    }
  }
  if (isNullOrigin) {
    trackNullOriginRequest();
  }
  const timestampHeader = request.headers.get("X-Tracking-Guardian-Timestamp");
  const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
  if (timestampHeader) {
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Anomaly threshold reached for ${shopDomainHeader}: ${anomalyCheck.reason}`);
      }
      logger.debug("Invalid timestamp format in header, dropping request");
      return emptyResponseWithCors(request);
    }
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > TIMESTAMP_WINDOW_MS) {
      const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_timestamp");
      if (anomalyCheck.shouldBlock) {
        logger.warn(`Anomaly threshold reached for ${shopDomainHeader}: ${anomalyCheck.reason}`);
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
    bodyText = await readTextWithLimit(request, API_CONFIG.MAX_BODY_SIZE);
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    if (error instanceof Response) {
      if (error.status === 413) {
        return jsonWithCors(
          { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
          { status: 413, request }
        );
      }
      return jsonWithCors(
        { error: "Failed to read request body" },
        { status: 400, request }
      );
    }
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
  let events: unknown[];
  let batchTimestamp: number | undefined;
  if (isBatchFormat) {
    const batchData = bodyData as { events: unknown[]; timestamp?: number };
    events = batchData.events || [];
    batchTimestamp = batchData.timestamp;
  } else {
    const singleEventValidation = validateRequest(bodyData);
    if (!singleEventValidation.valid) {
      logger.debug(
        `Pixel payload validation failed: code=${singleEventValidation.code}, error=${singleEventValidation.error}`
      );
      return jsonWithCors({ error: "Invalid request" }, { status: 400, request });
    }
    events = [bodyData];
    batchTimestamp = singleEventValidation.payload.timestamp;
  }
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
  const timestamp = batchTimestamp ?? firstPayload.timestamp;
  const nowForWindow = Date.now();
  if (Math.abs(nowForWindow - timestamp) > TIMESTAMP_WINDOW_MS) {
    logger.debug(
      `Payload timestamp outside window: diff=${Math.abs(nowForWindow - timestamp)}ms, dropping request`,
      { shopDomain }
    );
    return emptyResponseWithCors(request);
  }
  const rawEnvironment = (firstPayload.data as { environment?: string })?.environment;
  const environment = rawEnvironment === "test" || rawEnvironment === "live" ? rawEnvironment : "live";
  const shop = await getShopForPixelVerificationWithConfigs(shopDomain, environment);
  if (!shop || !shop.isActive) {
    if (isProduction) {
      logger.warn(`Shop not found or inactive for ingest`, {
        shopDomain,
        exists: !!shop,
        isActive: shop?.isActive,
      });
      return jsonWithCors(
        { error: "Invalid request" },
        { status: 401, request }
      );
    }
    return jsonWithCors(
      { error: "Shop not found or inactive" },
      { status: 401, request }
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
    hasSignatureHeaderOrHMAC: hasSignatureHeader,
  });
  if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
    const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Anomaly threshold reached for ${shop.shopDomain}: ${anomalyCheck.reason}`);
    }
    logger.warn(
      `Origin validation warning at Stage 2 in /ingest for ${shop.shopDomain}: ` +
        `origin=${origin?.substring(0, 100) || "null"}, referer=${referer?.substring(0, 100) || "null"}, reason=${shopOriginValidation.reason}`
    );
    if (hasSignatureHeader && !strictOrigin && !isProduction) {
      logger.warn(`Signed ingest request allowed despite origin rejection for ${shop.shopDomain}`, {
        origin: origin?.substring(0, 100) || "null",
        reason: shopOriginValidation.reason,
      });
    }
    if (!hasSignatureHeader || strictOrigin || isProduction) {
      metrics.pixelRejection({
        shopDomain: shop.shopDomain,
        reason: "origin_not_allowlisted",
        originType: shopOriginValidation.reason,
      });
      return jsonWithCors({ error: "Origin not allowlisted" }, { status: 403, request, shopAllowedDomains });
    }
  }
  let keyValidation: KeyValidationResult = {
    matched: false,
    reason: signature ? "hmac_not_verified" : "signature_missing",
    trustLevel: "untrusted",
  };
  const hasAnySecret = Boolean(shop.ingestionSecret || shop.previousIngestionSecret);
  if (signature && hasAnySecret) {
    const verifyWithSecret = async (secret: string) => {
      const result = await validatePixelEventHMAC(
        request,
        bodyText,
        secret,
        shopDomain,
        timestamp,
        TIMESTAMP_WINDOW_MS
      );
      return result;
    };
    const graceResult = await verifyWithGraceWindowAsync(shop, async (secret: string) => {
      const result = await verifyWithSecret(secret);
      return result.valid;
    });
    if (graceResult.matched) {
      const hmacResult = await verifyWithSecret(graceResult.usedPreviousSecret ? shop.previousIngestionSecret! : shop.ingestionSecret!);
      keyValidation = {
        matched: true,
        reason: "hmac_verified",
        usedPreviousSecret: graceResult.usedPreviousSecret,
        trustLevel: hmacResult.trustLevel || "trusted",
      };
      logger.debug(`HMAC signature verified for ${shopDomain}${graceResult.usedPreviousSecret ? " (using previous secret)" : ""}`);
    } else {
      const secretToCheck = shop.ingestionSecret ?? shop.previousIngestionSecret;
      if (!secretToCheck) {
        keyValidation = {
          matched: false,
          reason: "secret_missing",
          trustLevel: "untrusted",
        };
        logger.warn(`HMAC verification failed for ${shopDomain}: no ingestion secret available`);
      } else {
        const hmacResult = await verifyWithSecret(secretToCheck);
        keyValidation = {
          matched: false,
          reason: "hmac_invalid",
          trustLevel: hmacResult.trustLevel || "untrusted",
        };
        if (isStrictSecurityMode()) {
          logger.warn(`HMAC verification failed for ${shopDomain}: signature did not match current or previous secret`);
        } else {
          logger.warn(`HMAC verification failed for ${shopDomain}: signature did not match (non-strict mode, marking as untrusted)`, {
            trustLevel: keyValidation.trustLevel,
          });
        }
      }
    }
  } else if (signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
    logger.warn(`HMAC signature received for ${shopDomain} but ingestion secret is missing`);
  } else if (!signature && allowUnsignedEvents) {
    keyValidation = {
      matched: true,
      reason: "signature_skipped_env",
      trustLevel: "partial",
    };
  } else if (!signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
      trustLevel: "untrusted",
    };
  } else if (!signature) {
    keyValidation = {
      matched: false,
      reason: "signature_missing",
      trustLevel: "untrusted",
    };
  }
  const originIsNullish = origin === null || origin === "null" || !originHeaderPresent;
  let hasValidOrigin: boolean;
  if (originIsNullish) {
    hasValidOrigin = keyValidation.matched;
  } else {
    hasValidOrigin = shopOriginValidation.valid || (!shopOriginValidation.shouldReject && hasSignatureHeader && !strictOrigin && !isProduction);
  }
  const hasValidTimestamp = timestampHeader && Math.abs(Date.now() - timestamp) <= TIMESTAMP_WINDOW_MS;
  const hasCriticalEvent = events.some((event: unknown) => {
    const eventValidation = validateRequest(event);
    return eventValidation.valid && eventValidation.payload.eventName === "checkout_completed";
  });
  const combinedTrustSignals = {
    originValid: hasValidOrigin,
    timestampValid: hasValidTimestamp,
    hmacMatched: keyValidation.matched,
    trustLevel: keyValidation.trustLevel,
  };
  if (isStrictSecurityMode()) {
    const requiresHMAC = hasCriticalEvent;
    if (requiresHMAC && !keyValidation.matched) {
      const rejectionReason = keyValidation.reason === "secret_missing"
        ? "no_ingestion_key"
        : "invalid_key";
      metrics.pixelRejection({
        shopDomain,
        reason: rejectionReason,
      });
      logger.warn(`Rejected critical event (checkout_completed) without valid HMAC for ${shopDomain}`, {
        reason: keyValidation.reason,
        trustSignals: combinedTrustSignals,
      });
      return jsonWithCors({ error: "Invalid signature" }, { status: 401, request });
    }
    if (hasSignatureHeader && hasAnySecret && !keyValidation.matched) {
      metrics.pixelRejection({
        shopDomain,
        reason: "invalid_key",
      });
      logger.warn(`Rejected ingest request: invalid HMAC signature for ${shopDomain} in strict mode`, {
        reason: keyValidation.reason,
        trustSignals: combinedTrustSignals,
      });
      return jsonWithCors({ error: "Invalid signature" }, { status: 401, request });
    }
    if (!hasValidOrigin && !keyValidation.matched) {
      metrics.pixelRejection({
        shopDomain,
        reason: "invalid_origin",
      });
      logger.warn(`Rejected ingest request: both origin and HMAC validation failed for ${shopDomain}`, {
        originValid: hasValidOrigin,
        hmacMatched: keyValidation.matched,
        reason: keyValidation.reason,
      });
      return jsonWithCors({ error: "Invalid request" }, { status: 403, request });
    }
    if (!hasValidTimestamp && !keyValidation.matched) {
      metrics.pixelRejection({
        shopDomain,
        reason: "invalid_timestamp",
      });
      logger.warn(`Rejected ingest request: both timestamp and HMAC validation failed for ${shopDomain}`, {
        timestampValid: hasValidTimestamp,
        hmacMatched: keyValidation.matched,
        reason: keyValidation.reason,
      });
      return jsonWithCors({ error: "Invalid request" }, { status: 403, request });
    }
  } else {
    if (!keyValidation.matched) {
      logger.warn(`HMAC validation failed but allowing request in non-strict mode`, {
        shopDomain,
        reason: keyValidation.reason,
        trustLevel: keyValidation.trustLevel,
      });
    }
  }
  const rateLimitKey = shopDomainIpKeyExtractor(request);
  const rateLimit = await checkRateLimitAsync(
    rateLimitKey,
    INGEST_RATE_LIMIT.maxRequests,
    INGEST_RATE_LIMIT.windowMs
  );
  if (!rateLimit.allowed) {
    logger.warn(`Rate limit exceeded for ingest`, {
      shopDomain,
      retryAfter: rateLimit.retryAfter,
      remaining: rateLimit.remaining,
    });
    const rateLimitResponse = jsonWithCors(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        request,
        headers: {
          "Retry-After": String(rateLimit.retryAfter || 60),
          "X-RateLimit-Limit": String(INGEST_RATE_LIMIT.maxRequests),
          "X-RateLimit-Remaining": String(rateLimit.remaining || 0),
          "X-RateLimit-Reset": String(Math.ceil((rateLimit.resetAt || Date.now()) / 1000)),
        },
      }
    );
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
        } else if (configMode === 'purchase_only') {
          mode = "purchase_only";
        }
      }
    }
  }
  const serverSideConfigs = pixelConfigs.filter((config: { serverSideEnabled?: boolean | null }) => config.serverSideEnabled === true);
  
  const validatedEvents = validateEvents(events, shopDomain, timestamp);
  const normalizedEvents = normalizeEvents(validatedEvents, shopDomain, mode);
  const deduplicatedEvents = await deduplicateEvents(normalizedEvents, shop.id, shopDomain);
  const processedEvents = await distributeEvents(
    deduplicatedEvents,
    shop.id,
    shopDomain,
    serverSideConfigs,
    keyValidation,
    origin,
    undefined
  );
  
  const validatedEventsForPipeline: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }> = processedEvents.map(event => ({
    payload: event.payload,
    eventId: event.eventId,
    destinations: event.destinations,
  }));
  if (validatedEventsForPipeline.length === 0) {
    logger.debug(`All events filtered for ${shopDomain} (mode: ${mode}) - returning empty accepted_count`);
    return jsonWithCors(
      {
        accepted_count: 0,
        errors: [],
      },
      { request }
    );
  }
  const persistResults = await processBatchEvents(shop.id, validatedEventsForPipeline, environment, { persistOnly: true });
  const persistedCount = persistResults.filter((r) => r.success).length;
  if (persistedCount < validatedEventsForPipeline.length) {
    logger.error("Failed to persist some ingest events", undefined, {
      shopDomain,
      shopId: shop.id,
      total: validatedEventsForPipeline.length,
      persisted: persistedCount,
    });
    return jsonWithCors(
      {
        error: "Failed to persist events",
        accepted_count: persistedCount,
        errors: ["persist_failed"],
      },
      { status: 500, request }
    );
  }
  const PROCESSING_TIMEOUT_MS = 10000;
  const processingPromise = processBatchEvents(shop.id, validatedEventsForPipeline, environment).then((results) => {
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    logger.info(`Batch ingest processed`, {
      shopDomain,
      total: validatedEventsForPipeline.length,
      accepted: successCount,
      errors: errorCount,
    });
    return results;
  });
  const timeoutId = setTimeout(() => {
    logger.warn(`Batch ingest processing taking longer than ${PROCESSING_TIMEOUT_MS}ms`, {
      shopDomain,
      shopId: shop.id,
      total: validatedEventsForPipeline.length,
    });
  }, PROCESSING_TIMEOUT_MS);
  safeFireAndForget(processingPromise.finally(() => clearTimeout(timeoutId)), {
    operation: "Batch ingest processing",
    metadata: { shopDomain, shopId: shop.id, total: validatedEventsForPipeline.length },
  });
  return jsonWithCors(
    {
      accepted_count: persistedCount,
      errors: [],
    },
    { status: 202, request }
  );
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
