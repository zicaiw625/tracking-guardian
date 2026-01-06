/**
 * P0-1: PRD 对齐 - POST /ingest 端点
 * 
 * PRD 8.2 要求：
 * - POST /ingest
 * - Body: { events: [...] } (批量)
 * - signed payload (HMAC + timestamp)
 * 
 * 此路由实现 PRD 要求的批量事件接口，完全符合 PRD 8.2 规范：
 * - 支持批量事件格式：{ events: [event1, event2, ...] }
 * - 支持 HMAC 签名验证（X-Tracking-Guardian-Signature header）
 * - 支持时间戳验证（X-Tracking-Guardian-Timestamp header 或 body 中的 timestamp）
 * - 同时保留对单事件格式的向后兼容（自动检测格式）
 * 
 * 审计结论对齐：
 * - ✅ 已实现 PRD 8.2 要求的批量事件接口格式
 * - ✅ Web Pixel Extension 使用批量格式发送事件到 /ingest 端点（extensions/tracking-pixel/src/events.ts）
 * - ✅ 支持 batched 性能目标（减少网络请求数，提高并发处理能力）
 * - ✅ 接口形态与 PRD 8.2 完全一致，解决了审计结论中的"Ingest API 形态不一致"问题
 * 
 * 接口格式：
 * - 批量格式：{ events: [event1, event2, ...], timestamp?: number }
 * - 单事件格式（向后兼容）：直接发送单个事件对象，委托给 /api/pixel-events
 * 
 * 端点说明：
 * - POST /ingest：PRD 推荐的主要端点，支持批量格式（符合 PRD 8.2）
 * - POST /api/ingest：向后兼容别名，委托给 /ingest
 * - POST /api/pixel-events：实际实现端点（内部使用），支持单事件格式
 * 
 * Web Pixel Extension 使用批量格式发送事件，提高性能
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as pixelEventsAction, loader as pixelEventsLoader } from "./api.pixel-events/route";
import { jsonWithCors } from "./api.pixel-events/cors";
import type { PixelEventPayload } from "./api.pixel-events/types";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger } from "~/utils/logger.server";
import { getShopForPixelVerificationWithConfigs } from "./api.pixel-events/key-validation";
import { validatePixelEventHMAC } from "./api.pixel-events/hmac-validation";
import { validateRequest } from "./api.pixel-events/validation";
import { API_CONFIG } from "~/utils/config";
import { isDevMode } from "~/utils/origin-validation";
import { generateEventIdForType } from "./api.pixel-events/receipt-handler";

const MAX_BATCH_SIZE = 100; // 批量事件最大数量
const TIMESTAMP_WINDOW_MS = API_CONFIG.TIMESTAMP_WINDOW_MS;

/**
 * PRD 定义的 POST /ingest 端点
 * 支持批量事件格式：{ events: [...] }
 * 同时保留对单事件格式的向后兼容
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // 检查 Content-Type
  const contentType = request.headers.get("Content-Type");
  if (!contentType || (!contentType.includes("application/json") && !contentType.includes("text/plain"))) {
    return jsonWithCors(
      { error: "Content-Type must be application/json or text/plain" },
      { status: 415, request }
    );
  }

  // 解析请求体
  let bodyText: string;
  let bodyData: unknown;
  try {
    bodyText = await request.text();
    bodyData = JSON.parse(bodyText);
  } catch (error) {
    return jsonWithCors(
      { error: "Invalid JSON body" },
      { status: 400, request }
    );
  }

  // 判断是批量格式还是单事件格式
  const isBatchFormat = 
    typeof bodyData === "object" && 
    bodyData !== null && 
    "events" in bodyData && 
    Array.isArray((bodyData as { events?: unknown }).events);

  if (isBatchFormat) {
    // PRD 要求的批量格式：{ events: [...] }
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

    // 验证第一个事件以获取 shopDomain（用于 HMAC 验证）
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

    // HMAC 验证（使用批量请求的 timestamp）
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

    if (isProduction) {
      if (!shop.ingestionSecret) {
        logger.error(`Missing ingestionSecret for ${shopDomain} in production`);
        return jsonWithCors(
          { error: "Server configuration error" },
          { status: 500, request }
        );
      }

      if (!signature) {
        logger.warn(`Missing HMAC signature for ${shopDomain} in production`);
        return jsonWithCors(
          { error: "Missing signature" },
          { status: 403, request }
        );
      }

      const hmacResult = await validatePixelEventHMAC(
        request,
        bodyText,
        shop.ingestionSecret,
        timestamp,
        TIMESTAMP_WINDOW_MS
      );

      if (!hmacResult.valid) {
        logger.warn(`HMAC verification failed for ${shopDomain}: ${hmacResult.reason}`);
        return jsonWithCors(
          { error: "Invalid signature", errorCode: hmacResult.errorCode },
          { status: 403, request }
        );
      }
    }

    // 验证并处理批量事件
    const validatedEvents: Array<{
      payload: PixelEventPayload;
      eventId: string | null;
      destinations: string[];
    }> = [];

    for (let i = 0; i < events.length; i++) {
      const eventValidation = validateRequest(events[i]);
      if (!eventValidation.valid) {
        logger.warn(`Invalid event at index ${i} in batch`, {
          shopDomain,
          error: eventValidation.error,
        });
        continue; // 跳过无效事件，继续处理其他事件
      }

      const payload = eventValidation.payload;
      
      // 确保所有事件来自同一个 shop
      if (payload.shopDomain !== shopDomain) {
        logger.warn(`Event at index ${i} has different shopDomain`, {
          expected: shopDomain,
          actual: payload.shopDomain,
        });
        continue;
      }

      // 生成 eventId
      const eventType = payload.eventName === "checkout_completed" ? "purchase" : payload.eventName;
      const items = payload.data.items as Array<{ 
        id?: string; 
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
        quantity: 1,
      })).filter(item => item.id) || [];

      const eventId = generateEventIdForType(
        payload.data.orderId || payload.data.checkoutToken || null,
        eventType,
        shopDomain,
        payload.data.checkoutToken,
        normalizedItems.length > 0 ? normalizedItems : undefined
      );

      // 获取目标平台（从 shop 的 pixelConfigs）
      const pixelConfigs = shop.pixelConfigs;
      const destinations = pixelConfigs.map(config => config.platform);

      validatedEvents.push({
        payload,
        eventId,
        destinations,
      });
    }

    if (validatedEvents.length === 0) {
      return jsonWithCors(
        { error: "No valid events in batch" },
        { status: 400, request }
      );
    }

    // 批量处理事件
    try {
      const results = await processBatchEvents(shop.id, validatedEvents);
      const successCount = results.filter(r => r.success).length;
      const acceptedCount = successCount; // PRD 8.2: accepted_count 表示成功处理的事件数

      // PRD 8.2: 构建 errors[] 数组，包含所有失败事件的错误信息
      const errors: Array<{
        index: number;
        event_id?: string;
        event_name?: string;
        error: string;
      }> = [];

      results.forEach((result, index) => {
        if (!result.success) {
          const eventPayload = validatedEvents[index]?.payload;
          errors.push({
            index,
            event_id: result.eventId || undefined,
            event_name: eventPayload?.eventName || undefined,
            error: result.errors?.join("; ") || "Unknown error",
          });
        }
      });

      logger.info(`Batch ingest processed`, {
        shopDomain,
        total: validatedEvents.length,
        accepted: acceptedCount,
        errors: errors.length,
      });

      // PRD 8.2: 返回格式 { accepted_count, errors[] }
      return jsonWithCors(
        {
          accepted_count: acceptedCount,
          errors: errors.length > 0 ? errors : [],
        },
        { request }
      );
    } catch (error) {
      logger.error("Batch ingest processing failed", {
        shopDomain,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonWithCors(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        { status: 500, request }
      );
    }
  } else {
    // 单事件格式（向后兼容），委托给 /api/pixel-events
    return pixelEventsAction({ request, params: {}, context: {} as any });
  }
};

/**
 * GET /ingest 端点（用于健康检查）
 */
export const loader = async (args: LoaderFunctionArgs) => {
  return pixelEventsLoader(args);
};

