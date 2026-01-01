/**
 * P1-01: 事件规范化服务
 * 
 * 将 Shopify 标准事件数据规范成内部 canonical schema
 * 确保所有平台映射使用统一的数据格式
 */

import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { normalizeParameterValue } from "./mapping.server";

/**
 * Canonical Event Schema - 内部统一事件格式
 */
export interface CanonicalEvent {
  eventName: string;
  timestamp: number;
  shopDomain: string;
  
  // 订单标识
  orderId: string | null;
  checkoutToken: string | null;
  orderNumber: string | null;
  
  // 金额信息
  value: number;
  currency: string;
  
  // 商品信息
  items: CanonicalItem[];
  
  // 其他元数据
  metadata: Record<string, unknown>;
}

export interface CanonicalItem {
  id: string; // product_id 或 variant_id
  name: string;
  price: number;
  quantity: number;
  sku?: string;
  variantId?: string;
  productId?: string;
  category?: string;
}

/**
 * 规范化 Shopify 事件到内部 canonical schema
 */
export function normalizeEvent(
  payload: PixelEventPayload
): CanonicalEvent {
  const data = payload.data || {};
  
  // 规范化订单标识
  const orderId = normalizeOrderIdentifier(data.orderId);
  const checkoutToken = normalizeCheckoutToken(data.checkoutToken);
  const orderNumber = data.orderNumber ? String(data.orderNumber) : null;
  
  // 规范化金额
  const value = normalizeValue(data.value);
  const currency = normalizeCurrency(data.currency || "USD");
  
  // 规范化商品列表
  const items = normalizeItems(data.items);
  
  // 提取元数据（保留其他字段）
  const metadata: Record<string, unknown> = {};
  const excludedKeys = new Set([
    "orderId", "checkoutToken", "orderNumber",
    "value", "currency", "items",
    "productId", "productTitle", "price", "quantity",
  ]);
  
  for (const [key, value] of Object.entries(data)) {
    if (!excludedKeys.has(key) && value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }
  
  return {
    eventName: payload.eventName,
    timestamp: payload.timestamp,
    shopDomain: payload.shopDomain,
    orderId,
    checkoutToken,
    orderNumber,
    value,
    currency,
    items,
    metadata,
  };
}

/**
 * 规范化订单标识符
 */
function normalizeOrderIdentifier(orderId: unknown): string | null {
  if (!orderId) return null;
  
  const str = String(orderId);
  
  // 处理 Shopify GID 格式
  const gidMatch = str.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  if (gidMatch) {
    return gidMatch[1];
  }
  
  // 处理数字 ID
  if (/^\d+$/.test(str)) {
    return str;
  }
  
  return str;
}

/**
 * 规范化 checkout token
 */
function normalizeCheckoutToken(token: unknown): string | null {
  if (!token) return null;
  const str = String(token).trim();
  return str.length > 0 ? str : null;
}

/**
 * 规范化金额
 */
function normalizeValue(value: unknown): number {
  if (typeof value === "number") {
    return Math.max(0, Math.round(value * 100) / 100);
  }
  
  if (typeof value === "string") {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return Math.max(0, Math.round(num * 100) / 100);
    }
  }
  
  return 0;
}

/**
 * 规范化货币代码
 */
function normalizeCurrency(currency: unknown): string {
  if (typeof currency === "string") {
    const normalized = currency.toUpperCase().trim();
    // 验证是否为有效的 ISO 4217 代码（3 个字母）
    if (/^[A-Z]{3}$/.test(normalized)) {
      return normalized;
    }
  }
  return "USD"; // 默认值
}

/**
 * 规范化商品列表
 */
function normalizeItems(items: unknown): CanonicalItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  
  return items
    .filter(item => item !== null && item !== undefined)
    .map(item => {
      const itemObj = item as Record<string, unknown>;
      
      // 提取商品 ID（优先使用 product_id，其次 variant_id，最后 sku）
      const id = 
        extractString(itemObj.product_id) ||
        extractString(itemObj.variant_id) ||
        extractString(itemObj.id) ||
        extractString(itemObj.sku) ||
        "";
      
      // 提取商品名称
      const name = 
        extractString(itemObj.name) ||
        extractString(itemObj.title) ||
        extractString(itemObj.productTitle) ||
        "";
      
      // 提取价格
      const price = normalizeItemPrice(itemObj.price || itemObj.item_price);
      
      // 提取数量
      const quantity = normalizeQuantity(itemObj.quantity);
      
      // 提取 SKU
      const sku = extractString(itemObj.sku);
      
      // 提取 variant ID
      const variantId = extractString(itemObj.variant_id || itemObj.variantId);
      
      // 提取 product ID
      const productId = extractString(itemObj.product_id || itemObj.productId);
      
      // 提取分类
      const category = extractString(itemObj.category || itemObj.product_type);
      
      return {
        id,
        name,
        price,
        quantity,
        ...(sku && { sku }),
        ...(variantId && { variantId }),
        ...(productId && { productId }),
        ...(category && { category }),
      };
    })
    .filter(item => item.id.length > 0); // 过滤掉没有 ID 的商品
}

