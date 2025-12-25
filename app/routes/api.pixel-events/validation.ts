/**
 * Pixel Events API - Validation Logic
 *
 * Request validation for pixel event payloads.
 * Implements P1-01 validation constants for abuse prevention.
 */

import type {
  PixelEventPayload,
  PixelEventName,
  ValidationResult,
} from "./types";

// =============================================================================
// Validation Constants
// =============================================================================

/**
 * P1-01: Validation constants for abuse prevention
 *
 * Since the ingestion key (X-Tracking-Guardian-Key) is visible in browser DevTools,
 * we cannot rely on it as strong authentication. Instead, we use these validation
 * rules to filter out obviously malformed or abusive requests:
 *
 * 1. checkoutToken: Must match Shopify's token format
 * 2. orderId: Must be numeric or GID format
 * 3. timestamp: Must be reasonable (not 1970, not far future)
 * 4. consent fields: Must be boolean if present
 *
 * Actual trust comes from:
 * - Matching checkoutToken with webhook's checkout_token (see receipt-trust.ts)
 * - Origin validation against shop's allowed domains
 * - Nonce/replay protection
 */
export const CHECKOUT_TOKEN_MIN_LENGTH = 8;
export const CHECKOUT_TOKEN_MAX_LENGTH = 128;
export const CHECKOUT_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const ORDER_ID_PATTERN = /^(gid:\/\/shopify\/Order\/)?(\d+)$/;
export const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
export const MIN_REASONABLE_TIMESTAMP = 1577836800000; // 2020-01-01
export const MAX_FUTURE_TIMESTAMP_MS = 86400000; // 24 hours in future

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate the basic request body structure.
 */
function validateBodyStructure(
  body: unknown
): { valid: true; data: Record<string, unknown> } | ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body", code: "invalid_body" };
  }
  return { valid: true, data: body as Record<string, unknown> };
}

/**
 * Validate required fields: eventName, shopDomain, timestamp.
 */
function validateRequiredFields(
  data: Record<string, unknown>
): ValidationResult | null {
  if (!data.eventName || typeof data.eventName !== "string") {
    return { valid: false, error: "Missing eventName", code: "missing_event_name" };
  }

  if (!data.shopDomain || typeof data.shopDomain !== "string") {
    return { valid: false, error: "Missing shopDomain", code: "missing_shop_domain" };
  }

  if (!SHOP_DOMAIN_PATTERN.test(data.shopDomain as string)) {
    return {
      valid: false,
      error: "Invalid shop domain format",
      code: "invalid_shop_domain_format",
    };
  }

  if (data.timestamp === undefined || data.timestamp === null) {
    return { valid: false, error: "Missing timestamp", code: "missing_timestamp" };
  }

  if (typeof data.timestamp !== "number") {
    return { valid: false, error: "Invalid timestamp type", code: "invalid_timestamp_type" };
  }

  // P1-01: Validate timestamp is reasonable (not 1970, not far future)
  const now = Date.now();
  if (
    data.timestamp < MIN_REASONABLE_TIMESTAMP ||
    data.timestamp > now + MAX_FUTURE_TIMESTAMP_MS
  ) {
    return {
      valid: false,
      error: "Timestamp outside reasonable range",
      code: "invalid_timestamp_value",
    };
  }

  return null; // No errors
}

/**
 * Validate consent structure if present.
 */
function validateConsentFormat(
  consent: unknown
): ValidationResult | null {
  if (consent === undefined) {
    return null;
  }

  if (typeof consent !== "object" || consent === null) {
    return { valid: false, error: "Invalid consent format", code: "invalid_consent_format" };
  }

  const consentObj = consent as Record<string, unknown>;

  // P1-01: Consent fields must be booleans if present
  if (consentObj.marketing !== undefined && typeof consentObj.marketing !== "boolean") {
    return {
      valid: false,
      error: "consent.marketing must be boolean",
      code: "invalid_consent_format",
    };
  }

  if (consentObj.analytics !== undefined && typeof consentObj.analytics !== "boolean") {
    return {
      valid: false,
      error: "consent.analytics must be boolean",
      code: "invalid_consent_format",
    };
  }

  if (consentObj.saleOfData !== undefined && typeof consentObj.saleOfData !== "boolean") {
    return {
      valid: false,
      error: "consent.saleOfData must be boolean",
      code: "invalid_consent_format",
    };
  }

  return null;
}

/**
 * Validate checkout_completed event specific fields.
 */
