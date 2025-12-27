/**
 * PII (Personally Identifiable Information) Handling Utilities
 *
 * Provides safe extraction, masking, and validation of PII data.
 * Critical for GDPR/CCPA compliance and audit logging.
 */

import type { OrderWebhookPayload } from "../types";
import { logger } from "./logger.server";

// =============================================================================
// Types
// =============================================================================

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
 * PII fields that should never appear in logs.
 */
export const PII_FIELD_NAMES = [
  "email",
  "phone",
  "firstName",
  "lastName",
  "first_name",
  "last_name",
  "address",
  "address1",
  "address2",
  "billing_address",
  "shipping_address",
  "customer",
  "ip",
  "ip_address",
  "password",
  "credit_card",
  "card_number",
  "cvv",
  "ssn",
  "social_security",
] as const;

/**
 * Common PII patterns for detection.
 */
export const PII_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-()]{7,20}$/,
  ipv4: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  creditCard: /^\d{13,19}$/,
  ssn: /^\d{3}-?\d{2}-?\d{4}$/,
  zip: /^\d{5}(-\d{4})?$/,
} as const;

// =============================================================================
// PII Normalization
// =============================================================================

/**
 * Normalize and sanitize a PII value.
 */
function normalize(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// =============================================================================
// PII Extraction
// =============================================================================

/**
 * Safely extract PII from a webhook payload.
 * Returns empty object if PII extraction is disabled.
 */
export function extractPIISafely(
  payload: OrderWebhookPayload | null | undefined,
  piiEnabled: boolean
): ExtractedPII {
  if (!piiEnabled || !payload) {
    return {};
  }

  const billingAddress = payload.billing_address || {};
  const customer = payload.customer || {};

  return {
    email: normalize(payload.email),
    phone: normalize(payload.phone) || normalize(billingAddress.phone),
    firstName:
      normalize(customer.first_name) || normalize(billingAddress.first_name),
    lastName:
      normalize(customer.last_name) || normalize(billingAddress.last_name),
    city: normalize(billingAddress.city),
    state: normalize(billingAddress.province),
    country: normalize(billingAddress.country_code),
    zip: normalize(billingAddress.zip),
  };
}

/**
 * Check if any PII fields are present.
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
 * Log PII availability status (without actual PII values).
 */
export function logPIIStatus(
  orderId: string,
  pii: ExtractedPII,
  piiEnabled: boolean
): void {
  if (!piiEnabled) {
    logger.debug(`[PII] Order ${orderId}: PII disabled`);
    return;
  }

  const available: string[] = [];
  const missing: string[] = [];
  const fields = [
    "email",
    "phone",
    "firstName",
    "lastName",
    "city",
    "state",
    "country",
    "zip",
  ] as const;

  for (const field of fields) {
    if (pii[field]) {
      available.push(field);
    } else {
      missing.push(field);
    }
  }

  if (available.length === 0) {
    logger.debug(
      `[PII] Order ${orderId}: No PII available. ` +
        `This may indicate Protected Customer Data access is not granted.`
    );
  } else {
    logger.debug(
      `[PII] Order ${orderId}: Available=[${available.join(",")}], Missing=[${missing.join(",")}]`
    );
  }
}

// =============================================================================
// PII Masking
// =============================================================================

/**
 * Mask an email address for display.
 * e.g., "user@example.com" -> "u***@e***.com"
 */
export function maskEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;

  const [local, domain] = email.split("@");
  if (!domain) return "***";

  const [domainName, ...tld] = domain.split(".");
  const maskedLocal = local.length > 1 ? `${local[0]}***` : "***";
  const maskedDomain =
    domainName.length > 1 ? `${domainName[0]}***` : "***";

  return `${maskedLocal}@${maskedDomain}.${tld.join(".")}`;
}

/**
 * Mask a phone number for display.
 * e.g., "+1234567890" -> "+1***890"
 */
export function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";

  const lastFour = digits.slice(-4);
  const firstPart = digits.slice(0, Math.min(2, digits.length - 4));
  return `${firstPart}***${lastFour}`;
}

/**
 * Mask a name for display.
 * e.g., "John" -> "J***"
 */
export function maskName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name.length <= 1) return "*";
  return `${name[0]}***`;
}

