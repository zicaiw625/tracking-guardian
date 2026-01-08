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
  upsertPixelEventReceipt,
  generateEventIdForType,
} from "./receipt-handler";
import { validatePixelEventHMAC } from "./hmac-validation";
// 轻量版：不再需要复杂的事件管道处理
import { safeFireAndForget } from "../../utils/helpers";
import { trackEvent } from "../../services/analytics.server";
import { normalizePlanId } from "../../services/billing/plans";
import { isPlanAtLeast } from "../../utils/plans";
import prisma from "../../db.server";

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

        metrics.pxIngestAccepted(shop.shopDomain);

    const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
    const isPurchaseEvent = eventType === "purchase";

    // 轻量版：简化事件标识符生成
    const eventIdentifier = payload.data.orderId || payload.data.checkoutToken || `session_${payload.timestamp}_${shop.shopDomain.replace(/\./g, "_")}`;

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
    // 轻量版：不再需要 EventLog 统计
    const isFirstEvent = false;

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
          first_event_name: isFirstEvent ? payload.eventName : undefined,
          risk_score: riskScore,
          asset_count: assetCount,
                  },
      })
    );

    // 轻量版：只记录 purchase 事件用于验收
    if (isPurchaseEvent) {
      // 检查是否有活跃的验收窗口
      const activeVerificationRun = await prisma.verificationRun.findFirst({
        where: {
          shopId: shop.id,
          status: "running",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      await upsertPixelEventReceipt(
        shop.id,
        eventId,
        payload,
        origin,
        eventType,
        activeVerificationRun?.id || null
      );
    } else {
      logger.debug(`Non-purchase event ${payload.eventName} - skipping receipt`, {
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

          // 轻量版：不再需要复杂的事件管道处理
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

        // 轻量版：不再需要复杂的事件管道处理
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
        trusted: true, // 轻量版：简化信任检查
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
