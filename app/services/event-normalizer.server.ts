

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
 * P1-4: 生成 canonical event_id（可测试的纯函数，含版本号）
 * 
 * 版本: v2（修复了 fallback 冲突问题）
 * 
 * 生成规则:
 * 1. 对于 purchase/checkout_completed 事件: 使用 orderId 作为 identifier
 * 2. 对于其他事件: 使用 orderId 或 checkoutToken 作为 identifier
 * 3. 如果都没有: 优先使用 nonce（如果提供），否则使用毫秒级时间戳 + 随机数
 * 4. 包含 items hash 以确保同一订单的不同商品组合有不同的 event_id
 * 
 * 输入格式: `${version}:${shopDomain}:${identifier}:${eventName}:${itemsHash}`
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
  version: string = "v2", // 版本号更新为 v2（修复 fallback 冲突）
  nonce?: string | null | undefined // P1-4: 添加 nonce 参数用于 fallback 去重
): string {
  const crypto = require("crypto");

  let identifier: string;
  if (orderId) {
    identifier = normalizeOrderId(orderId);
  } else if (checkoutToken) {
    identifier = checkoutToken;
  } else {
    // P1-4: 修复 fallback 冲突问题
    // 优先使用 nonce（如果提供），确保去重准确性
    // 如果没有 nonce，使用毫秒级时间戳 + 随机数，避免同一秒内冲突
    if (nonce) {
      identifier = `nonce_${nonce}`;
      logger.debug("Using nonce for event ID generation (fallback)", {
        eventName,
        shopDomain,
        noncePrefix: nonce.substring(0, 8),
      });
    } else {
      // 使用毫秒级时间戳 + 随机数，确保唯一性
      const timestampMs = Date.now(); // 毫秒级时间戳
      const randomSuffix = crypto.randomBytes(4).toString("hex"); // 8 字符随机数
      identifier = `fallback_${timestampMs}_${randomSuffix}`;
      logger.warn("Generating event ID without orderId, checkoutToken, or nonce (non-idempotent, should be avoided)", {
        eventName,
        shopDomain,
        identifierPrefix: identifier.substring(0, 30),
      });
    }
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