/**
 * Create a masked version of PII for safe logging.
 */
export function maskPII(pii: ExtractedPII): Record<string, string | undefined> {
  return {
    email: maskEmail(pii.email),
    phone: maskPhone(pii.phone),
    firstName: maskName(pii.firstName),
    lastName: maskName(pii.lastName),
    city: pii.city ? `${pii.city[0]}***` : undefined,
    state: pii.state,
    country: pii.country,
    zip: pii.zip ? `${pii.zip.slice(0, 2)}***` : undefined,
  };
}

// =============================================================================
// PII Sanitization for Logs
// =============================================================================

/**
 * Recursively sanitize an object by removing or masking PII fields.
 */
export function sanitizeForLogging<T extends Record<string, unknown>>(
  obj: T,
  options: { mask?: boolean; deep?: boolean } = {}
): T {
  const { mask = true, deep = true } = options;

  const sanitized = { ...obj } as Record<string, unknown>;

  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();

    // Check if this is a known PII field
    const isPiiField = PII_FIELD_NAMES.some(
      (field) => lowerKey === field.toLowerCase() || lowerKey.includes(field.toLowerCase())
    );

    if (isPiiField) {
      if (mask) {
        // Mask the value based on its type
        if (typeof value === "string") {
          if (PII_PATTERNS.email.test(value)) {
            sanitized[key] = maskEmail(value);
          } else if (PII_PATTERNS.phone.test(value)) {
            sanitized[key] = maskPhone(value);
          } else {
            sanitized[key] = value.length > 2 ? `${value[0]}***` : "***";
          }
        } else {
          sanitized[key] = "[REDACTED]";
        }
      } else {
        sanitized[key] = "[REDACTED]";
      }
    } else if (deep && value && typeof value === "object" && !Array.isArray(value)) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeForLogging(value as Record<string, unknown>, options);
    } else if (deep && Array.isArray(value)) {
      // Sanitize array items
      sanitized[key] = value.map((item) =>
        item && typeof item === "object"
          ? sanitizeForLogging(item as Record<string, unknown>, options)
          : item
      );
    }
  }

  return sanitized as T;
}

/**
 * Check if a value looks like PII based on patterns.
 */
export function detectPII(value: unknown): {
  isPII: boolean;
  type?: keyof typeof PII_PATTERNS;
} {
  if (typeof value !== "string") {
    return { isPII: false };
  }

  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    if (pattern.test(value)) {
      return { isPII: true, type: type as keyof typeof PII_PATTERNS };
    }
  }

  return { isPII: false };
}

// =============================================================================
// PII Validation
// =============================================================================

/**
 * Validate email format.
 */
export function isValidEmail(email: string): boolean {
  return PII_PATTERNS.email.test(email);
}

/**
 * Validate phone format.
 */
export function isValidPhone(phone: string): boolean {
  return PII_PATTERNS.phone.test(phone);
}

/**
 * Normalize phone number to E.164 format if possible.
 * 
 * E.164 format: +[country code][subscriber number]
 * Examples: +14155551234, +442071234567
 */
export function normalizePhone(phone: string): string | null {
  // Check if original phone starts with +
  const hasPlus = phone.startsWith("+");
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) {
    return null;
  }

  // Assume US if 10 digits and no country code indicator
  if (digits.length === 10 && !hasPlus) {
    return `+1${digits}`;
  }

  // Already has country code (indicated by + prefix or > 10 digits)
  return `+${digits}`;
}

/**
 * Normalize email to lowercase and trim.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

// =============================================================================
// PII Quality Score
// =============================================================================

/**
 * Calculate PII quality score (0-100) based on available fields.
 */
export function calculatePIIQuality(pii: ExtractedPII): number {
  const weights = {
    email: 30,
    phone: 25,
    firstName: 10,
    lastName: 10,
    city: 5,
    state: 5,
    country: 10,
    zip: 5,
  };

  let score = 0;

  for (const [field, weight] of Object.entries(weights)) {
    if (pii[field as keyof ExtractedPII]) {
      score += weight;
    }
  }

  return score;
}

/**
 * Get PII quality label.
 */
export function getPIIQualityLabel(
  score: number
): "high" | "medium" | "low" | "none" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  if (score > 0) return "low";
  return "none";
}
