/**
 * P1-01: 统一事件规范化服务
 * 
 * 将 Shopify 标准事件数据规范成内部 canonical schema，
 * 并为每个平台实现 mapper（GA4/Meta/TikTok）
 */

import { logger } from "../utils/logger.server";
import type { PixelEventPayload } from "../routes/api.pixel-events/types";
import { mapEventToPlatform } from "./events/mapping.server";
import { normalizeEventParameters } from "./event-parameter-normalization.server";
import type { EventMapping } from "./event-mapping";

/**
 * Canonical Event Schema - 内部统一事件格式
 */
export interface CanonicalEvent {
  eventName: string; // Shopify 标准事件名
  timestamp: number;
  shopDomain: string;
  
  // 订单标识
  orderId?: string | null;
  checkoutToken?: string | null;
  
  // 金额信息
  value: number;
  currency: string;
  
  // 商品信息
  items?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    variantId?: string;
    sku?: string;
  }>;
  
  // 事件 ID（用于去重）
  eventId: string;
  
  // 原始数据
  rawData: Record<string, unknown>;
}

/**
 * 平台特定的事件参数
 */
export interface PlatformEventParams {
  eventName: string; // 平台事件名
  parameters: Record<string, unknown>;
  eventId?: string;
  isValid: boolean;
  missingParameters: string[];
}

/**
 * 规范化 Shopify 事件到 Canonical Schema
 */
export function normalizeToCanonical(
  payload: PixelEventPayload,
  eventId: string
): CanonicalEvent {
  const data = payload.data || {};
  
  // 规范化金额
  const value = normalizeValue(data.value);
  const currency = normalizeCurrency(data.currency);
  
  // 规范化商品列表
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
    rawData: data,
  };
}

/**
 * 映射 Canonical Event 到平台特定格式
 */
export function mapToPlatform(
  canonical: CanonicalEvent,
  platform: string
): PlatformEventParams {
  // 使用现有的映射服务
  const payload: PixelEventPayload = {
    eventName: canonical.eventName,
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
      event_id: canonical.eventId,
    },
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
 * 生成统一的 event_id
 * 规则：优先 checkout_token/order_id + event_name + line_hash
 * 保证 client/server 混合时可 dedup
 */
export function generateCanonicalEventId(
  orderId: string | null | undefined,
  checkoutToken: string | null | undefined,
  eventName: string,
  shopDomain: string,
  items?: Array<{ id: string; quantity: number }>
): string {
  const crypto = require("crypto");
  
  // 优先使用 orderId
  let identifier: string;
  if (orderId) {
    identifier = normalizeOrderId(orderId);
  } else if (checkoutToken) {
    identifier = checkoutToken;
  } else {
    // 如果没有标识符，使用时间戳 + 随机数（不推荐，但作为兜底）
    logger.warn("Generating event ID without orderId or checkoutToken", {
      eventName,
      shopDomain,
    });
    identifier = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
  
  // 生成 items hash（用于区分不同商品组合）
  let itemsHash = "";
  if (items && items.length > 0) {
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
  
  // 生成最终 event_id
  const input = `${shopDomain}:${identifier}:${eventName}:${itemsHash}`;
  return crypto
    .createHash("sha256")
    .update(input, "utf8")
    .digest("hex")
    .substring(0, 32);
}

/**
 * 规范化金额值
 */
function normalizeValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, Math.round(value * 100) / 100); // 保留两位小数
  }
  
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
  }
  
  return 0;
}

/**
 * 规范化货币代码
 */
function normalizeCurrency(currency: unknown): string {
  if (typeof currency === "string") {
    const upper = currency.toUpperCase().trim();
    // 验证是否为有效的 ISO 4217 货币代码（3 位字母）
    if (/^[A-Z]{3}$/.test(upper)) {
      return upper;
    }
  }
  
  return "USD"; // 默认货币
}

/**
 * 规范化商品列表
 */
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
      
      // 提取商品 ID（优先顺序：id > item_id > variant_id > sku > product_id）
      const id =
        String(itemObj.id || itemObj.item_id || itemObj.variant_id || itemObj.sku || itemObj.product_id || "").trim();
      
      // 提取商品名称
      const name =
        String(itemObj.name || itemObj.item_name || itemObj.title || itemObj.product_name || "").trim();
      
      // 提取价格
      const price = normalizeValue(itemObj.price);
      
      // 提取数量
      const quantity =
        typeof itemObj.quantity === "number"
          ? Math.max(1, Math.floor(itemObj.quantity))
          : typeof itemObj.quantity === "string"
          ? Math.max(1, parseInt(itemObj.quantity, 10) || 1)
          : 1;
      
      // 提取 variant ID 和 SKU
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
    .filter(item => item.id && item.name); // 必须有 ID 和名称
}

/**
 * 规范化订单 ID（支持 Shopify GID 格式）
 */
function normalizeOrderId(orderId: string): string {
  // 如果是 Shopify GID 格式，提取数字部分
  const gidMatch = orderId.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  // 否则直接返回
  return orderId.trim();
}

/**
 * 验证平台事件参数完整性
 */
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

/**
 * 导出可视化 payload（用于 Verification）
 */
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
