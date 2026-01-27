import type { PixelEventName } from "./constants";
import { PRIMARY_EVENTS, FUNNEL_EVENTS } from "./constants";

export type { PixelEventName };
export { PRIMARY_EVENTS, FUNNEL_EVENTS };

export interface ConsentState {
  marketing?: boolean;
  analytics?: boolean;
  saleOfDataAllowed?: boolean;
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
  environment?: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
  [key: string]: unknown;
}

export interface PixelEventPayload {
  eventName: PixelEventName;
  timestamp: number;
  shopDomain: string;
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
  trustLevel?: "trusted" | "partial" | "untrusted";
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
