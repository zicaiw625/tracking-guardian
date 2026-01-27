import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { logger } from "~/utils/logger.server";
import { CAPI_CONFIG } from "~/utils/config.server";
import type { PlatformCredentials } from "~/types";
import { randomBytes } from "crypto";

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const META_API_BASE_URL = "https://graph.facebook.com";
const META_API_VERSION = "v21.0";
const TIKTOK_API_URL = CAPI_CONFIG.TIKTOK.trackEndpoint;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNoWhitespace(value: string): boolean {
  return !/\s/.test(value);
}

interface PixelEventSendResult {
  success: boolean;
  ok: boolean;
  platform: string;
  error?: string;
  errorCode?: string;
  requestPayload?: unknown;
  httpStatus?: number;
  responseBody?: string;
  latencyMs?: number;
}

interface PlatformSendConfig {
  buildUrl: (credentials: PlatformCredentials) => string;
  buildHeaders: (credentials: PlatformCredentials) => Record<string, string>;
  buildPayload: (
    credentials: PlatformCredentials,
    eventName: string,
    payload: PixelEventPayload,
    eventId: string,
    customMappings?: Record<string, string> | null
  ) => Record<string, unknown>;
  parseResponse: (response: Response) => Promise<{ success: boolean; body: string }>;
  validateCredentials: (credentials: PlatformCredentials) => { valid: boolean; error?: string };
  sanitizeUrlForLogging: (url: string) => string;
}

const EVENT_MAPPING: Record<string, Record<string, string>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    product_added_to_cart: "add_to_cart",
    product_viewed: "view_item",
    page_viewed: "page_view",
    checkout_contact_info_submitted: "begin_checkout",
    checkout_shipping_info_submitted: "add_shipping_info",
    payment_info_submitted: "add_payment_info",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
    checkout_contact_info_submitted: "InitiateCheckout",
    checkout_shipping_info_submitted: "AddShippingInfo",
    payment_info_submitted: "AddPaymentInfo",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
    checkout_contact_info_submitted: "InitiateCheckout",
    checkout_shipping_info_submitted: "AddShippingInfo",
    payment_info_submitted: "AddPaymentInfo",
  },
};

function mapShopifyEventToPlatform(
  shopifyEventName: string,
  platform: string,
  customMappings?: Record<string, string> | null
): string {
  const normalizedEvent = shopifyEventName.toLowerCase().replace(/_/g, "_");
  if (customMappings && typeof customMappings === 'object' && normalizedEvent in customMappings) {
    const mapped = customMappings[normalizedEvent];
    if (mapped && typeof mapped === 'string') {
      return mapped;
    }
  }
  const mapped = EVENT_MAPPING[platform]?.[normalizedEvent];
  if (!mapped) {
    logger.warn(`No mapping found for event ${shopifyEventName} on platform ${platform}, using original name`);
    return shopifyEventName;
  }
  return mapped;
}

function extractEventData(payload: PixelEventPayload): {
  value?: number;
  currency?: string;
  items?: Array<{ id?: string; name?: string; quantity?: number; price?: number }>;
  orderId?: string;
} {
  const data = payload.data || {};
  return {
    value: typeof data.value === "number" ? data.value : undefined,
    currency: typeof data.currency === "string" ? data.currency : undefined,
    items: Array.isArray(data.items) ? data.items : undefined,
    orderId: typeof data.orderId === "string" ? data.orderId : undefined,
  };
}

function buildItemContents(
  items: Array<{ id?: string; name?: string; quantity?: number; price?: number }>,
  format: "google" | "meta" | "tiktok"
): unknown[] {
  return items.map((item) => {
    if (format === "google") {
      return {
        item_id: item.id || "",
        item_name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
      };
    } else if (format === "meta") {
      return {
        id: item.id || "",
        quantity: item.quantity || 1,
        item_price: item.price || 0,
      };
    } else {
      return {
        content_id: item.id || "",
        content_name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
      };
    }
  });
}

