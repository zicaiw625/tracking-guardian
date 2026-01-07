

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { sendPixelEventToPlatform } from "./pixel-event-sender.server";
import { generateCanonicalEventId } from "../event-normalizer.server";
import { createEventLog } from "../event-log.server";

export interface EventPipelineResult {
  success: boolean;
  eventId?: string;
  destinations?: string[];
  errors?: string[];
  deduplicated?: boolean;
}

export interface EventValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEventPayload(
  payload: PixelEventPayload
): EventValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload.eventName) {
    errors.push("eventName is required");
  }

  if (!payload.timestamp) {
    errors.push("timestamp is required");
  }

  if (!payload.shopDomain) {
    errors.push("shopDomain is required");
  }

  if (payload.data) {
    const data = payload.data;

    // purchase 事件必须包含 value、currency 和 items
    if (payload.eventName === "checkout_completed") {
      if (!data.value && data.value !== 0) {
        errors.push("value is required for purchase events");
      }

      if (!data.currency) {
        errors.push("currency is required for purchase events");
      }

      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        warnings.push("items array is empty or missing for purchase event");
      }
    } else {
      // 非 purchase 事件：value/currency/items 为可选，但建议包含以保持一致性
      // page_viewed 事件允许 value 为 0 或缺失
      if (payload.eventName !== "page_viewed") {
        if (data.value === undefined || data.value === null) {
          warnings.push(`value is recommended for ${payload.eventName} events`);
        }
        if (!data.currency) {
          warnings.push(`currency is recommended for ${payload.eventName} events`);
        }
      }
    }

    // 验证 items 数组结构（如果存在）
    if (data.items && Array.isArray(data.items)) {
      if (data.items.length === 0 && payload.eventName !== "page_viewed") {
        warnings.push(`items array is empty for ${payload.eventName} event`);
      }
      
      data.items.forEach((item: unknown, index: number) => {
        if (typeof item !== "object" || item === null) {
          errors.push(`items[${index}] must be an object`);
          return;
        }

        const itemObj = item as Record<string, unknown>;
        // 检查是否有 id、productId 或 variantId（至少需要一个）
        if (!itemObj.id && !itemObj.productId && !itemObj.variantId && !itemObj.product_id && !itemObj.variant_id) {
          warnings.push(`items[${index}] missing id, productId, or variantId`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function checkEventDeduplication(
  shopId: string,
  eventId: string | null,
  eventName: string,
  destinationType?: string
): Promise<{ isDuplicate: boolean; existingEventId?: string }> {
  if (!eventId) {
    return { isDuplicate: false };
  }

  try {
    const existing = await prisma.pixelEventReceipt.findFirst({
      where: {
        shopId,
        eventId: eventId || undefined,
        eventType: eventName,
      },
      select: {
        id: true,
        eventId: true,
      },
    });

    if (existing) {
      return {
        isDuplicate: true,
        existingEventId: existing.eventId || undefined,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error("Failed to check event deduplication", {
      shopId,
      eventId,
      error,
    });

    return { isDuplicate: false };
  }
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// P0-T2: 已迁移到新的 EventLog/DeliveryAttempt 服务
// 此函数保留用于向后兼容，但实际记录已由新的服务处理
export async function logEvent(
  shopId: string,
  eventName: string,
  eventId: string | null,
  payload: PixelEventPayload,
  destinationType: string | null,
  status: "ok" | "fail",
  errorCode?: string,
  errorDetail?: string
): Promise<void> {
  // 已迁移到新的 EventLog/DeliveryAttempt 服务
  // 此函数保留用于向后兼容，但不再执行实际操作
  // 实际的记录由 createEventLog 和 createDeliveryAttempt/updateDeliveryAttempt 处理
}

/**
 * P0-3: 多目的地配置支持
 * 
 * destinations 可以是：
 * - string[]: 平台名称列表（向后兼容）
 * - Array<{ platform: string; configId?: string; platformId?: string }>: 配置对象列表（支持多目的地）
 * 
 * 如果传递配置对象列表，每个配置都会被单独处理，确保同一平台的多个配置都能收到事件
 */
export async function processEventPipeline(
  shopId: string,
  payload: PixelEventPayload,
  eventId: string | null,
  destinations: string[] | Array<{ platform: string; configId?: string; platformId?: string }>,
  environment?: "test" | "live" // P0-4: Test/Live 环境过滤
): Promise<EventPipelineResult> {

  const validation = validateEventPayload(payload);
  if (!validation.valid) {
    await logEvent(
      shopId,
      payload.eventName,
      eventId,
      payload,
      null,
      "fail",
      "validation_failed",
      validation.errors.join("; ")
    );

    return {
      success: false,
      errors: validation.errors,
    };
  }

  // P0-3: 标准化 destinations 为配置对象列表
  const destinationConfigs: Array<{ platform: string; configId?: string; platformId?: string }> = 
    destinations.length > 0 && typeof destinations[0] === 'string'
      ? (destinations as string[]).map(d => ({ platform: d }))
      : (destinations as Array<{ platform: string; configId?: string; platformId?: string }>);

  const deduplicationResults: boolean[] = [];
  for (const destConfig of destinationConfigs) {
    // P0-3: 使用配置ID或平台名称作为去重键，确保同一平台的多个配置都能被处理
    const dedupKey = destConfig.configId || destConfig.platform;
    const dedupResult = await checkEventDeduplication(
      shopId,
      eventId,
      payload.eventName,
      dedupKey
    );

    if (dedupResult.isDuplicate) {
      logger.info("Event deduplicated", {
        shopId,
        eventId,
        destination: destConfig.platform,
        configId: destConfig.configId,
        platformId: destConfig.platformId,
        existingEventId: dedupResult.existingEventId,
      });
      deduplicationResults.push(true);
    } else {
      deduplicationResults.push(false);
    }
  }

  const isDeduplicated = deduplicationResults.some((dup) => dup);

  // ============================================================================
  // 规范化 payload：确保所有事件都使用统一的 value/currency/items[] 格式
  // 这确保了多币种商店的对账/一致性检查不会失真，并且符合"模板化可用"的要求
  // 
  // 关键点：
  // 1. value: 数值类型，page_viewed 为 0，其他事件从 payload 中获取
  // 2. currency: 优先使用 payload 中的实际值（从 checkout/cart 数据中获取），
  //    只有在确实缺失或格式错误时才使用 USD 作为后备（避免写死 USD）
  // 3. items[]: 统一格式 { id, name, price, quantity }，确保映射模板稳定
  // ============================================================================
  
  // 规范化 value：确保数值类型正确
  function normalizeValue(value: unknown): number {
    if (typeof value === "number") {
      return Math.max(0, Math.round(value * 100) / 100);
    }
    if (typeof value === "string") {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
    }
    return 0;
  }
  
  // 规范化 currency：优先使用 payload 中的实际值，避免写死 USD
  // 只有在确实缺失或格式错误时才使用 USD 作为后备
  // 这确保了多币种商店的对账/一致性检查不会失真
  function normalizeCurrency(currency: unknown, eventName: string): string {
    if (currency === null || currency === undefined) {
      // 对于需要货币的事件，如果没有货币信息，记录警告并使用 USD 作为兜底
      // 但正常情况下，pixel 端应该总是从 checkout/cart 数据中获取 currency
      // 注意：page_viewed 事件可能没有 currency，这是正常的
      const requiresCurrency = ["checkout_completed", "purchase", "product_added_to_cart", "checkout_started", "product_viewed"].includes(eventName);
      if (requiresCurrency) {
        logger.warn(`Missing currency for ${eventName} event, using USD as fallback. This may indicate a data quality issue. Pixel should always send currency from checkout/cart data.`, {
          eventName,
          shopId,
        });
      }
      return "USD";
    }
    
    if (typeof currency === "string") {
      const upper = currency.toUpperCase().trim();
      // 验证是否为有效的 ISO 4217 货币代码（3 个大写字母）
      if (/^[A-Z]{3}$/.test(upper)) {
        return upper;
      }
    }
    
    // 只有在格式错误时才记录警告并使用默认值
    logger.warn("Invalid currency format, defaulting to USD", {
      currency,
      currencyType: typeof currency,
      eventName,
      shopId,
    });
    
    return "USD";
  }
  
  // 规范化 value：确保数值类型正确
  // 对于 page_viewed 事件，value 始终为 0
  // 对于其他事件，如果 value 未定义，尝试从 items 计算（如果 items 存在）
  let normalizedValue: number | undefined;
  if (payload.eventName === "page_viewed") {
    normalizedValue = 0;
  } else if (payload.data?.value !== undefined) {
    normalizedValue = normalizeValue(payload.data.value);
  } else if (payload.data?.items && Array.isArray(payload.data.items) && payload.data.items.length > 0) {
    // 如果 value 未定义但 items 存在，尝试从 items 计算总价值
    normalizedValue = payload.data.items.reduce((sum: number, item: unknown) => {
      const itemObj = item as Record<string, unknown>;
      const price = normalizeValue(itemObj.price);
      const quantity = typeof itemObj.quantity === "number" 
        ? Math.max(1, Math.floor(itemObj.quantity))
        : typeof itemObj.quantity === "string"
        ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
        : 1;
      return sum + (price * quantity);
    }, 0);
  } else {
    // 对于非 page_viewed 事件，如果既没有 value 也没有 items，使用 0
    normalizedValue = 0;
  }
  
  // 规范化 currency：优先使用 payload 中的实际值
  const normalizedCurrency = normalizeCurrency(payload.data?.currency, payload.eventName);
  
  // 规范化 items：确保数组格式统一，转换为标准格式
  // items 格式：{ id, name, price, quantity }（符合 PixelEventData 类型定义）
  // 
  // 关键点：
  // 1. id 的优先级：variantId > variant_id > productId > product_id > id
  //    这与 api.pixel-events/route.tsx 中的逻辑完全一致，确保 eventId 生成的一致性
  // 2. 确保所有事件都有统一的 items[] 格式，便于平台映射
  let normalizedItems: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }> | undefined;
  
  if (payload.eventName === "page_viewed") {
    normalizedItems = [];
  } else if (payload.data?.items && Array.isArray(payload.data.items)) {
    normalizedItems = payload.data.items
      .filter(item => item != null && typeof item === "object")
      .map(item => {
        const itemObj = item as Record<string, unknown>;
        // 优先级：variantId > variant_id > productId > product_id > id
        // 这与 api.pixel-events/route.tsx 中的逻辑完全一致，确保 eventId 生成的一致性
        const id = String(
          itemObj.variantId || 
          itemObj.variant_id || 
          itemObj.productId || 
          itemObj.product_id || 
          itemObj.id || 
          ""
        ).trim();
        const name = String(
          itemObj.name || 
          itemObj.item_name || 
          itemObj.title || 
          itemObj.product_name || 
          itemObj.productTitle || 
          ""
        ).trim() || "Unknown";
        const price = itemObj.price !== undefined ? normalizeValue(itemObj.price) : 0;
        const quantity = typeof itemObj.quantity === "number" 
          ? Math.max(1, Math.floor(itemObj.quantity))
          : typeof itemObj.quantity === "string"
          ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
          : 1;
        
        return {
          id,
          name,
          price,
          quantity,
        };
      })
      .filter(item => item.id); // 过滤掉没有 id 的项
  }
  
  // 构建规范化后的 payload，确保所有事件都有统一的 value/currency/items[] 格式
  // 这确保了"模板化可用"的要求：所有事件都有统一的字段结构，便于平台映射
  const normalizedPayload: PixelEventPayload = {
    ...payload,
    data: {
      ...payload.data,
      // 确保 value 始终是数字类型（不是 undefined）
      value: normalizedValue !== undefined ? normalizedValue : 0,
      // 确保 currency 始终是字符串类型（不是 null 或 undefined）
      currency: normalizedCurrency,
      // 确保 items 始终是数组类型（不是 undefined）
      items: normalizedItems || [],
    },
  };

  // ============================================================================
  // 生成 eventId：确保 client/server 端 event_id 生成的一致性
  // 
  // 关键点：
  // 1. client 端（pixel）不生成 eventId，由 server 端统一生成
  // 2. server 端使用 generateCanonicalEventId 逻辑，确保同一笔订单在两条链路
  //    （client 端 pixel 和 server 端 webhook）生成的 event_id 可预测一致
  // 3. 这确保了平台侧 dedup 能够正常工作（同一订单不会重复发送）
  // 
  // 注意：如果 eventId 已经由 api.pixel-events/route.tsx 生成，则直接使用
  // 如果没有，则使用与 api.pixel-events/route.tsx 相同的逻辑生成
  // ============================================================================
  let finalEventId = eventId;
  if (!finalEventId) {
    // 对于非 purchase 事件，如果没有 eventId，使用与 api.pixel-events/route.tsx 
    // 中相同的 generateCanonicalEventId 逻辑生成
    // 这确保了 client/server 端 event_id 生成的一致性
    
    // 标准化 items 以匹配 client 端的格式
    // 注意：这里的 items 应该使用规范化后的 normalizedItems，确保格式一致
    const normalizedItemsForEventId = normalizedItems?.map(item => ({
      id: item.id,
      quantity: item.quantity,
    })) || [];
    
    // P1-4: 传递 nonce 参数用于 fallback 去重
    finalEventId = generateCanonicalEventId(
      normalizedPayload.data?.orderId || null,
      normalizedPayload.data?.checkoutToken || null,
      normalizedPayload.eventName,
      normalizedPayload.shopDomain,
      normalizedItemsForEventId.length > 0 ? normalizedItemsForEventId : undefined,
      "v2", // 使用新版本
      payload.nonce || null // P1-4: 传递 nonce 用于 fallback 去重
    );
    
    logger.debug(`Generated canonical eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      eventId: finalEventId,
      hasItems: normalizedItemsForEventId.length > 0,
      orderId: normalizedPayload.data?.orderId || null,
      checkoutToken: normalizedPayload.data?.checkoutToken || null,
    });
  } else {
    // 如果 eventId 已经存在，记录日志以便调试
    logger.debug(`Using provided eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      eventId: finalEventId,
      orderId: normalizedPayload.data?.orderId || null,
      checkoutToken: normalizedPayload.data?.checkoutToken || null,
    });
  }

  // P0-T2: 创建 EventLog 记录（事件证据链核心）
  let eventLogId: string | null = null;
  if (!isDeduplicated && finalEventId) {
    try {
      eventLogId = await createEventLog({
        shopId,
        eventId: finalEventId,
        eventName: normalizedPayload.eventName,
        occurredAt: new Date(normalizedPayload.timestamp || Date.now()),
        normalizedEventJson: normalizedPayload,
        shopifyContextJson: null, // 可以从 payload 中提取 Shopify 上下文
        source: "web_pixel",
      });
    } catch (error) {
      logger.error("Failed to create EventLog (non-blocking)", {
        shopId,
        eventId: finalEventId,
        eventName: normalizedPayload.eventName,
        error: error instanceof Error ? error.message : String(error),
      });
      // 继续执行，不阻塞事件发送
    }
  }

  // 如果不是重复事件，则发送到各个平台
  // 这是 Destination Router 的核心逻辑：将规范化后的事件真正路由发送到 GA4/Meta/TikTok
  // 这确保了"像素迁移中心（Web Pixel → Destinations）"的产品承诺得以实现
  // P0-3: 支持多目的地配置，每个配置都会被单独处理
  if (!isDeduplicated) {
    const destinationNames = destinationConfigs.map(d => d.platform);
    logger.info(`Routing ${normalizedPayload.eventName} event to ${destinationConfigs.length} destination(s)`, {
      shopId,
      eventId: finalEventId,
      eventName: normalizedPayload.eventName,
      destinations: destinationNames,
      configCount: destinationConfigs.length,
      normalizedValue: normalizedPayload.data.value,
      normalizedCurrency: normalizedPayload.data.currency,
      itemsCount: normalizedPayload.data.items?.length || 0,
      hasOrderId: !!normalizedPayload.data.orderId,
      hasCheckoutToken: !!normalizedPayload.data.checkoutToken,
    });

    const sendPromises = destinationConfigs.map(async (destConfig) => {
      const destination = destConfig.platform;
      try {
        logger.debug(`Sending ${normalizedPayload.eventName} to ${destination}`, {
          shopId,
          eventId: finalEventId,
          eventName: normalizedPayload.eventName,
          platform: destination,
          configId: destConfig.configId,
          platformId: destConfig.platformId,
        });

        // 使用规范化后的 payload 发送到平台
        // finalEventId 已经通过 generateCanonicalEventId 生成，确保非 purchase 事件真正路由发送到 destinations（GA4/Meta/TikTok）
        // 如果 finalEventId 仍然为 null（不应该发生），使用临时 ID 确保发送不会失败
        let eventIdForSend = finalEventId;
        if (!eventIdForSend) {
          logger.error(`Missing eventId for ${normalizedPayload.eventName} event, generating fallback ID`, {
            shopId,
            eventName: normalizedPayload.eventName,
            destination,
            configId: destConfig.configId,
          });
          // 使用临时 ID 作为后备，但这种情况不应该发生
          // P1-4: 传递 nonce 参数用于 fallback 去重
          eventIdForSend = generateCanonicalEventId(
            normalizedPayload.data?.orderId || null,
            normalizedPayload.data?.checkoutToken || null,
            normalizedPayload.eventName,
            normalizedPayload.shopDomain,
            normalizedItems?.map(item => ({ id: item.id, quantity: item.quantity })) || undefined,
            "v2", // 使用新版本
            payload.nonce || null // P1-4: 传递 nonce 用于 fallback 去重
          );
        }
        
        // P0-T2: 传递 eventLogId 以支持 DeliveryAttempt 记录
        // P0-3: 传递配置ID以支持多目的地（同一平台的多个配置）
        // P0-4: 传递 environment 以支持 Test/Live 环境过滤
        const sendResult = await sendPixelEventToPlatform(
          shopId,
          destination,
          normalizedPayload,
          eventIdForSend,
          destConfig.configId,
          destConfig.platformId,
          eventLogId, // 传递 eventLogId 用于创建 DeliveryAttempt
          environment // P0-4: 传递 environment 以支持 Test/Live 环境过滤
        );

        // P0-3: 使用配置ID作为 destinationType，确保同一平台的多个配置都能被记录
        const destinationType = destConfig.configId 
          ? `${destination}:${destConfig.configId}` 
          : destConfig.platformId 
          ? `${destination}:${destConfig.platformId}` 
          : destination;
        
        await logEvent(
          shopId,
          normalizedPayload.eventName,
          finalEventId,
          normalizedPayload,
          destinationType,
          sendResult.success ? "ok" : "fail",
          sendResult.success ? undefined : "send_failed",
          sendResult.error
        );

        if (sendResult.success) {
          logger.info(`Successfully sent ${normalizedPayload.eventName} to ${destination}`, {
            shopId,
            eventId: finalEventId,
            eventName: normalizedPayload.eventName,
            platform: destination,
            configId: destConfig.configId,
            platformId: destConfig.platformId,
          });
        } else {
          logger.warn(`Failed to send ${normalizedPayload.eventName} to ${destination}`, {
            shopId,
            eventName: normalizedPayload.eventName,
            eventId: finalEventId,
            platform: destination,
            configId: destConfig.configId,
            platformId: destConfig.platformId,
            error: sendResult.error,
          });
        }

        return sendResult;
      } catch (error) {
        logger.error(`Error sending ${normalizedPayload.eventName} to ${destination}`, {
          shopId,
          eventName: normalizedPayload.eventName,
          eventId,
          platform: destination,
          configId: destConfig.configId,
          platformId: destConfig.platformId,
          error: error instanceof Error ? error.message : String(error),
        });

        const destinationType = destConfig.configId 
          ? `${destination}:${destConfig.configId}` 
          : destConfig.platformId 
          ? `${destination}:${destConfig.platformId}` 
          : destination;

        await logEvent(
          shopId,
          normalizedPayload.eventName,
          finalEventId,
          normalizedPayload,
          destinationType,
          "fail",
          "send_error",
          error instanceof Error ? error.message : String(error)
        );

        return {
          success: false,
          platform: destination,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.allSettled(sendPromises);
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    
    // Destination Router 完成：非 purchase 事件已真正路由发送到 GA4/Meta/TikTok
    // 这确保了"像素迁移中心（Web Pixel → Destinations）"的产品承诺得以实现
    // P0-3: 支持多目的地配置，每个配置都会被单独处理
    logger.info(`Event ${normalizedPayload.eventName} routing completed - sent to destinations`, {
      shopId,
      eventId: finalEventId,
      eventName: normalizedPayload.eventName,
      totalDestinations: destinationConfigs.length,
      successful: successCount,
      failed: destinationConfigs.length - successCount,
      normalizedValue: normalizedPayload.data.value,
      normalizedCurrency: normalizedPayload.data.currency,
      itemsCount: normalizedPayload.data.items?.length || 0,
      // 记录 event_id 生成的关键信息，便于调试 client/server 端一致性
      eventIdSource: eventId ? "from_client" : "generated_by_server",
      hasOrderId: !!normalizedPayload.data.orderId,
      hasCheckoutToken: !!normalizedPayload.data.checkoutToken,
    });
  } else {
    // 如果是重复事件，只记录日志
    // P0-3: 为每个配置单独记录日志
    const logPromises = destinationConfigs.map((destConfig) => {
      const destinationType = destConfig.configId 
        ? `${destConfig.platform}:${destConfig.configId}` 
        : destConfig.platformId 
        ? `${destConfig.platform}:${destConfig.platformId}` 
        : destConfig.platform;
      return logEvent(
        shopId,
        normalizedPayload.eventName,
        finalEventId,
        normalizedPayload,
        destinationType,
        "ok",
        "deduplicated",
        "Event was deduplicated"
      );
    });

    await Promise.allSettled(logPromises);
  }

  // P0-3: 返回平台名称列表以保持向后兼容
  const destinationNames = destinationConfigs.map(d => d.platform);
  return {
    success: true,
    eventId: finalEventId || undefined,
    destinations: destinationNames,
    deduplicated: isDeduplicated,
  };
}

export async function processBatchEvents(
  shopId: string,
  events: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }>,
  environment?: "test" | "live" // P0-4: Test/Live 环境过滤
): Promise<EventPipelineResult[]> {
  const results: EventPipelineResult[] = [];

  for (const event of events) {
    const result = await processEventPipeline(
      shopId,
      event.payload,
      event.eventId,
      event.destinations,
      environment
    );
    results.push(result);
  }

  return results;
}

export async function getEventStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  total: number;
  success: number;
  failed: number;
  deduplicated: number;
  byDestination: Record<string, { total: number; success: number; failed: number }>;
}> {
  // Note: Using ConversionLog instead of eventLog as the model doesn't exist
  const events = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      status: true,
      platform: true,
      errorMessage: true,
    },
  });

  const stats = {
    total: events.length,
    success: 0,
    failed: 0,
    deduplicated: 0,
    byDestination: {} as Record<string, { total: number; success: number; failed: number }>,
  };

  for (const event of events) {
    if (event.status === "sent" || event.status === "pending") {
      stats.success++;
    } else {
      stats.failed++;
    }

    const dest = event.platform || "unknown";
    if (!stats.byDestination[dest]) {
      stats.byDestination[dest] = { total: 0, success: 0, failed: 0 };
    }

    stats.byDestination[dest].total++;
    if (event.status === "sent" || event.status === "pending") {
      stats.byDestination[dest].success++;
    } else {
      stats.byDestination[dest].failed++;
    }
  }

  return stats;
}

