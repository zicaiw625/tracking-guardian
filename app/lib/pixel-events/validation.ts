import type {
  PixelEventPayload,
  PixelEventName,
  ValidationResult,
} from "./types";

import {
  CHECKOUT_TOKEN_PATTERN,
  CHECKOUT_TOKEN_MIN_LENGTH,
  CHECKOUT_TOKEN_MAX_LENGTH,
  ORDER_ID_PATTERN,
  SHOP_DOMAIN_PATTERN,
  MIN_REASONABLE_TIMESTAMP,
  MAX_FUTURE_TIMESTAMP_MS,
} from '~/schemas/pixel-event';

function validateBodyStructure(
  body: unknown
): { valid: true; data: Record<string, unknown> } | ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body", code: "invalid_body" };
  }
  return { valid: true, data: body as Record<string, unknown> };
}

function normalizeEventFields(
  data: Record<string, unknown>
): {
  eventName: string;
  timestamp: number;
  shopDomain: string;
  eventId?: string;
  nonce?: string;
  context?: unknown;
} | null {
  const isPRDFormat = "event_name" in data;
  let eventName: string | undefined;
  let timestamp: number | undefined;
  let shopDomain: string | undefined;
  let eventId: string | undefined;
  let nonce: string | undefined;
  let context: unknown | undefined;
  if (isPRDFormat) {
    eventName = data.event_name as string | undefined;
    timestamp = data.ts as number | undefined;
    eventId = data.event_id as string | undefined;
    context = data.context;
    shopDomain = (data.shopDomain || (context as Record<string, unknown>)?.shopDomain) as string | undefined;
  } else {
    eventName = data.eventName as string | undefined;
    timestamp = data.timestamp as number | undefined;
    shopDomain = data.shopDomain as string | undefined;
    nonce = data.nonce as string | undefined;
    eventId = data.eventId as string | undefined;
  }
  if (!eventName || typeof eventName !== "string") {
    return null;
  }
  if (!shopDomain || typeof shopDomain !== "string") {
    return null;
  }
  if (timestamp === undefined || timestamp === null) {
    return null;
  }
  if (typeof timestamp !== "number") {
    return null;
  }
  return {
    eventName,
    timestamp,
    shopDomain,
    eventId,
    nonce,
    context,
  };
}

function validateRequiredFields(
  data: Record<string, unknown>
): ValidationResult | null {
  const normalized = normalizeEventFields(data);
  if (!normalized) {
    const isPRDFormat = "event_name" in data;
    if (isPRDFormat) {
      if (!data.event_name || typeof data.event_name !== "string") {
        return { valid: false, error: "Missing event_name", code: "missing_event_name" };
      }
      if (data.ts === undefined || data.ts === null) {
        return { valid: false, error: "Missing ts", code: "missing_timestamp" };
      }
      if (typeof data.ts !== "number") {
        return { valid: false, error: "Invalid ts type", code: "invalid_timestamp_type" };
      }
    } else {
      if (!data.eventName || typeof data.eventName !== "string") {
        return { valid: false, error: "Missing eventName", code: "missing_event_name" };
      }
      if (data.timestamp === undefined || data.timestamp === null) {
        return { valid: false, error: "Missing timestamp", code: "missing_timestamp" };
      }
      if (typeof data.timestamp !== "number") {
        return { valid: false, error: "Invalid timestamp type", code: "invalid_timestamp_type" };
      }
    }
    const shopDomain = data.shopDomain || (data.context as Record<string, unknown>)?.shopDomain;
    if (!shopDomain || typeof shopDomain !== "string") {
      return { valid: false, error: "Missing shopDomain", code: "missing_shop_domain" };
    }
    return { valid: false, error: "Invalid event format", code: "invalid_body" };
  }
  const { shopDomain, timestamp } = normalized;
  if (!SHOP_DOMAIN_PATTERN.test(shopDomain)) {
    return {
      valid: false,
      error: "Invalid shop domain format",
      code: "invalid_shop_domain_format",
    };
  }
  const now = Date.now();
  if (
    timestamp < MIN_REASONABLE_TIMESTAMP ||
    timestamp > now + MAX_FUTURE_TIMESTAMP_MS
  ) {
    return {
      valid: false,
      error: "Timestamp outside reasonable range",
      code: "invalid_timestamp_value",
    };
  }
  return null;
}

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

