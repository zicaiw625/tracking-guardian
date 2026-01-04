

export type PixelEventName =
  | "checkout_completed"
  | "checkout_started"
  | "checkout_contact_info_submitted"
  | "checkout_shipping_info_submitted"
  | "payment_info_submitted"
  | "page_viewed"
  | "product_viewed"
  | "product_added_to_cart";

export const PRIMARY_EVENTS = ["checkout_completed"] as const;

export const FUNNEL_EVENTS = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "page_viewed",
  "product_viewed",
  "product_added_to_cart",
] as const;

export interface ConsentState {
  marketing?: boolean;
  analytics?: boolean;
  saleOfData?: boolean;
}

export interface PixelEventData {
  orderId?: string | null;
  orderNumber?: string;
  value?: number;
  currency?: string;
  tax?: number;
  shipping?: number;
  checkoutToken?: string | null;
  items?: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  itemCount?: number;
  url?: string;
  title?: string;
  productId?: string;
  productTitle?: string;
  price?: number;
  quantity?: number;
}

export interface PixelEventPayload {
  eventName: PixelEventName;
  timestamp: number;
  shopDomain: string;
  // P0-1: ingestionKey 已从 body 中移除，不再出现在请求体中
  // 安全验证完全依赖 HMAC 签名（X-Tracking-Guardian-Signature header）
  // 服务端通过 shopDomain 查找 shop.ingestionSecret 进行 HMAC 验证
  nonce?: string;
  consent?: ConsentState;
  data: PixelEventData;
}

export type ValidationErrorCode =
  | "invalid_body"
  | "missing_event_name"
  | "missing_shop_domain"
  | "invalid_shop_domain_format"
  | "missing_timestamp"
  | "invalid_timestamp_type"
  | "invalid_timestamp_value"
  | "missing_order_identifiers"
  | "invalid_checkout_token_format"
  | "invalid_order_id_format"
  | "invalid_consent_format";

export interface ValidationSuccess {
  valid: true;
  payload: PixelEventPayload;
}

export interface ValidationFailure {
  valid: false;
  error: string;
  code: ValidationErrorCode;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface KeyValidationResult {
  matched: boolean;
  reason: string;
  usedPreviousSecret?: boolean;
}

export interface ShopContext {
  id: string;
  shopDomain: string;
  isActive: boolean;
  ingestionSecret: string | null;
  previousIngestionSecret: string | null;
  previousSecretExpiry: Date | null;
  primaryDomain: string | null;
  storefrontDomains: string[];
}

export interface PixelEventSuccessResponse {
  success: true;
  eventId: string;
  message: string;
  clientSideSent?: boolean;
  platforms?: string[];
  skippedPlatforms?: string[];
  trusted?: boolean;
  consent?: ConsentState | null;
}

export interface PixelEventErrorResponse {
  error: string;
  maxSize?: number;
  retryAfter?: number;
}
