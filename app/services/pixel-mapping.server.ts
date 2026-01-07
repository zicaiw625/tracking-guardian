
import type { Platform } from "../types/platform";

export type ShopifyEventType =
  | "checkout_completed"
  | "checkout_started"
  | "add_to_cart"
  | "view_item"
  | "remove_from_cart"
  | "page_view"
  | "search"
  | "view_collection";

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
  snapchat: {
    checkout_completed: "PURCHASE",
    checkout_started: "START_CHECKOUT",
    add_to_cart: "ADD_CART",
    view_item: "VIEW_CONTENT",
    remove_from_cart: "REMOVE_FROM_CART",
    page_view: "PAGE_VIEW",
    search: "SEARCH",
    view_collection: "VIEW_CONTENT",
  },
  twitter: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_item: "ViewContent",
    remove_from_cart: "RemoveFromCart",
    page_view: "PageView",
    search: "Search",
    view_collection: "ViewContent",
  },
};

export function getPlatformEventName(
  platform: Platform,
  shopifyEvent: ShopifyEventType
): string {
  return EVENT_MAPPINGS[platform]?.[shopifyEvent] || shopifyEvent;
}

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

export function sanitizeEventParams(
  platform: Platform,
  eventType: ShopifyEventType,
  params: EventParams
): EventParams {
  const sanitized: EventParams = { ...params };

  if (sanitized.currency) {
    sanitized.currency = String(sanitized.currency).toUpperCase().substring(0, 3);
  }

  if (sanitized.value !== undefined) {
    sanitized.value = Number(sanitized.value) || 0;
  }

  switch (platform) {
    case "google":

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

      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.content_ids = sanitized.items
          .map((item) => String(item.item_id || ""))
          .filter((id) => id.length > 0);
        sanitized.content_type = "product";
      }

      if (sanitized.value !== undefined && sanitized.currency) {
        sanitized.value = sanitized.value;
        sanitized.currency = sanitized.currency;
      }
      break;

    case "tiktok":

      if (sanitized.items && Array.isArray(sanitized.items)) {
        sanitized.content_type = "product";
        sanitized.content_ids = sanitized.items
          .map((item) => String(item.item_id || ""))
          .filter((id) => id.length > 0);
      }
      break;

    case "pinterest":

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

export function generateEventId(
  orderId: string,
  eventType: ShopifyEventType,
  shopDomain: string,
  platform?: Platform
): string {

  const components = [
    shopDomain.replace(/\./g, "-"),
    orderId,
    eventType,
    platform || "default",
  ];

  return components.join("-");
}

export function generatePlatformEventId(
  platform: Platform,
  orderId: string,
  eventType: ShopifyEventType,
  shopDomain: string
): string {
  switch (platform) {
    case "google":

      return `transaction-${orderId}-${eventType}`;

    case "meta":

      return `${shopDomain}-${orderId}-${eventType}-${Date.now()}`;

    case "tiktok":

      return `${orderId}-${eventType}-${Date.now()}`;

    case "pinterest":

      return `${orderId}-${eventType}`;

    default:
      return generateEventId(orderId, eventType, shopDomain, platform);
  }
}

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

  const requiredParams: Record<Platform, string[]> = {
    google: ["value", "currency"],
    meta: ["value", "currency"],
    tiktok: ["value", "currency"],
    pinterest: ["value", "currency"],
    snapchat: ["value", "currency"],
    twitter: ["value", "currency"],
  };

  const required = requiredParams[platform] || [];
  for (const param of required) {
    if (params[param] === undefined || params[param] === null) {
      missingParams.push(param);
    }
  }

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

export function getDefaultEventMappings(platform: Platform): Record<string, string> {
  const mappings: Record<string, string> = {};

  for (const [shopifyEvent, platformEvent] of Object.entries(EVENT_MAPPINGS[platform])) {
    mappings[shopifyEvent] = platformEvent;
  }

  return mappings;
}

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

