/**
 * Pixel Event Validation Service
 * 
 * Extracted validation logic for pixel event payloads.
 * Provides type-safe validation with detailed error codes.
 */

import { logger } from '../utils/logger.server';
import { 
  validatePixelEvent as validateWithZod, 
  validateSimplePixelEvent,
  type PixelEventInput 
} from '../schemas';

// =============================================================================
// Types
// =============================================================================

/**
 * Pixel event names.
 */
export type PixelEventName = 
  | 'checkout_completed'
  | 'checkout_started'
  | 'checkout_contact_info_submitted'
  | 'checkout_shipping_info_submitted'
  | 'payment_info_submitted'
  | 'page_viewed'
  | 'product_added_to_cart';

/**
 * Pixel event payload structure.
 */
export interface PixelEventPayload {
  eventName: PixelEventName;
  timestamp: number;
  shopDomain: string;
  consent?: {
    marketing?: boolean;
    analytics?: boolean;
    saleOfData?: boolean;
  };
  data: {
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
  };
}

/**
 * Validation error codes.
 */
export type ValidationError =
  | 'invalid_body'
  | 'missing_event_name'
  | 'missing_shop_domain'
  | 'invalid_shop_domain_format'
  | 'missing_timestamp'
  | 'invalid_timestamp_type'
  | 'invalid_timestamp_value'
  | 'missing_order_identifiers'
  | 'invalid_checkout_token_format'
  | 'invalid_order_id_format'
  | 'invalid_consent_format';

/**
 * Validation result type.
 */
export type ValidationResult =
  | { valid: true; payload: PixelEventPayload }
  | { valid: false; error: string; code: ValidationError };

// =============================================================================
// Constants
// =============================================================================

/**
 * P1-01: Validation constants for abuse prevention
 * 
 * Since the ingestion key (X-Tracking-Guardian-Key) is visible in browser DevTools,
 * we cannot rely on it as strong authentication. Instead, we use these validation
 * rules to filter out obviously malformed or abusive requests.
 */
export const CHECKOUT_TOKEN_MIN_LENGTH = 8;
export const CHECKOUT_TOKEN_MAX_LENGTH = 128;
export const CHECKOUT_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const ORDER_ID_PATTERN = /^(gid:\/\/shopify\/Order\/)?(\d+)$/;
export const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
export const MIN_REASONABLE_TIMESTAMP = 1577836800000; // 2020-01-01
export const MAX_FUTURE_TIMESTAMP_MS = 86400000; // 24 hours

/**
 * Primary events that trigger CAPI.
 */
export const PRIMARY_EVENTS = ['checkout_completed'] as const;

/**
 * Funnel events (not primary).
 */
export const FUNNEL_EVENTS = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'page_viewed',
  'product_added_to_cart',
] as const;

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Check if event is a primary event (triggers CAPI).
 */
export function isPrimaryEvent(eventName: string): boolean {
  return PRIMARY_EVENTS.includes(eventName as typeof PRIMARY_EVENTS[number]);
}

/**
 * Check if event is a funnel event.
 */
export function isFunnelEvent(eventName: string): boolean {
  return FUNNEL_EVENTS.includes(eventName as typeof FUNNEL_EVENTS[number]);
}

/**
 * Validate checkout token format.
 */
export function validateCheckoutToken(token: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: true }; // Token is optional
  }
  
  if (token.length < CHECKOUT_TOKEN_MIN_LENGTH || token.length > CHECKOUT_TOKEN_MAX_LENGTH) {
    return { valid: false, error: 'Invalid checkoutToken length' };
  }
  
  if (!CHECKOUT_TOKEN_PATTERN.test(token)) {
    return { valid: false, error: 'Invalid checkoutToken format' };
  }
  
  return { valid: true };
}

/**
 * Validate order ID format.
 */
export function validateOrderId(orderId: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!orderId) {
    return { valid: true }; // Order ID may be absent
  }
  
  const orderIdStr = String(orderId);
  if (!ORDER_ID_PATTERN.test(orderIdStr)) {
    return { valid: false, error: 'Invalid orderId format' };
  }
  
  return { valid: true };
}