function validateCheckoutCompletedFields(
  eventData: Record<string, unknown> | undefined
): ValidationResult | null {
  if (!eventData?.orderId && !eventData?.checkoutToken) {
    return {
      valid: false,
      error: "Missing orderId and checkoutToken for checkout_completed event",
      code: "missing_order_identifiers",
    };
  }

  // P1-01: Validate checkoutToken format if present
  if (eventData?.checkoutToken) {
    const token = String(eventData.checkoutToken);
    if (
      token.length < CHECKOUT_TOKEN_MIN_LENGTH ||
      token.length > CHECKOUT_TOKEN_MAX_LENGTH
    ) {
      return {
        valid: false,
        error: "Invalid checkoutToken length",
        code: "invalid_checkout_token_format",
      };
    }
    if (!CHECKOUT_TOKEN_PATTERN.test(token)) {
      return {
        valid: false,
        error: "Invalid checkoutToken format",
        code: "invalid_checkout_token_format",
      };
    }
  }

  // P1-01: Validate orderId format if present (must be numeric or GID)
  if (eventData?.orderId) {
    const orderIdStr = String(eventData.orderId);
    if (!ORDER_ID_PATTERN.test(orderIdStr)) {
      return {
        valid: false,
        error: "Invalid orderId format",
        code: "invalid_order_id_format",
      };
    }
  }

  // Validate value and currency
  if (eventData?.value !== undefined) {
    const val = Number(eventData.value);
    if (isNaN(val) || val < 0) {
      return {
        valid: false,
        error: "Invalid order value",
        code: "invalid_body",
      };
    }
  }

  if (eventData?.currency) {
    if (typeof eventData.currency !== "string" || !/^[A-Z]{3}$/.test(eventData.currency)) {
      return {
        valid: false,
        error: "Invalid currency format (must be 3-letter ISO code)",
        code: "invalid_body",
      };
    }
  }

  return null;
}

/**
 * Main validation function for pixel event requests.
 */
export function validateRequest(body: unknown): ValidationResult {
  // Step 1: Validate body structure
  const bodyResult = validateBodyStructure(body);
  if (!bodyResult.valid) {
    return bodyResult as ValidationResult;
  }
  const data = (bodyResult as { valid: true; data: Record<string, unknown> }).data;

  // Step 2: Validate required fields
  const requiredFieldsError = validateRequiredFields(data);
  if (requiredFieldsError) {
    return requiredFieldsError;
  }

  // Step 3: Validate consent format
  const consentError = validateConsentFormat(data.consent);
  if (consentError) {
    return consentError;
  }

  // Step 4: Validate checkout_completed specific fields
  if (data.eventName === "checkout_completed") {
    const eventData = data.data as Record<string, unknown> | undefined;
    const checkoutError = validateCheckoutCompletedFields(eventData);
    if (checkoutError) {
      return checkoutError;
    }
  }

  // Build validated payload
  return {
    valid: true,
    payload: {
      eventName: data.eventName as PixelEventName,
      timestamp: data.timestamp as number,
      shopDomain: data.shopDomain as string,
      consent: data.consent as PixelEventPayload["consent"] | undefined,
      data: (data.data as PixelEventPayload["data"]) || {},
    },
  };
}

/**
 * Check if an event is a primary event (triggers CAPI).
 */
export function isPrimaryEvent(eventName: string): boolean {
  return eventName === "checkout_completed";
}

// =============================================================================
// P1-5: Pixel Config Validation
// =============================================================================

/**
 * P1-5: Pixel configuration structure
 */
export interface PixelConfig {
  schema_version: "1";
  mode: "purchase_only" | "full_funnel";
  enabled_platforms: string;
  strictness: "strict" | "balanced";
}

/**
 * P1-5: Default pixel configuration
 */
export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

/**
 * P1-5: Parse and validate pixel_config from payload
 */
export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }
  
  try {
    const parsed = JSON.parse(configStr);
    
    // Validate schema version
    if (parsed.schema_version !== "1") {
      return DEFAULT_PIXEL_CONFIG;
    }
    
    return {
      schema_version: "1",
      mode: parsed.mode === "full_funnel" ? "full_funnel" : "purchase_only",
      enabled_platforms: typeof parsed.enabled_platforms === "string" 
        ? parsed.enabled_platforms 
        : DEFAULT_PIXEL_CONFIG.enabled_platforms,
      strictness: parsed.strictness === "balanced" ? "balanced" : "strict",
    };
  } catch {
    return DEFAULT_PIXEL_CONFIG;
  }
}

/**
 * P1-5: Check if a platform is enabled in the pixel config
 */
export function isPlatformEnabled(config: PixelConfig, platform: string): boolean {
  const normalizedPlatform = platform.toLowerCase();
  const enabledPlatforms = config.enabled_platforms.toLowerCase().split(",").map(p => p.trim());
  
  // Handle aliases
  const platformAliases: Record<string, string[]> = {
    google: ["google", "ga4", "analytics"],
    meta: ["meta", "facebook", "fb"],
    tiktok: ["tiktok", "tt"],
  };
  
  for (const [canonical, aliases] of Object.entries(platformAliases)) {
    if (aliases.includes(normalizedPlatform)) {
      return enabledPlatforms.some(p => aliases.includes(p) || p === canonical);
    }
  }
  
  return enabledPlatforms.includes(normalizedPlatform);
}

