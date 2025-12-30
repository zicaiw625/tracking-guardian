

import { logger } from "../utils/logger.server";
import type { EventMapping } from "./event-mapping.server";

export interface NormalizedEventParams {
  event_name: string;
  value: number;
  currency: string;
  items?: Array<{
    item_id: string;
    item_name: string;
    price: number;
    quantity: number;
  }>;
  content_ids?: string[];
  contents?: Array<{
    id: string;
    quantity: number;
    item_price: number;
  }>;
  line_items?: Array<{
    product_id: string;
    product_name: string;
    product_price: number;
    quantity: number;
  }>;
  event_id?: string;
  transaction_id?: string;
  order_id?: string;
  order_quantity?: number;
  num_items?: number;
  [key: string]: unknown;
}

export interface ShopifyEventData {
  event_name: string;
  value?: number;
  currency?: string;
  items?: Array<{
    id?: string;
    item_id?: string;
    variant_id?: string;
    sku?: string;
    name?: string;
    product_name?: string;
    title?: string;
    price?: number;
    quantity?: number;
    product_id?: string;
    variant_id?: string;
  }>;
  order_id?: string;
  event_id?: string;
  checkout_token?: string;
  [key: string]: unknown;
}

/**
 * 规范化 Shopify 事件参数
 * 将 Shopify 标准事件数据转换为平台所需格式
 */
export function normalizeEventParameters(
  shopifyEvent: ShopifyEventData,
  mapping: EventMapping,
  platform: string
): NormalizedEventParams {
  const normalized: NormalizedEventParams = {
    event_name: mapping.platformEvent,
    value: 0,
    currency: "USD",
  };

  // 规范化金额和币种
  if (shopifyEvent.value !== undefined && shopifyEvent.value !== null) {
    normalized.value = typeof shopifyEvent.value === "number"
      ? shopifyEvent.value
      : parseFloat(String(shopifyEvent.value)) || 0;
  }

  if (shopifyEvent.currency) {
    normalized.currency = String(shopifyEvent.currency).toUpperCase();
  }

  // 规范化商品数据（items）
  if (shopifyEvent.items && Array.isArray(shopifyEvent.items)) {
    normalized.items = normalizeItems(shopifyEvent.items);
    
    // 根据平台转换 items 格式
    if (platform === "meta" || platform === "tiktok") {
      normalized.contents = convertToContentsFormat(shopifyEvent.items);
      normalized.content_ids = normalized.contents.map(c => c.id);
    }
    
    if (platform === "pinterest") {
      normalized.line_items = convertToLineItemsFormat(shopifyEvent.items);
      normalized.order_quantity = normalized.line_items.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
    }
    
    // Meta 需要 num_items
    if (platform === "meta") {
      normalized.num_items = normalized.contents.reduce(
        (sum, item) => sum + item.quantity,
        0
      );
    }
  }

  // 规范化事件 ID（用于去重）
  if (shopifyEvent.event_id) {
    normalized.event_id = String(shopifyEvent.event_id);
    if (platform === "google") {
      normalized.transaction_id = normalized.event_id;
    }
  }

  // 规范化订单 ID
  if (shopifyEvent.order_id) {
    normalized.order_id = String(shopifyEvent.order_id);
  }

  // 应用参数转换规则
  if (mapping.paramTransformations) {
    for (const [sourceKey, targetKey] of Object.entries(mapping.paramTransformations)) {
      if (sourceKey in normalized && !(targetKey in normalized)) {
        (normalized as Record<string, unknown>)[targetKey] = normalized[sourceKey as keyof NormalizedEventParams];
      }
    }
  }

  // 验证必需参数
  validateRequiredParams(normalized, mapping.requiredParams, platform);

  return normalized;
}

/**
 * 规范化商品数组
 */
function normalizeItems(
  items: ShopifyEventData["items"]
): NormalizedEventParams["items"] {
  if (!items || !Array.isArray(items)) return undefined;

  return items
    .filter(item => item != null)
    .map(item => ({
      item_id: getItemId(item),
      item_name: getItemName(item),
      price: getItemPrice(item),
      quantity: getItemQuantity(item),
    }))
    .filter(item => item.item_id && item.item_name);
}

/**
 * 转换为 Meta/TikTok 的 contents 格式
 */
function convertToContentsFormat(
  items: ShopifyEventData["items"]
): Array<{ id: string; quantity: number; item_price: number }> {
  if (!items || !Array.isArray(items)) return [];

  return items
    .filter(item => item != null)
    .map(item => ({
      id: getItemId(item) || "",
      quantity: getItemQuantity(item),
      item_price: getItemPrice(item),
    }))
    .filter(item => item.id);
}

/**
 * 转换为 Pinterest 的 line_items 格式
 */
function convertToLineItemsFormat(
  items: ShopifyEventData["items"]
): Array<{ product_id: string; product_name: string; product_price: number; quantity: number }> {
  if (!items || !Array.isArray(items)) return [];

  return items
    .filter(item => item != null)
    .map(item => ({
      product_id: getItemId(item) || "",
      product_name: getItemName(item) || "",
      product_price: getItemPrice(item),
      quantity: getItemQuantity(item),
    }))
    .filter(item => item.product_id);
}

/**
 * 获取商品 ID（支持多种字段名）
 */
function getItemId(item: NonNullable<ShopifyEventData["items"]>[0]): string {
  return (
    item.id ||
    item.item_id ||
    item.variant_id ||
    item.sku ||
    item.product_id ||
    ""
  );
}

/**
 * 获取商品名称（支持多种字段名）
 */
function getItemName(item: NonNullable<ShopifyEventData["items"]>[0]): string {
  return (
    item.name ||
    item.item_name ||
    item.product_name ||
    item.title ||
    ""
  );
}

/**
 * 获取商品价格
 */
function getItemPrice(item: NonNullable<ShopifyEventData["items"]>[0]): number {
  if (item.price !== undefined && item.price !== null) {
    return typeof item.price === "number"
      ? item.price
      : parseFloat(String(item.price)) || 0;
  }
  return 0;
}

/**
 * 获取商品数量
 */
function getItemQuantity(item: NonNullable<ShopifyEventData["items"]>[0]): number {
  if (item.quantity !== undefined && item.quantity !== null) {
    return typeof item.quantity === "number"
      ? item.quantity
      : parseInt(String(item.quantity), 10) || 1;
  }
  return 1;
}

/**
 * 验证必需参数
 */
function validateRequiredParams(
  params: NormalizedEventParams,
  requiredParams: string[],
  platform: string
): void {
  const missing: string[] = [];

  for (const param of requiredParams) {
    if (!(param in params) || params[param as keyof NormalizedEventParams] === undefined) {
      missing.push(param);
    }
  }

  if (missing.length > 0) {
    logger.warn("Missing required parameters", {
      platform,
      eventName: params.event_name,
      missingParams: missing,
    });
  }
}

/**
 * 清洗和规范化货币代码
 */
export function normalizeCurrency(currency: string | undefined): string {
  if (!currency) return "USD";
  
  const upper = currency.toUpperCase();
  
  // 验证是否为有效的 ISO 4217 货币代码（简化版）
  const validCurrencies = [
    "USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF", "HKD", "SGD",
    "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RUB", "INR", "BRL", "MXN",
  ];
  
  if (validCurrencies.includes(upper)) {
    return upper;
  }
  
  // 如果不匹配，返回大写版本（让平台API验证）
  return upper;
}

/**
 * 清洗金额值
 */
export function normalizeValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, value);
  }
  
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }
  
  return 0;
}