/**
 * Validate shop domain format.
 */
export function validateShopDomain(domain: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, error: 'Missing shopDomain' };
  }
  
  if (!SHOP_DOMAIN_PATTERN.test(domain)) {
    return { valid: false, error: 'Invalid shop domain format' };
  }
  
  return { valid: true };
}

/**
 * Validate timestamp is reasonable.
 */
export function validateTimestamp(timestamp: unknown): {
  valid: boolean;
  error?: string;
} {
  if (timestamp === undefined || timestamp === null) {
    return { valid: false, error: 'Missing timestamp' };
  }
  
  if (typeof timestamp !== 'number') {
    return { valid: false, error: 'Invalid timestamp type' };
  }
  
  const now = Date.now();
  if (timestamp < MIN_REASONABLE_TIMESTAMP || timestamp > now + MAX_FUTURE_TIMESTAMP_MS) {
    return { valid: false, error: 'Timestamp outside reasonable range' };
  }
  
  return { valid: true };
}

/**
 * Validate consent object format.
 */
export function validateConsentFormat(consent: unknown): {
  valid: boolean;
  error?: string;
} {
  if (consent === undefined) {
    return { valid: true };
  }
  
  if (typeof consent !== 'object' || consent === null) {
    return { valid: false, error: 'Invalid consent format' };
  }
  
  const consentObj = consent as Record<string, unknown>;
  
  if (consentObj.marketing !== undefined && typeof consentObj.marketing !== 'boolean') {
    return { valid: false, error: 'consent.marketing must be boolean' };
  }
  
  if (consentObj.analytics !== undefined && typeof consentObj.analytics !== 'boolean') {
    return { valid: false, error: 'consent.analytics must be boolean' };
  }
  
  if (consentObj.saleOfData !== undefined && typeof consentObj.saleOfData !== 'boolean') {
    return { valid: false, error: 'consent.saleOfData must be boolean' };
  }
  
  return { valid: true };
}

/**
 * Main validation function for pixel event requests.
 * 
 * Validates:
 * - Basic structure (body is object)
 * - Required fields (eventName, shopDomain, timestamp)
 * - Field formats (shop domain pattern, timestamp range)
 * - Consent format if present
 * - checkout_completed specific: orderId or checkoutToken required
 * - P1-01: Abuse prevention (token/orderId format validation)
 */
export function validateRequest(body: unknown): ValidationResult {
  // Basic structure check
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body', code: 'invalid_body' };
  }
  
  const data = body as Record<string, unknown>;
  
  // Event name
  if (!data.eventName || typeof data.eventName !== 'string') {
    return { valid: false, error: 'Missing eventName', code: 'missing_event_name' };
  }
  
  // Shop domain
  const shopDomainCheck = validateShopDomain(data.shopDomain as string);
  if (!shopDomainCheck.valid) {
    const code = !data.shopDomain ? 'missing_shop_domain' : 'invalid_shop_domain_format';
    return { valid: false, error: shopDomainCheck.error!, code };
  }
  
  // Timestamp
  const timestampCheck = validateTimestamp(data.timestamp);
  if (!timestampCheck.valid) {
    const code = data.timestamp === undefined || data.timestamp === null
      ? 'missing_timestamp'
      : typeof data.timestamp !== 'number'
        ? 'invalid_timestamp_type'
        : 'invalid_timestamp_value';
    return { valid: false, error: timestampCheck.error!, code };
  }
  
  // Consent format
  const consentCheck = validateConsentFormat(data.consent);
  if (!consentCheck.valid) {
    return { valid: false, error: consentCheck.error!, code: 'invalid_consent_format' };
  }
  
  // checkout_completed specific validation
  if (data.eventName === 'checkout_completed') {
    const eventData = data.data as Record<string, unknown> | undefined;
    
    // Must have orderId or checkoutToken
    if (!eventData?.orderId && !eventData?.checkoutToken) {
      return { 
        valid: false, 
        error: 'Missing orderId and checkoutToken for checkout_completed event', 
        code: 'missing_order_identifiers' 
      };
    }
    
    // P1-01: Validate checkoutToken format
    const tokenCheck = validateCheckoutToken(eventData?.checkoutToken as string);
    if (!tokenCheck.valid) {
      return { valid: false, error: tokenCheck.error!, code: 'invalid_checkout_token_format' };
    }
    
    // P1-01: Validate orderId format
    const orderIdCheck = validateOrderId(eventData?.orderId as string);
    if (!orderIdCheck.valid) {
      return { valid: false, error: orderIdCheck.error!, code: 'invalid_order_id_format' };
    }
  }
  
  // Validation passed
  return {
    valid: true,
    payload: {
      eventName: data.eventName as PixelEventName,
      timestamp: data.timestamp as number,
      shopDomain: data.shopDomain as string,
      consent: data.consent as PixelEventPayload['consent'] | undefined,
      data: (data.data as PixelEventPayload['data']) || {},
    },
  };
}

