

import { logger } from '../utils/logger.server';
import {
  validatePixelEvent as validateWithZod,
  validateSimplePixelEvent,
  type PixelEventInput
} from '../schemas';

export type PixelEventName =
  | 'checkout_completed'
  | 'checkout_started'
  | 'checkout_contact_info_submitted'
  | 'checkout_shipping_info_submitted'
  | 'payment_info_submitted'
  | 'page_viewed'
  | 'product_added_to_cart';

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

export type ValidationResult =
  | { valid: true; payload: PixelEventPayload }
  | { valid: false; error: string; code: ValidationError };


import {
  CHECKOUT_TOKEN_PATTERN,
  CHECKOUT_TOKEN_MIN_LENGTH,
  CHECKOUT_TOKEN_MAX_LENGTH,
  ORDER_ID_PATTERN,
  SHOP_DOMAIN_PATTERN,
  MIN_REASONABLE_TIMESTAMP,
  MAX_FUTURE_TIMESTAMP_MS,
} from '../schemas/pixel-event';

export const PRIMARY_EVENTS = ['checkout_completed'] as const;

export const FUNNEL_EVENTS = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'page_viewed',
  'product_added_to_cart',
] as const;

export function isPrimaryEvent(eventName: string): boolean {
  return PRIMARY_EVENTS.includes(eventName as typeof PRIMARY_EVENTS[number]);
}

export function isFunnelEvent(eventName: string): boolean {
  return FUNNEL_EVENTS.includes(eventName as typeof FUNNEL_EVENTS[number]);
}

export function validateCheckoutToken(token: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!token) {
    return { valid: true };
  }

  if (token.length < CHECKOUT_TOKEN_MIN_LENGTH || token.length > CHECKOUT_TOKEN_MAX_LENGTH) {
    return { valid: false, error: 'Invalid checkoutToken length' };
  }

  if (!CHECKOUT_TOKEN_PATTERN.test(token)) {
    return { valid: false, error: 'Invalid checkoutToken format' };
  }

  return { valid: true };
}

export function validateOrderId(orderId: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!orderId) {
    return { valid: true };
  }

  const orderIdStr = String(orderId);
  if (!ORDER_ID_PATTERN.test(orderIdStr)) {
    return { valid: false, error: 'Invalid orderId format' };
  }

  return { valid: true };
}

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

export function validateRequest(body: unknown): ValidationResult {

  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body', code: 'invalid_body' };
  }

  const data = body as Record<string, unknown>;

  if (!data.eventName || typeof data.eventName !== 'string') {
    return { valid: false, error: 'Missing eventName', code: 'missing_event_name' };
  }

  const shopDomainCheck = validateShopDomain(data.shopDomain as string);
  if (!shopDomainCheck.valid) {
    const code = !data.shopDomain ? 'missing_shop_domain' : 'invalid_shop_domain_format';
    return { valid: false, error: shopDomainCheck.error!, code };
  }

  const timestampCheck = validateTimestamp(data.timestamp);
  if (!timestampCheck.valid) {
    const code = data.timestamp === undefined || data.timestamp === null
      ? 'missing_timestamp'
      : typeof data.timestamp !== 'number'
        ? 'invalid_timestamp_type'
        : 'invalid_timestamp_value';
    return { valid: false, error: timestampCheck.error!, code };
  }

  const consentCheck = validateConsentFormat(data.consent);
  if (!consentCheck.valid) {
    return { valid: false, error: consentCheck.error!, code: 'invalid_consent_format' };
  }

  if (data.eventName === 'checkout_completed') {
    const eventData = data.data as Record<string, unknown> | undefined;

    if (!eventData?.orderId && !eventData?.checkoutToken) {
      return {
        valid: false,
        error: 'Missing orderId and checkoutToken for checkout_completed event',
        code: 'missing_order_identifiers'
      };
    }

    const tokenCheck = validateCheckoutToken(eventData?.checkoutToken as string);
    if (!tokenCheck.valid) {
      return { valid: false, error: tokenCheck.error!, code: 'invalid_checkout_token_format' };
    }

    const orderIdCheck = validateOrderId(eventData?.orderId as string);
    if (!orderIdCheck.valid) {
      return { valid: false, error: orderIdCheck.error!, code: 'invalid_order_id_format' };
    }
  }

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

export function validateRequestWithZod(body: unknown): ValidationResult {
  const result = validateWithZod(body);

  if (result.success) {

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

export function hasAnyConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  if (!consent) return false;
  return consent.marketing === true || consent.analytics === true;
}

export function hasMarketingConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.marketing === true;
}

export function hasAnalyticsConsent(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.analytics === true;
}

export function isSaleOfDataAllowed(consent: PixelEventPayload['consent'] | undefined): boolean {
  return consent?.saleOfData === true;
}

export function getConsentSummary(consent: PixelEventPayload['consent'] | undefined): string {
  if (!consent) return 'no_consent';

  const parts: string[] = [];
  if (consent.marketing === true) parts.push('marketing');
  if (consent.analytics === true) parts.push('analytics');
  if (consent.saleOfData === true) parts.push('saleOfData');

  return parts.length > 0 ? parts.join(',') : 'none_granted';
}

export interface KeyValidationResult {
  matched: boolean;
  reason: string;
  usedPreviousSecret?: boolean;
}

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

export function getSignatureStatus(keyValidation: KeyValidationResult): string {
  return keyValidation.matched ? 'key_matched' : keyValidation.reason;
}

