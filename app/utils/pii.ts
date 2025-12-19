/**
 * P0-6: PII (Personally Identifiable Information) Utilities
 * 
 * Provides null-safe extraction and sanitization of PII fields.
 * When Shopify's Protected Customer Data rules are enforced,
 * PII fields may be empty even if piiEnabled is true.
 */

import type { OrderWebhookPayload } from "../types";

/**
 * Extracted PII from an order, with all fields normalized to string | undefined
 */
export interface ExtractedPII {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}

/**
 * P0-6: Safely extract PII from order webhook payload
 * 
 * Returns undefined for any field that is null, empty, or invalid.
 * This function handles all the null-safety checks in one place.
 * 
 * @param payload - The order webhook payload from Shopify
 * @param piiEnabled - Whether PII extraction is enabled for this shop
 * @returns Extracted PII object with only valid, non-empty values
 */
export function extractPIISafely(
  payload: OrderWebhookPayload | null | undefined,
  piiEnabled: boolean
): ExtractedPII {
  // If PII is disabled or no payload, return empty object
  if (!piiEnabled || !payload) {
    return {};
  }

  // Helper to normalize string values
  const normalize = (value: string | null | undefined): string | undefined => {
    if (value === null || value === undefined) {
      return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const billingAddress = payload.billing_address || {};
  const customer = payload.customer || {};

  return {
    email: normalize(payload.email),
    phone: normalize(payload.phone) || normalize(billingAddress.phone),
    firstName: normalize(customer.first_name) || normalize(billingAddress.first_name),
    lastName: normalize(customer.last_name) || normalize(billingAddress.last_name),
    city: normalize(billingAddress.city),
    state: normalize(billingAddress.province),
    country: normalize(billingAddress.country_code),
    zip: normalize(billingAddress.zip),
  };
}

/**
 * P0-6: Check if any PII fields are available
 * 
 * Useful for logging and diagnostics to see if Protected Customer Data
 * restrictions are preventing PII from being sent.
 */
export function hasPII(pii: ExtractedPII): boolean {
  return !!(
    pii.email ||
    pii.phone ||
    pii.firstName ||
    pii.lastName ||
    pii.city ||
    pii.state ||
    pii.country ||
    pii.zip
  );
}

/**
 * P0-6: Log PII availability status (for diagnostics)
 * 
 * Logs a summary of which PII fields are available without logging the actual values.
 */
export function logPIIStatus(
  orderId: string,
  pii: ExtractedPII,
  piiEnabled: boolean
): void {
  if (!piiEnabled) {
    console.log(`[PII] Order ${orderId}: PII disabled`);
    return;
  }

  const available: string[] = [];
  const missing: string[] = [];

  const fields = ["email", "phone", "firstName", "lastName", "city", "state", "country", "zip"] as const;
  for (const field of fields) {
    if (pii[field]) {
      available.push(field);
    } else {
      missing.push(field);
    }
  }

  if (available.length === 0) {
    console.log(
      `[PII] Order ${orderId}: No PII available. ` +
      `This may indicate Protected Customer Data access is not granted.`
    );
  } else {
    console.log(
      `[PII] Order ${orderId}: Available=[${available.join(",")}], Missing=[${missing.join(",")}]`
    );
  }
}
