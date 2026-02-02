export const Platform = {
  GOOGLE: "google",
  META: "meta",
  FACEBOOK: "facebook",
  TIKTOK: "tiktok",
  UNKNOWN: "unknown",
} as const;

export type PlatformType = typeof Platform[keyof typeof Platform];

export const EventType = {
  PURCHASE: "purchase",
  ADD_TO_CART: "add_to_cart",
  BEGIN_CHECKOUT: "begin_checkout",
  PAGE_VIEW: "page_view",
  VIEW_CONTENT: "view_content",
} as const;

export type EventTypeType = typeof EventType[keyof typeof EventType];

export const HttpHeader = {
  X_SHOPIFY_TOPIC: "X-Shopify-Topic",
  X_SHOPIFY_SHOP_DOMAIN: "X-Shopify-Shop-Domain",
  X_SHOPIFY_HMAC: "X-Shopify-Hmac-Sha256",
  X_SHOPIFY_WEBHOOK_ID: "X-Shopify-Webhook-Id",
  X_SHOPIFY_EVENT_ID: "X-Shopify-Event-Id",
  X_FORWARDED_FOR: "x-forwarded-for",
} as const;

export const VerificationDefaults = {
  WINDOW_MS: 24 * 60 * 60 * 1000, // 24 hours
  MAX_RECEIPTS: 1000,
} as const;
