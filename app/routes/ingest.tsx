import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { jsonWithCors, getCorsHeadersPreBody, emptyResponseWithCors, optionsResponse } from "~/lib/pixel-events/cors";
import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger, metrics } from "~/utils/logger.server";
import { appMetrics } from "~/utils/metrics-collector";
import { getShopForPixelVerificationWithConfigs } from "~/lib/pixel-events/key-validation";
import { validatePixelEventHMAC } from "~/lib/pixel-events/hmac-validation";
import { verifyWithGraceWindowAsync } from "~/utils/shop-access";
import { validateRequest, isPrimaryEvent } from "~/lib/pixel-events/validation";
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
} from "~/lib/pixel-events/receipt-handler";
import type { KeyValidationResult } from "~/lib/pixel-events/types";
import { checkInitialConsent, filterPlatformsByConsent, logConsentFilterMetrics } from "~/lib/pixel-events/consent-filter";
import { trackAnomaly } from "~/utils/rate-limiter";
import { checkRateLimitAsync, shopDomainIpKeyExtractor, ipKeyExtractor } from "~/middleware/rate-limit";
import { safeFireAndForget } from "~/utils/helpers.server";
import { trackEvent } from "~/services/analytics.server";
import { normalizePlanId } from "~/services/billing/plans";
import { isPlanAtLeast } from "~/utils/plans";
import { hashValueSync } from "~/utils/crypto.server";
import { sanitizePII } from "~/services/event-log.server";
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
  
  const preBodyValidation = validatePixelOriginPreBody(origin, hasSignatureHeader, originHeaderPresent);
  if (!preBodyValidation.valid) {
    const shopDomainHeader = request.headers.get("x-shopify-shop-domain") || "unknown";
    const anomalyCheck = trackAnomaly(shopDomainHeader, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shopDomainHeader}: ${anomalyCheck.reason}`);
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
  const timestamp = batchTimestamp || firstPayload.timestamp;
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
    hasSignatureHeaderOrHMAC: hasSignatureHeader,
  });
  if (!shopOriginValidation.valid && shopOriginValidation.shouldReject) {
    const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_origin");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
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
      return result.valid;
    };
    const graceResult = await verifyWithGraceWindowAsync(shop, verifyWithSecret);
    if (graceResult.matched) {
      keyValidation = {
        matched: true,
        reason: "hmac_verified",
        usedPreviousSecret: graceResult.usedPreviousSecret,
      };
      logger.debug(`HMAC signature verified for ${shopDomain}${graceResult.usedPreviousSecret ? " (using previous secret)" : ""}`);
    } else {
      keyValidation = {
        matched: false,
        reason: "hmac_invalid",
      };
      logger.warn(`HMAC verification failed for ${shopDomain}: signature did not match current or previous secret`);
    }
  } else if (signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
    };
    logger.warn(`HMAC signature received for ${shopDomain} but ingestion secret is missing`);
  } else if (signature) {
    keyValidation = {
      matched: false,
      reason: "signature_present_no_secret",
    };
  } else if (!signature && allowUnsignedEvents) {
    keyValidation = {
      matched: true,
      reason: "signature_skipped_env",
    };
  } else if (!signature && !hasAnySecret) {
    keyValidation = {
      matched: false,
      reason: "secret_missing",
    };
  } else if (!signature) {
    keyValidation = {
      matched: false,
      reason: "signature_missing",
    };
  }
  if (isProduction && !keyValidation.matched) {
    const rejectionReason = keyValidation.reason === "secret_missing"
      ? "no_ingestion_key"
      : "invalid_key";
    metrics.pixelRejection({
      shopDomain,
      reason: rejectionReason,
    });
    logger.warn(`Rejected ingest request for ${shopDomain}`, {
      reason: keyValidation.reason,
    });
    const status = keyValidation.reason === "secret_missing" ? 409 : 401;
    const errorMessage = keyValidation.reason === "secret_missing"
      ? "Ingestion secret not configured"
      : "Invalid signature";
    return jsonWithCors({ error: errorMessage }, { status, request });
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
  const validatedEvents: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }> = [];
  const serverSideConfigs = pixelConfigs.filter(config => config.serverSideEnabled === true);
  let activeVerificationRunId: string | null | undefined = undefined;
  for (let i = 0; i < events.length; i++) {
    const eventValidation = validateRequest(events[i]);
    if (!eventValidation.valid) {
      logger.warn(`Invalid event at index ${i} in batch`, {
        shopDomain,
        error: eventValidation.error,
      });
      continue;
    }
    const rawPayload = eventValidation.payload;
    const payload = sanitizePII(rawPayload) as PixelEventPayload;
    if (payload.shopDomain !== shopDomain) {
      logger.warn(`Event at index ${i} has different shopDomain`, {
        expected: shopDomain,
        actual: payload.shopDomain,
      });
      continue;
    }
    const now = Date.now();
    const eventTimeDiff = Math.abs(now - payload.timestamp);
    if (eventTimeDiff > TIMESTAMP_WINDOW_MS) {
      logger.debug(`Event at index ${i} timestamp outside window: diff=${eventTimeDiff}ms, skipping`, {
        shopDomain,
        eventTimestamp: payload.timestamp,
        currentTime: now,
        windowMs: TIMESTAMP_WINDOW_MS,
      });
      continue;
    }
    if (!isPrimaryEvent(payload.eventName, mode)) {
      logger.debug(`Event ${payload.eventName} at index ${i} not accepted for ${shopDomain} (mode: ${mode}) - skipping`);
      continue;
    }
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
        const alreadyRecorded = await isClientEventRecorded(shop.id, orderId, eventType, shopDomain);
        if (alreadyRecorded) {
          const orderIdHash = hashValueSync(orderId).slice(0, 12);
          logger.debug(`Purchase event already recorded for order ${orderIdHash}, skipping`, {
            shopId: shop.id,
            orderIdHash,
            eventType,
          });
          continue;
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
          const orderIdHash = hashValueSync(orderId).slice(0, 12);
          logger.debug(`Replay detected for order ${orderIdHash}, skipping`, {
            shopId: shop.id,
            orderIdHash,
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
        const checkoutTokenHash = hashValueSync(checkoutToken);
        orderId = `checkout_${checkoutTokenHash}`;
        eventIdentifier = orderId;
      } else {
        orderId = `session_${payload.timestamp}_${shopDomain.replace(/\./g, "_")}`;
        eventIdentifier = null;
      }
    }
    const eventId = generateEventIdForType(
      eventIdentifier,
      eventType,
      shopDomain,
      payload.data.checkoutToken,
      normalizedItems.length > 0 ? normalizedItems : undefined,
      payload.nonce ?? null
    );
    const consentResult = checkInitialConsent(payload.consent);
    const { platformsToRecord, skippedPlatforms } = filterPlatformsByConsent(
      serverSideConfigs,
      consentResult
    );
    const destinations = platformsToRecord.map(p => p.platform);
    if (isPurchaseEvent && orderId) {
      if (activeVerificationRunId === undefined) {
        const run = await prisma.verificationRun.findFirst({
          where: { shopId: shop.id, status: "running" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        activeVerificationRunId = run?.id ?? null;
      }
      logConsentFilterMetrics(
        shopDomain,
        orderId,
        platformsToRecord,
        skippedPlatforms,
        consentResult
      );
      try {
        const primaryPlatform = platformsToRecord.length > 0 ? platformsToRecord[0].platform : null;
        await upsertPixelEventReceipt(
          shop.id,
          eventId,
          payload,
          origin,
          eventType,
          activeVerificationRunId ?? null,
          primaryPlatform || null,
          orderId || null
        );
      } catch (error) {
        const orderIdHash = orderId ? hashValueSync(orderId).slice(0, 12) : null;
        logger.warn(`Failed to write receipt for purchase event at index ${i}`, {
          shopId: shop.id,
          orderIdHash,
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
  const PROCESSING_TIMEOUT_MS = 10000;
  const processingPromise = processBatchEvents(shop.id, validatedEvents, environment).then((results) => {
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    logger.info(`Batch ingest processed`, {
      shopDomain,
      total: validatedEvents.length,
      accepted: successCount,
      errors: errorCount,
    });
    return results;
  });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Processing timeout"));
    }, PROCESSING_TIMEOUT_MS);
  });
  Promise.race([processingPromise, timeoutPromise]).catch((error) => {
    logger.warn(`Batch ingest processing timeout or error`, {
      shopDomain,
      shopId: shop.id,
      total: validatedEvents.length,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return jsonWithCors(
    {
      accepted_count: validatedEvents.length,
      errors: [],
    },
    { request }
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