function sanitizeEventData(
  eventData: Record<string, unknown> | undefined
): PixelEventPayload["data"] {
  if (!eventData || typeof eventData !== "object") {
    return {};
  }
  const allowedKeys = new Set([
    "orderId",
    "orderNumber",
    "value",
    "currency",
    "tax",
    "shipping",
    "checkoutToken",
    "items",
    "itemCount",
    "url",
    "title",
    "productId",
    "productTitle",
    "price",
    "quantity",
    "environment",
  ]);
  const sanitized: PixelEventPayload["data"] = {};
  for (const [key, value] of Object.entries(eventData)) {
    if (allowedKeys.has(key)) {
      if (key === "items" && Array.isArray(value)) {
        sanitized.items = value.map((item: unknown) => {
          if (typeof item === "object" && item !== null) {
            const itemObj = item as Record<string, unknown>;
            return {
              id: String(itemObj.id || ""),
              name: String(itemObj.name || ""),
              price: typeof itemObj.price === "number" ? itemObj.price : 0,
              quantity: typeof itemObj.quantity === "number" ? itemObj.quantity : 1,
            };
          }
          return { id: "", name: "", price: 0, quantity: 1 };
        });
      } else if (key === "orderId" || key === "checkoutToken") {
        sanitized[key] = value === null || value === undefined ? null : String(value);
      } else if (key === "orderNumber" || key === "url" || key === "title" || key === "productId" || key === "productTitle" || key === "environment") {
        sanitized[key] = value === null || value === undefined ? undefined : String(value);
      } else if (key === "currency") {
        sanitized.currency = value == null || value === undefined ? undefined : String(value);
      } else if (key === "value" || key === "tax" || key === "shipping" || key === "itemCount" || key === "price" || key === "quantity") {
        if (typeof value === "number") {
          (sanitized as Record<string, unknown>)[key] = value;
        }
      }
    }
  }
  return sanitized;
}

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

export function validateRequest(body: unknown): ValidationResult {
  const bodyResult = validateBodyStructure(body);
  if (!bodyResult.valid) {
    return bodyResult as ValidationResult;
  }
  const data = (bodyResult as { valid: true; data: Record<string, unknown> }).data;
  const requiredFieldsError = validateRequiredFields(data);
  if (requiredFieldsError) {
    return requiredFieldsError;
  }
  const normalized = normalizeEventFields(data);
  if (!normalized) {
    return { valid: false, error: "Invalid event format", code: "invalid_body" };
  }
  const { eventName, timestamp, shopDomain, eventId, nonce, context } = normalized;
  const consent = (data.consent || (context as Record<string, unknown>)?.consent) as PixelEventPayload["consent"] | undefined;
  const consentError = validateConsentFormat(consent);
  if (consentError) {
    return consentError;
  }
  const rawEventData = (data.data || (context as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
  if (eventName === "checkout_completed") {
    const checkoutError = validateCheckoutCompletedFields(rawEventData);
    if (checkoutError) {
      return checkoutError;
    }
  }
  const sanitizedEventData = sanitizeEventData(rawEventData);
  return {
    valid: true,
    payload: {
      eventName: eventName as PixelEventName,
      timestamp,
      shopDomain,
      nonce: nonce || undefined,
      consent,
      data: sanitizedEventData,
    },
  };
}

export function isPrimaryEvent(eventName: string, mode: "purchase_only" | "full_funnel" = "purchase_only"): boolean {
  if (mode === "full_funnel") {
    const fullFunnelEvents = [
      "checkout_completed",
      "checkout_started",
      "checkout_contact_info_submitted",
      "checkout_shipping_info_submitted",
      "payment_info_submitted",
      "page_viewed",
      "product_added_to_cart",
      "product_viewed",
    ];
    return fullFunnelEvents.includes(eventName);
  }
  return eventName === "checkout_completed";
}

export interface PixelConfig {
  schema_version: "1";
  mode: "purchase_only" | "full_funnel";
  enabled_platforms: string;
  strictness: "strict" | "balanced";
}

export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }
  try {
    const parsed = JSON.parse(configStr);
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

export function isPlatformEnabled(config: PixelConfig, platform: string): boolean {
  const normalizedPlatform = platform.toLowerCase();
  const enabledPlatforms = config.enabled_platforms.toLowerCase().split(",").map(p => p.trim());
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