/**
 * 规范化商品价格
 */
function normalizeItemPrice(price: unknown): number {
  if (typeof price === "number") {
    return Math.max(0, Math.round(price * 100) / 100);
  }
  
  if (typeof price === "string") {
    const num = parseFloat(price);
    if (!isNaN(num)) {
      return Math.max(0, Math.round(num * 100) / 100);
    }
  }
  
  // 处理对象格式（如 { amount: "10.00" }）
  if (price && typeof price === "object") {
    const priceObj = price as Record<string, unknown>;
    const amount = priceObj.amount || priceObj.value;
    return normalizeItemPrice(amount);
  }
  
  return 0;
}

/**
 * 规范化数量
 */
function normalizeQuantity(quantity: unknown): number {
  if (typeof quantity === "number") {
    return Math.max(1, Math.round(quantity));
  }
  
  if (typeof quantity === "string") {
    const num = parseInt(quantity, 10);
    if (!isNaN(num)) {
      return Math.max(1, num);
    }
  }
  
  return 1; // 默认数量
}

/**
 * 提取字符串值
 */
function extractString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

/**
 * 生成去重键（P1-01: 统一去重键规则）
 * 
 * 规则：checkout_token/order_id + event_name + line_hash
 * 用于 client/server 混合时可 dedup
 */
export function generateDeduplicationKey(
  canonicalEvent: CanonicalEvent
): string {
  const { createHash } = require("crypto");
  
  // 使用订单标识符（优先 orderId，其次 checkoutToken）
  const identifier = canonicalEvent.orderId || canonicalEvent.checkoutToken || "";
  
  // 生成商品列表哈希（用于检测商品变化）
  const itemsHash = generateItemsHash(canonicalEvent.items);
  
  // 组合去重键：identifier + eventName + itemsHash
  const keyInput = `${canonicalEvent.shopDomain}:${identifier}:${canonicalEvent.eventName}:${itemsHash}`;
  
  return createHash("sha256")
    .update(keyInput, "utf8")
    .digest("hex")
    .substring(0, 32);
}

/**
 * 生成商品列表哈希
 */
function generateItemsHash(items: CanonicalItem[]): string {
  const { createHash } = require("crypto");
  
  if (items.length === 0) {
    return "empty";
  }
  
  // 按商品 ID 和数量排序，生成哈希
  const sortedItems = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => `${item.id}:${item.quantity}`)
    .join(",");
  
  return createHash("sha256")
    .update(sortedItems, "utf8")
    .digest("hex")
    .substring(0, 16);
}

/**
 * 验证规范化事件的完整性
 */
export function validateCanonicalEvent(
  event: CanonicalEvent
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 验证事件名称
  if (!event.eventName || event.eventName.trim().length === 0) {
    errors.push("eventName is required");
  }
  
  // 验证时间戳
  if (!event.timestamp || event.timestamp <= 0) {
    errors.push("timestamp is required and must be positive");
  }
  
  // 验证 shopDomain
  if (!event.shopDomain || event.shopDomain.trim().length === 0) {
    errors.push("shopDomain is required");
  }
  
  // 对于购买事件，验证订单标识符
  if (event.eventName === "checkout_completed" || event.eventName === "purchase") {
    if (!event.orderId && !event.checkoutToken) {
      errors.push("orderId or checkoutToken is required for purchase events");
    }
  }
  
  // 验证金额
  if (event.value < 0) {
    errors.push("value must be non-negative");
  }
  
  // 验证货币代码
  if (!/^[A-Z]{3}$/.test(event.currency)) {
    errors.push("currency must be a valid ISO 4217 code (3 uppercase letters)");
  }
  
  // 验证商品列表（对于包含商品的事件）
  const eventsWithItems = [
    "checkout_completed",
    "checkout_started",
    "product_added_to_cart",
    "purchase",
  ];
  
  if (eventsWithItems.includes(event.eventName)) {
    if (event.items.length === 0) {
      errors.push(`items array is required for ${event.eventName} events`);
    }
    
    // 验证每个商品
    for (let i = 0; i < event.items.length; i++) {
      const item = event.items[i];
      if (!item.id || item.id.trim().length === 0) {
        errors.push(`items[${i}].id is required`);
      }
      if (item.price < 0) {
        errors.push(`items[${i}].price must be non-negative`);
      }
      if (item.quantity < 1) {
        errors.push(`items[${i}].quantity must be at least 1`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

