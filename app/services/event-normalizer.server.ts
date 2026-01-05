

import { logger } from "../utils/logger.server";
import type { PixelEventPayload, PixelEventName, PixelEventData } from "../routes/api.pixel-events/types";
import { mapEventToPlatform } from "./events/mapping.server";
import { normalizeEventParameters } from "./event-parameter-normalization.server";
import type { EventMapping } from "./event-mapping";

export interface CanonicalEvent {
  eventName: string;
  timestamp: number;
  shopDomain: string;

  orderId?: string | null;
  checkoutToken?: string | null;

  value: number;
  currency: string;

  items?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    variantId?: string;
    sku?: string;
  }>;

  eventId: string;

  rawData: Record<string, unknown>;
}

export interface PlatformEventParams {
  eventName: string;
  parameters: Record<string, unknown>;
  eventId?: string;
  isValid: boolean;
  missingParameters: string[];
}

export function normalizeToCanonical(
  payload: PixelEventPayload,
  eventId: string
): CanonicalEvent {
  const data = payload.data || {};

  const value = normalizeValue(data.value);
  // 传递 eventName 以便 normalizeCurrency 可以根据事件类型决定是否需要记录警告
  const currency = normalizeCurrency(data.currency, payload.eventName);

  const items = normalizeItems(data.items);

  return {
    eventName: payload.eventName,
    timestamp: payload.timestamp,
    shopDomain: payload.shopDomain,
    orderId: data.orderId || null,
    checkoutToken: data.checkoutToken || null,
    value,
    currency,
    items,
    eventId,
    rawData: data as Record<string, unknown>,
  };
}

export function mapToPlatform(
  canonical: CanonicalEvent,
  platform: string
): PlatformEventParams {

  const payload: PixelEventPayload = {
    eventName: canonical.eventName as PixelEventName,
    timestamp: canonical.timestamp,
    shopDomain: canonical.shopDomain,
    data: {
      ...canonical.rawData,
      value: canonical.value,
      currency: canonical.currency,
      items: canonical.items?.map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        variant_id: item.variantId,
        sku: item.sku,
      })),
      orderId: canonical.orderId,
      checkoutToken: canonical.checkoutToken,
    } as PixelEventData,
  };

  const mapped = mapEventToPlatform(
    canonical.eventName,
    platform,
    payload
  );

  return {
    eventName: mapped.eventName,
    parameters: {
      ...mapped.parameters,
      event_id: canonical.eventId,
    },
    eventId: canonical.eventId,
    isValid: mapped.isValid,
    missingParameters: mapped.missingParameters,
  };
}

/**
 * P0-T3: 生成 canonical event_id（可测试的纯函数，含版本号）
 * 
 * 版本: v1
 * 
 * 生成规则:
 * 1. 对于 purchase/checkout_completed 事件: 使用 orderId 作为 identifier
 * 2. 对于其他事件: 使用 orderId 或 checkoutToken 作为 identifier
 * 3. 如果都没有: 使用时间戳+随机数（不推荐，但作为后备）
 * 4. 包含 items hash 以确保同一订单的不同商品组合有不同的 event_id
 * 
 * 输入格式: `${shopDomain}:${identifier}:${eventName}:${itemsHash}`
 * 输出: SHA256 哈希的前 32 个字符
 * 
 * 注意: 此函数必须是纯函数，相同的输入必须产生相同的输出
 */
