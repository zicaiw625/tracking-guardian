

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
import { processEventPipeline } from "../../services/events/pipeline.server";

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

    // P0-02: 确定事件模式 - 优先从 pixelConfigs 读取，默认使用 full_funnel
    // PRD 期望：像素迁移应直接覆盖 purchase 事件，因此默认使用 hybrid 策略
    // hybrid = client-side + server-side 双重发送，通过 event_id 去重
    // 
    // P0-3: 多目的地配置支持
    // pixelConfigs 可能包含多个同平台配置（通过 platformId 区分），
    // 所有配置都会被处理，支持多目的地场景（Agency/多品牌/多像素）
    // 例如：同一店铺可以配置多个 GA4 property、多个 Meta Pixel 等
    const pixelConfigs = shop.pixelConfigs;
    let mode: "purchase_only" | "full_funnel" = "full_funnel";
    let purchaseStrategy: "server_side_only" | "hybrid" = "hybrid"; // 默认 hybrid 以符合 PRD 要求
    
    // 从所有配置中查找 mode 和 purchaseStrategy 设置（优先 full_funnel 和 hybrid）
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
    
    // 如果没有找到 purchaseStrategy 配置，保持默认 hybrid（符合 PRD 要求）
    // 如果没有找到任何配置，默认使用 full_funnel + hybrid
    if (pixelConfigs.length === 0) {
      mode = "full_funnel";
      purchaseStrategy = "hybrid";
    }

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
      // 对于非 purchase 事件，使用与 pipeline.server.ts 相同的逻辑：
      // 如果没有 checkoutToken，generateCanonicalEventId 会内部生成基于 timestamp 的 identifier
      // 这里我们只需要设置 orderId 用于 receipt 记录，eventId 会由 generateEventIdForType 生成
      const checkoutToken = payload.data.checkoutToken;
      if (checkoutToken) {
        orderId = checkoutToken;
        eventIdentifier = checkoutToken;
      } else {
        // 对于非 purchase 事件且没有 checkoutToken 的情况，使用 timestamp 作为临时 identifier
        // generateCanonicalEventId 会内部处理这种情况，生成一致的 eventId
        orderId = `session_${payload.timestamp}_${shop.shopDomain.replace(/\./g, "_")}`;
        // 传递 null，让 generateCanonicalEventId 内部生成 identifier（与 pipeline.server.ts 一致）
        eventIdentifier = null;
      }
    }

    // ============================================================================
    // 标准化 items 和生成 eventId：确保 client/server 端 event_id 生成的一致性
    // 
    // 关键点：
    // 1. client 端发送的 item.id 通常是 checkout.lineItems 的 id（variant_id）
    // 2. 为了与 pipeline.server.ts 保持一致，我们使用相同的逻辑：优先使用 variantId，否则使用 productId
    // 3. 这与 pipeline.server.ts 中的逻辑完全一致，确保同一笔订单在两条链路生成的 event_id 可预测一致
    // 4. 这确保了平台侧 dedup 能够正常工作（同一订单不会重复发送）
    // 
    // 注意：items 标准化逻辑必须与 pipeline.server.ts 中的逻辑完全一致：
    // - 优先级：variantId > variant_id > productId > product_id > id
    // - quantity 默认为 1，必须是整数
    // ============================================================================
    const items = payload.data.items as Array<{ 
      id?: string; 
      quantity?: number | string;
      variantId?: string;
      variant_id?: string;
      productId?: string;
      product_id?: string;
    }> | undefined;
    const normalizedItems = items?.map(item => {
      // 优先级：variantId > variant_id > productId > product_id > id
      // 这与 pipeline.server.ts 中的逻辑完全一致，确保 eventId 生成的一致性
      const itemId = String(
        item.variantId || 
        item.variant_id || 
        item.productId || 
        item.product_id || 
        item.id || 
        ""
      ).trim();
      
      // quantity 标准化：必须是整数，默认为 1
      // 这与 pipeline.server.ts 中的逻辑完全一致
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

    // 使用与 pipeline.server.ts 相同的 generateCanonicalEventId 逻辑生成 eventId
    // 这确保了 client/server 端 event_id 生成的一致性
    // 同一笔订单在 client 端（pixel）和 server 端（webhook）生成的 event_id 应该一致
    const eventId = generateEventIdForType(
      eventIdentifier || null, // 如果没有 identifier，传递 null，generateCanonicalEventId 会内部处理
      eventType,
      shop.shopDomain,
      payload.data.checkoutToken,
      normalizedItems.length > 0 ? normalizedItems : undefined
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

    // P0-4/P1-01: 多事件路由器 - 支持按 eventName 分类处理并路由到 destinations
    // purchase 事件根据 purchaseStrategy 配置决定处理方式：
    // - hybrid（默认，符合 PRD 要求）：同时通过 client-side 和 server-side 发送，通过 event_id 去重
    //   * client-side：Web Pixel Extension 发送 purchase 事件到 /ingest 端点
    //   * server-side：orders/paid webhook 触发 CAPI 发送（作为兜底和增强）
    //   * 去重机制：使用相同的 event_id 生成逻辑，确保同一订单不会重复发送
    // - server_side_only：仅通过 webhook 处理（CAPI 发送），不处理 client-side purchase 事件
    //   注意：此模式不符合 PRD 的"像素迁移应直接覆盖 purchase 事件"要求，仅用于特殊场景
    if (platformsToRecord.length > 0) {
      if (isPurchaseEvent) {
        if (purchaseStrategy === "hybrid") {
          // Hybrid 模式：client-side 也发送 purchase 事件，server-side 作为兜底
          // P0-3: 传递配置对象以支持多目的地（同一平台的多个配置）
          const platformNames = platformsToRecord.map(p => p.platform);
          logger.info(`Processing purchase event in hybrid mode (client-side + server-side)`, {
            shopId: shop.id,
            eventId,
            orderId,
            platforms: platformNames,
            configCount: platformsToRecord.length,
          });
          
          // 异步处理但不阻塞响应，记录发送结果
          // P0-3: 传递配置对象列表以支持多目的地
          processEventPipeline(shop.id, payload, eventId, platformsToRecord)
            .then((result) => {
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
            })
            .catch((error) => {
              logger.error(`Failed to process purchase event via client-side`, {
                shopId: shop.id,
                eventId,
                platforms: platformNames,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          
          // Server-side 也会通过 webhook 发送（作为兜底和去重保障）
          logger.debug(`Purchase event ${eventId} will also be sent via webhook (hybrid mode)`, {
            shopId: shop.id,
            orderId,
            platforms: platformNames,
          });
        } else {
          // Server-side only 模式：purchase 事件仅由 webhook handler 处理 CAPI 发送
          logger.debug(`Purchase event ${eventId} queued for webhook processing (server-side only)`, {
            shopId: shop.id,
            orderId,
            platforms: platformsToRecord.map(p => p.platform),
            configCount: platformsToRecord.length,
          });
        }
      } else {
        // P0-02/P1-01: 非 purchase 事件（page_viewed, product_viewed, add_to_cart, checkout_started 等）
        // 通过事件管道处理，支持多平台路由并实际发送到 destinations
        // P0-3: 传递配置对象以支持多目的地（同一平台的多个配置）
        const platformNames = platformsToRecord.map(p => p.platform);
        logger.info(`Processing ${payload.eventName} event through pipeline for routing to destinations`, {
          shopId: shop.id,
          eventId,
          eventName: payload.eventName,
          platforms: platformNames,
          configCount: platformsToRecord.length,
          mode,
        });
        
        // 异步处理但不阻塞响应，记录发送结果
        // P0-3: 传递配置对象列表以支持多目的地
        processEventPipeline(shop.id, payload, eventId, platformsToRecord)
          .then((result) => {
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
          })
          .catch((error) => {
            logger.error(`Failed to process event pipeline for ${payload.eventName}`, {
              shopId: shop.id,
              eventId,
              eventName: payload.eventName,
              platforms: platformNames,
              error: error instanceof Error ? error.message : String(error),
            });
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
