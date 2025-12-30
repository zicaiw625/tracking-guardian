
import type { Platform } from "../types/platform";

/**
 * Shopify 标准事件类型
 */
export type ShopifyEventType = 
  | "checkout_completed"
  | "checkout_started"
  | "add_to_cart"
  | "view_item"
  | "remove_from_cart"
  | "page_view"
  | "search"
  | "view_collection";

/**
 * 平台事件映射表
 * 定义 Shopify 事件到各平台事件的映射关系
 */
export const EVENT_MAPPINGS: Record<
  Platform,
  Record<ShopifyEventType, string>
> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    add_to_cart: "add_to_cart",
    view_item: "view_item",
    remove_from_cart: "remove_from_cart",
    page_view: "page_view",
    search: "search",
    view_collection: "view_item_list",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_item: "ViewContent",
    remove_from_cart: "RemoveFromCart",
    page_view: "PageView",
    search: "Search",
    view_collection: "ViewCategory",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_item: "ViewContent",
    remove_from_cart: "RemoveFromCart",
    page_view: "PageView",
    search: "Search",
    view_collection: "ViewCategory",
  },
  pinterest: {
    checkout_completed: "checkout",
    checkout_started: "checkout",
    add_to_cart: "addtocart",
    view_item: "pagevisit",
    remove_from_cart: "removefromcart",
    page_view: "pagevisit",
    search: "search",
    view_collection: "pagevisit",
  },
};

/**
 * 获取平台事件名称
 */
export function getPlatformEventName(
  platform: Platform,
  shopifyEvent: ShopifyEventType
): string {
  return EVENT_MAPPINGS[platform]?.[shopifyEvent] || shopifyEvent;
}

/**
 * 事件参数清洗和规范化
 */
export interface EventParams {
  value?: number;
  currency?: string;
  items?: Array<{
    item_id?: string;
    item_name?: string;
    quantity?: number;
    price?: number;
  }>;
  content_ids?: string[];
  content_type?: string;
  [key: string]: unknown;
}

/**
 * 清洗事件参数，确保符合平台要求
 */
export function sanitizeEventParams(
  platform: Platform,
  eventType: ShopifyEventType,
  params: EventParams
): EventParams {
  const sanitized: EventParams = { ...params };

  // 确保 currency 是有效的 ISO 4217 代码
  if (sanitized.currency) {
    sanitized.currency = sanitized.currency.toUpperCase().substring(0, 3);
  } else {
    sanitized.currency = "USD"; // 默认货币
  }

  // 确保 value 是数字
  if (sanitized.value !== undefined) {
    sanitized.value = Number(sanitized.value) || 0;
  }

  // 平台特定的参数清洗
  switch (platform) {
    case "google":
      // GA4 要求 items 数组格式
      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.items = sanitized.items.map((item) => ({
          item_id: String(item.item_id || ""),
          item_name: String(item.item_name || ""),
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
        }));
      }
      break;

    case "meta":
      // Meta 要求 content_ids 和 content_type
      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.content_ids = sanitized.items
          .map((item) => String(item.item_id || ""))
          .filter((id) => id.length > 0);
        sanitized.content_type = "product";
      }
      // Meta 要求 value 和 currency 同时存在
      if (sanitized.value !== undefined && sanitized.currency) {
        sanitized.value = sanitized.value;
        sanitized.currency = sanitized.currency;
      }
      break;

    case "tiktok":
      // TikTok 要求 content_type
      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.content_type = "product";
        sanitized.content_ids = sanitized.items
          .map((item) => String(item.item_id || ""))
          .filter((id) => id.length > 0);
      }
      break;

    case "pinterest":
      // Pinterest 要求特定的参数格式
      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.line_items = sanitized.items.map((item) => ({
          product_id: String(item.item_id || ""),
          product_name: String(item.item_name || ""),
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.price) || 0,
        }));
      }
      break;
  }

  return sanitized;
}

/**
 * 生成去重 ID
 * 用于防止同一事件被重复发送
 */
export function generateEventId(
  orderId: string,
  eventType: ShopifyEventType,
  shopDomain: string,
  platform?: Platform
): string {
  // 使用确定性算法生成 event_id
  // 格式: {shopDomain}-{orderId}-{eventType}-{platform}
  const components = [
    shopDomain.replace(/\./g, "-"),
    orderId,
    eventType,
    platform || "default",
  ];
  
  return components.join("-");
}

/**
 * 生成平台特定的去重 ID
 */
export function generatePlatformEventId(
  platform: Platform,
  orderId: string,
  eventType: ShopifyEventType,
  shopDomain: string
): string {
  switch (platform) {
    case "google":
      // GA4 使用 transaction_id
      return `transaction-${orderId}-${eventType}`;
    
    case "meta":
      // Meta 使用 event_id
      return `${shopDomain}-${orderId}-${eventType}-${Date.now()}`;
    
    case "tiktok":
      // TikTok 使用 event_id
      return `${orderId}-${eventType}-${Date.now()}`;
    
    case "pinterest":
      // Pinterest 使用 event_id
      return `${orderId}-${eventType}`;
    
    default:
      return generateEventId(orderId, eventType, shopDomain, platform);
  }
}

/**
 * 验证事件参数完整性
 */
export function validateEventParams(
  platform: Platform,
  eventType: ShopifyEventType,
  params: EventParams
): {
  valid: boolean;
  missingParams: string[];
  invalidParams: string[];
} {
  const missingParams: string[] = [];
  const invalidParams: string[] = [];

  // 必需参数检查
  const requiredParams: Record<Platform, string[]> = {
    google: ["value", "currency"],
    meta: ["value", "currency"],
    tiktok: ["value", "currency"],
    pinterest: ["value", "currency"],
  };

  const required = requiredParams[platform] || [];
  for (const param of required) {
    if (params[param] === undefined || params[param] === null) {
      missingParams.push(param);
    }
  }

  // 参数格式验证
  if (params.value !== undefined && (typeof params.value !== "number" || params.value < 0)) {
    invalidParams.push("value");
  }

  if (params.currency && typeof params.currency !== "string") {
    invalidParams.push("currency");
  }

  if (params.items && !Array.isArray(params.items)) {
    invalidParams.push("items");
  }

  return {
    valid: missingParams.length === 0 && invalidParams.length === 0,
    missingParams,
    invalidParams,
  };
}

/**
 * 获取默认事件映射配置
 */
export function getDefaultEventMappings(platform: Platform): Record<string, string> {
  const mappings: Record<string, string> = {};
  
  for (const [shopifyEvent, platformEvent] of Object.entries(EVENT_MAPPINGS[platform])) {
    mappings[shopifyEvent] = platformEvent;
  }
  
  return mappings;
}

/**
 * 合并自定义事件映射
 */
export function mergeEventMappings(
  platform: Platform,
  customMappings?: Record<string, string>
): Record<string, string> {
  const defaultMappings = getDefaultEventMappings(platform);
  
  if (!customMappings) {
    return defaultMappings;
  }
  
  return {
    ...defaultMappings,
    ...customMappings,
  };
}