const _platformConfigs: Record<string, PlatformSendConfig> = {
  google: {
    buildUrl: (credentials) => {
      const creds = credentials as { measurementId?: string; apiSecret?: string };
      return `${GA4_MEASUREMENT_PROTOCOL_URL}?measurement_id=${encodeURIComponent(creds.measurementId ?? "")}&api_secret=${encodeURIComponent(creds.apiSecret ?? "")}`;
    },
    buildHeaders: () => ({ "Content-Type": "application/json" }),
    buildPayload: (credentials, eventName, payload, eventId, customMappings) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const creds = credentials as { measurementId?: string; apiSecret?: string };
      const platformEventName = mapShopifyEventToPlatform(eventName, "google", customMappings);
      const eventData = extractEventData(payload);
      const params: Record<string, unknown> = { engagement_time_msec: "1" };
      if (platformEventName !== "page_view" && eventData.value !== undefined) {
        params.value = eventData.value;
      }
      if (eventData.currency) {
        params.currency = eventData.currency;
      }
      if (eventData.items && eventData.items.length > 0) {
        params.items = buildItemContents(eventData.items, "google");
      }
      let clientId: string;
      const payloadData = payload.data || {};
      const providedClientId = typeof payloadData.clientId === "string" ? payloadData.clientId : undefined;
      if (providedClientId && /^\d+\.\d+$/.test(providedClientId)) {
        clientId = providedClientId;
      } else {
        const timestamp = Date.now();
        const random = randomBytes(4).readUInt32BE(0) % 1000000000;
        clientId = `${timestamp}.${random}`;
      }
      return {
        client_id: clientId,
        events: [{ name: platformEventName, params }],
      };
    },
    parseResponse: async (response) => {
      const responseText = await response.text().catch(() => "");
      return {
        success: response.status === 204 || response.ok,
        body: response.status === 204 ? "" : responseText || "success",
      };
    },
    validateCredentials: (credentials) => {
      const creds = credentials as { measurementId?: string; apiSecret?: string };
      if (!isNonEmptyString(creds.measurementId) || !isNonEmptyString(creds.apiSecret)) {
        return { valid: false, error: "Missing measurementId or apiSecret" };
      }
      const measurementId = creds.measurementId.trim();
      const apiSecret = creds.apiSecret.trim();
      if (!/^G-[A-Z0-9]+$/i.test(measurementId)) {
        return { valid: false, error: "Invalid measurementId format" };
      }
      if (!hasNoWhitespace(apiSecret) || !/^[A-Za-z0-9_-]{8,}$/.test(apiSecret)) {
        return { valid: false, error: "Invalid apiSecret format" };
      }
      return { valid: true };
    },
    sanitizeUrlForLogging: (url) => url.replace(/api_secret=[^&]+/, "api_secret=***REDACTED***"),
  },
  meta: {
    buildUrl: (credentials) => {
      const creds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
      return `${META_API_BASE_URL}/${META_API_VERSION}/${creds.pixelId}/events`;
    },
    buildHeaders: (credentials) => {
      const creds = credentials as { accessToken?: string };
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.accessToken}`,
      };
    },
    buildPayload: (credentials, eventName, payload, eventId, customMappings) => {
      const creds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
      const platformEventName = mapShopifyEventToPlatform(eventName, "meta", customMappings);
      const eventData = extractEventData(payload);
      let eventTime: number;
      if (payload.timestamp && typeof payload.timestamp === 'number') {
        eventTime = Math.floor(payload.timestamp / 1000);
      } else {
        eventTime = Math.floor(Date.now() / 1000);
      }
      const contents = eventData.items && eventData.items.length > 0
        ? buildItemContents(eventData.items, "meta")
        : [];
      const customData: Record<string, unknown> = {};
      if (platformEventName !== "PageView" && eventData.value !== undefined) {
        customData.value = eventData.value;
      }
      if (eventData.currency) {
        customData.currency = eventData.currency;
      }
      if (contents.length > 0) {
        customData.contents = contents;
        customData.content_type = "product";
      }
      if (eventData.orderId) {
        customData.order_id = eventData.orderId;
      }
      return {
        data: [{
          event_name: platformEventName,
          event_time: eventTime,
          event_id: eventId,
          action_source: "website",
          custom_data: customData,
        }],
        ...(creds.testEventCode && { test_event_code: creds.testEventCode }),
      };
    },
    parseResponse: async (response) => {
      const responseData = await response.json().catch(() => ({}));
      return {
        success: response.ok,
        body: JSON.stringify(responseData),
      };
    },
    validateCredentials: (credentials) => {
      const creds = credentials as { pixelId?: string; accessToken?: string };
      if (!isNonEmptyString(creds.pixelId) || !isNonEmptyString(creds.accessToken)) {
        return { valid: false, error: "Missing pixelId or accessToken" };
      }
      const pixelId = creds.pixelId.trim();
      const accessToken = creds.accessToken.trim();
      if (!/^\d{5,20}$/.test(pixelId)) {
        return { valid: false, error: "Invalid pixelId format" };
      }
      if (!hasNoWhitespace(accessToken) || accessToken.length < 20) {
        return { valid: false, error: "Invalid accessToken format" };
      }
      return { valid: true };
    },
    sanitizeUrlForLogging: (url) => url,
  },
  tiktok: {
    buildUrl: () => TIKTOK_API_URL,
    buildHeaders: (credentials) => {
      const creds = credentials as { accessToken?: string };
      return {
        "Content-Type": "application/json",
        "Access-Token": creds.accessToken || "",
      };
    },
    buildPayload: (credentials, eventName, payload, eventId, customMappings) => {
      const creds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
      const platformEventName = mapShopifyEventToPlatform(eventName, "tiktok", customMappings);
      const eventData = extractEventData(payload);
      let timestamp: string;
      if (payload.timestamp && typeof payload.timestamp === 'number') {
        timestamp = new Date(payload.timestamp).toISOString();
      } else {
        timestamp = new Date().toISOString();
      }
      const contents = eventData.items && eventData.items.length > 0
        ? buildItemContents(eventData.items, "tiktok")
        : [];
      const properties: Record<string, unknown> = {};
      if (platformEventName !== "PageView" && eventData.value !== undefined) {
        properties.value = eventData.value;
      }
      if (eventData.currency) {
        properties.currency = eventData.currency;
      }
      if (contents.length > 0) {
        properties.contents = contents;
        properties.content_type = "product";
      }
      if (eventData.orderId) {
        properties.order_id = eventData.orderId;
      }
      const eventPayload = {
        pixel_code: creds.pixelId,
        event: platformEventName,
        event_id: eventId,
        timestamp,
        context: { user: {} },
        properties,
        ...(creds.testEventCode && { test_event_code: creds.testEventCode }),
      };
      return { data: [eventPayload] };
    },
    parseResponse: async (response) => {
      const responseData = await response.json().catch(() => ({}));
      return {
        success: response.ok,
        body: JSON.stringify(responseData),
      };
    },
    validateCredentials: (credentials) => {
      const creds = credentials as { pixelId?: string; accessToken?: string };
      if (!isNonEmptyString(creds.pixelId) || !isNonEmptyString(creds.accessToken)) {
        return { valid: false, error: "Missing pixelId or accessToken" };
      }
      const pixelId = creds.pixelId.trim();
      const accessToken = creds.accessToken.trim();
      if (!hasNoWhitespace(pixelId) || pixelId.length < 8 || pixelId.length > 64) {
        return { valid: false, error: "Invalid pixelId format" };
      }
      if (!hasNoWhitespace(accessToken) || accessToken.length < 10) {
        return { valid: false, error: "Invalid accessToken format" };
      }
      return { valid: true };
    },
    sanitizeUrlForLogging: (url) => url,
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function validatePlatformCredentials(
  credentials: PlatformCredentials,
  requiredFields: string[]
): { valid: boolean; error?: string } {
  for (const field of requiredFields) {
    if (!(field in credentials) || !credentials[field as keyof PlatformCredentials]) {
      return { valid: false, error: `Missing ${field}` };
    }
  }
  return { valid: true };
}

async function _unused_sendToPlatform(
  _platform: string,
  _credentials: PlatformCredentials,
  _eventName: string,
  _payload: PixelEventPayload,
  _eventId: string,
  _customMappings?: Record<string, string> | null
): Promise<PixelEventSendResult> {
  return {
    success: false,
    ok: false,
    platform: _platform,
    error: "Server-side conversions disabled in v1",
    errorCode: "FEATURE_DISABLED",
  };
}

function _unused_findPixelConfig(
  _pixelConfigs: unknown,
  _platform: string,
  _configId?: string,
  _platformId?: string
) {
  return undefined;
}

function _unused_isEventMappings(_value: unknown): _value is Record<string, string> {
  return false;
}

function _unused_extractEventMappings(_eventMappings: unknown): Record<string, string> | null {
  return null;
}

function _unused_createErrorResult(_platform: string, _error: string, _errorCode: string): PixelEventSendResult {
  return {
    success: false,
    ok: false,
    platform: _platform,
    error: _error,
    errorCode: _errorCode,
  };
}

function _unused_normalizeErrorMessage(_error: string): { message: string; code: string } {
  return {
    message: "",
    code: "",
  };
}

export async function sendPixelEventToPlatform(
  shopId: string,
  platform: string,
  payload: PixelEventPayload,
  eventId: string,
  configId?: string,
  platformId?: string,
  _environment: "test" | "live" = "live"
): Promise<PixelEventSendResult> {
  logger.info("Server-side conversions disabled in v1, skipping event send", {
    shopId,
    platform,
    eventName: payload.eventName,
  });
  return {
    success: false,
    ok: false,
    platform,
    error: "Server-side conversions disabled in v1",
    errorCode: "FEATURE_DISABLED",
  };
}