/**
 * Validate using Zod schema (stricter validation).
 * Use this when you want detailed validation errors.
 */
export function validateRequestWithZod(body: unknown): ValidationResult {
  const result = validateWithZod(body);
  
  if (result.success) {
    // Convert Zod output to our payload type
    const zodPayload = result.data;
    return {
      valid: true,
      payload: {
        eventName: zodPayload.eventName as PixelEventName,
        timestamp: zodPayload.timestamp,
        shopDomain: zodPayload.shopDomain,
        consent: zodPayload.consent,
        data: ('data' in zodPayload ? zodPayload.data : {}) as PixelEventPayload['data'],
      },
    };
  }
  
  return {
    valid: false,
    error: result.error,
    code: result.code as ValidationError,
  };
}

// =============================================================================
// Consent Helpers
// =============================================================================

/**
 * Check if payload has any consent signal.
 */
export function hasAnyConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  if (!consent) return false;
  return consent.marketing === true || consent.analytics === true;
}

/**
 * Check if marketing consent is granted.
 */
export function hasMarketingConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.marketing === true;
}

/**
 * Check if analytics consent is granted.
 */
export function hasAnalyticsConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.analytics === true;
}

/**
 * Check if sale of data is explicitly allowed.
 * P0-04: Must be EXPLICITLY true, not just "not false".
 */
export function isSaleOfDataAllowed(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.saleOfData === true;
}

/**
 * Get consent summary for logging.
 */
export function getConsentSummary(consent: PixelEventPayload['consent'] | undefined): string {
  if (!consent) return 'no_consent';
  
  const parts: string[] = [];
  if (consent.marketing === true) parts.push('marketing');
  if (consent.analytics === true) parts.push('analytics');
  if (consent.saleOfData === true) parts.push('saleOfData');
  
  return parts.length > 0 ? parts.join(',') : 'none_granted';
}

// =============================================================================
// Trust Level Helpers
// =============================================================================

/**
 * Key validation result.
 */
export interface KeyValidationResult {
  matched: boolean;
  reason: string;
  usedPreviousSecret?: boolean;
}

/**
 * Determine trust level from validation results.
 */
export function determineTrustLevel(
  keyValidation: KeyValidationResult,
  hasCheckoutToken: boolean
): { level: 'trusted' | 'partial' | 'untrusted'; reason?: string } {
  if (!keyValidation.matched) {
    return {
      level: 'untrusted',
      reason: keyValidation.reason || 'ingestion_key_invalid',
    };
  }
  
  if (hasCheckoutToken) {
    return { level: 'partial' };
  }
  
  return {
    level: 'partial',
    reason: 'missing_checkout_token',
  };
}

/**
 * Signature status string for database.
 */
export function getSignatureStatus(keyValidation: KeyValidationResult): string {
  return keyValidation.matched ? 'key_matched' : keyValidation.reason;
}