export function generateCanonicalEventId(
  orderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  eventName: string,
  shopDomain: string,
  items?: Array<{ id: string; quantity: number }>,
  version: string = "v1" // 版本号，用于未来兼容性
): string {
  const crypto = require("crypto");

  let identifier: string;
  if (orderId) {
    identifier = normalizeOrderId(orderId);
  } else if (checkoutToken) {
    identifier = checkoutToken;
  } else {
    // 后备方案：使用时间戳+随机数（不推荐，但作为后备）
    // 注意：这会导致每次调用产生不同的 event_id，不符合幂等性
    // 应该尽量避免这种情况
    // P0-T3: 为了保持向后兼容，暂时保留此逻辑，但记录警告
    logger.warn("Generating event ID without orderId or checkoutToken (non-idempotent, should be avoided)", {
      eventName,
      shopDomain,
    });
    // 使用固定值作为后备，确保至少在同一秒内是稳定的
    const timestamp = Math.floor(Date.now() / 1000); // 秒级时间戳
    identifier = `fallback_${timestamp}`;
  }

  let itemsHash = "";
  if (items && items.length > 0) {
    // 对 items 进行排序以确保一致性
    const itemsKey = items
      .map(item => `${item.id}:${item.quantity}`)
      .sort()
      .join(",");
    itemsHash = crypto
      .createHash("sha256")
      .update(itemsKey)
      .digest("hex")
      .substring(0, 8);
  }

  // 包含版本号以确保未来兼容性
  const input = `${version}:${shopDomain}:${identifier}:${eventName}:${itemsHash}`;
  return crypto
    .createHash("sha256")
    .update(input, "utf8")
    .digest("hex")
    .substring(0, 32);
}

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

function normalizeCurrency(currency: unknown, eventName: string): string {
  // 如果 currency 为 null 或 undefined
  if (currency === null || currency === undefined) {
    // 对于需要货币的事件（purchase, add_to_cart 等），如果没有货币信息，记录警告并使用 USD 作为兜底
    // 对于不需要货币的事件（page_viewed），也使用 USD 作为默认值（因为接口要求 string）
    // 注意：这应该是最后的后备方案，正常情况下应该从事件数据中获取 currency
    const requiresCurrency = ["checkout_completed", "purchase", "product_added_to_cart", "checkout_started", "product_viewed"].includes(eventName);
    if (requiresCurrency) {
      logger.warn(`Missing currency for ${eventName} event, using USD as fallback. This may indicate a data quality issue.`, {
        eventName,
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
  });

  return "USD";
}

function normalizeItems(
  items: unknown
): CanonicalEvent["items"] {
  if (!Array.isArray(items)) {
    return undefined;
  }

  return items
    .filter(item => item != null && typeof item === "object")
    .map(item => {
      const itemObj = item as Record<string, unknown>;

      const id =
        String(itemObj.id || itemObj.item_id || itemObj.variant_id || itemObj.sku || itemObj.product_id || "").trim();

      const name =
        String(itemObj.name || itemObj.item_name || itemObj.title || itemObj.product_name || "").trim();

      const price = normalizeValue(itemObj.price);

      const quantity =
        typeof itemObj.quantity === "number"
          ? Math.max(1, Math.floor(itemObj.quantity))
          : typeof itemObj.quantity === "string"
          ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
          : 1;

      const variantId = itemObj.variant_id
        ? String(itemObj.variant_id).trim()
        : undefined;
      const sku = itemObj.sku ? String(itemObj.sku).trim() : undefined;

      return {
        id,
        name,
        price,
        quantity,
        variantId,
        sku,
      };
    })
    .filter(item => item.id && item.name);
}

function normalizeOrderId(orderId: string): string {

  const gidMatch = orderId.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }

  return orderId.trim();
}

export function validatePlatformEvent(
  platformEvent: PlatformEventParams
): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!platformEvent.isValid) {
    errors.push(`Missing required parameters: ${platformEvent.missingParameters.join(", ")}`);
  }

  if (!platformEvent.eventName) {
    errors.push("Missing event name");
  }

  if (!platformEvent.eventId) {
    errors.push("Missing event ID");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function exportVisualPayload(
  canonical: CanonicalEvent,
  platformParams: PlatformEventParams
): {
  canonical: CanonicalEvent;
  platform: {
    eventName: string;
    parameters: Record<string, unknown>;
    validation: {
      isValid: boolean;
      missingParameters: string[];
    };
  };
} {
  return {
    canonical,
    platform: {
      eventName: platformParams.eventName,
      parameters: platformParams.parameters,
      validation: {
        isValid: platformParams.isValid,
        missingParameters: platformParams.missingParameters,
      },
    },
  };
}
