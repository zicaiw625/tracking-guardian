import type { PixelEventPayload } from "~/lib/pixel-events/types";
import { logger } from "~/utils/logger.server";
import { getShopPixelConfigs } from "../db/pixel-config-repository.server";
import { decryptCredentials } from "../credentials.server";
import { getPlatformEventName } from "../pixel-mapping.server";
import type { Platform } from "~/types/platform";
import type { PlatformCredentials } from "~/types";
import { fetchWithTimeout, DEFAULT_API_TIMEOUT_MS } from "../platforms/interface";
import { CAPI_CONFIG } from "~/utils/config.server";
import { ErrorCode } from "~/utils/errors/app-error";

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const META_API_BASE_URL = "https://graph.facebook.com";
const META_API_VERSION = "v21.0";
const TIKTOK_API_URL = CAPI_CONFIG.TIKTOK.trackEndpoint;

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

const platformConfigs: Record<string, PlatformSendConfig> = {
  google: {
    buildUrl: (credentials) => {
      const creds = credentials as { measurementId?: string; apiSecret?: string };
      return `${GA4_MEASUREMENT_PROTOCOL_URL}?measurement_id=${creds.measurementId}&api_secret=${creds.apiSecret}`;
    },
    buildHeaders: () => ({ "Content-Type": "application/json" }),
    buildPayload: (credentials, eventName, payload, eventId, customMappings) => {
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
      return {
        client_id: `server.${eventId}`,
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
      if (!creds.measurementId || !creds.apiSecret) {
        return { valid: false, error: "Missing measurementId or apiSecret" };
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
      const eventTime = Math.floor(Date.now() / 1000);
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
      if (!creds.pixelId || !creds.accessToken) {
        return { valid: false, error: "Missing pixelId or accessToken" };
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
      const timestamp = new Date().toISOString();
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
      if (!creds.pixelId || !creds.accessToken) {
        return { valid: false, error: "Missing pixelId or accessToken" };
      }
      return { valid: true };
    },
    sanitizeUrlForLogging: (url) => url,
  },
};

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

async function sendToPlatform(
  platform: string,
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string,
  customMappings?: Record<string, string> | null
): Promise<PixelEventSendResult> {
  const config = platformConfigs[platform.toLowerCase()];
  if (!config) {
    return createErrorResult(
      platform,
      `Unsupported platform: ${platform}`,
      ErrorCode.PLATFORM_INVALID_CONFIG
    );
  }
  const validation = config.validateCredentials(credentials);
  if (!validation.valid) {
    return createErrorResult(
      platform,
      validation.error || "Invalid credentials",
      ErrorCode.PLATFORM_AUTH_ERROR
    );
  }
  try {
    const url = config.buildUrl(credentials);
    const headers = config.buildHeaders(credentials);
    const requestBody = config.buildPayload(credentials, eventName, payload, eventId, customMappings);
    const sanitizedUrl = config.sanitizeUrlForLogging(url);
    const sanitizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "authorization" || lowerKey === "access-token" || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("key")) {
        sanitizedHeaders[key] = "***REDACTED***";
      } else {
        sanitizedHeaders[key] = value;
      }
    }
    const sendStartTime = Date.now();
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    }, DEFAULT_API_TIMEOUT_MS);
    const latencyMs = Date.now() - sendStartTime;
    const { success, body: responseBody } = await config.parseResponse(response);
    const isProduction = process.env.NODE_ENV === "production";
    const requestPayload = isProduction
      ? {
          url: sanitizedUrl,
          method: "POST" as const,
          headers: sanitizedHeaders,
          platform,
          status: success ? ("ok" as const) : ("fail" as const),
          latencyMs,
          httpStatus: response.status,
          ...(success ? {} : { errorCode: `http_${response.status}` }),
        }
      : {
          url: sanitizedUrl,
          method: "POST" as const,
          headers: sanitizedHeaders,
          body: requestBody,
        };
    if (success) {
      return {
        success: true,
        ok: true,
        platform,
        requestPayload,
        httpStatus: response.status,
        responseBody,
        latencyMs,
      };
    }
    const errorMessage = platform === "google"
      ? `GA4 error: ${response.status} ${responseBody}`
      : platform === "meta"
      ? `Meta error: ${response.status} ${JSON.parse(responseBody || "{}")?.error?.message || "Unknown error"}`
      : `TikTok error: ${response.status} ${JSON.parse(responseBody || "{}")?.message || "Unknown error"}`;
    return {
      success: false,
      ok: false,
      platform,
      error: errorMessage,
      errorCode: `http_${response.status}`,
      requestPayload,
      httpStatus: response.status,
      responseBody,
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      platform,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "send_error",
    };
  }
}

function findPixelConfig(
  pixelConfigs: Awaited<ReturnType<typeof getShopPixelConfigs>>,
  platform: string,
  configId?: string,
  platformId?: string
) {
  if (configId) {
    return pixelConfigs.find((c) => c.id === configId && c.platform === platform);
  }
  if (platformId) {
    return pixelConfigs.find((c) => c.platformId === platformId && c.platform === platform);
  }
  return pixelConfigs.find((c) => c.platform === platform);
}

function isEventMappings(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractEventMappings(eventMappings: unknown): Record<string, string> | null {
  return isEventMappings(eventMappings) ? eventMappings : null;
}

function createErrorResult(platform: string, error: string, errorCode: string): PixelEventSendResult {
  return {
    success: false,
    ok: false,
    platform,
    error,
    errorCode,
  };
}

function normalizeErrorMessage(error: string): { message: string; code: string } {
  const lowerError = error.toLowerCase();
  if (lowerError.includes("timeout") || lowerError.includes("aborted")) {
    return {
      message: `Request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`,
      code: ErrorCode.PLATFORM_TIMEOUT,
    };
  }
  return {
    message: error,
    code: ErrorCode.PLATFORM_UNKNOWN_ERROR,
  };
}

export async function sendPixelEventToPlatform(
  shopId: string,
  platform: string,
  payload: PixelEventPayload,
  eventId: string,
  configId?: string,
  platformId?: string,
  environment: "test" | "live" = "live"
): Promise<PixelEventSendResult> {
  logger.debug(`Sending ${payload.eventName} to ${platform}`, {
    shopId,
    eventId,
    eventName: payload.eventName,
    platform,
    configId,
    platformId,
    environment,
  });
  try {
    const pixelConfigs = await getShopPixelConfigs(shopId, {
      serverSideOnly: true,
      environment: environment || "live"
    });
    let config = findPixelConfig(pixelConfigs, platform, configId, platformId);
    if (!config && (configId || platformId)) {
      const matchingPlatformConfigs = pixelConfigs.filter((c) => c.platform === platform);
      if (matchingPlatformConfigs.length > 1) {
        logger.warn(`Multiple configs found for platform ${platform}, but specified config not found`, {
          shopId,
          platform,
          configId,
          platformId,
          availableConfigs: matchingPlatformConfigs.map(c => ({ id: c.id, platformId: c.platformId })),
        });
      }
      config = matchingPlatformConfigs[0];
    }
    if (!config) {
      logger.warn(`Pixel config not found for platform ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        configId,
        platformId,
      });
      return createErrorResult(platform, "Pixel config not found", ErrorCode.NOT_FOUND_PIXEL_CONFIG);
    }
    const credResult = decryptCredentials(config, platform);
    if (!credResult.ok) {
      logger.warn(`Failed to decrypt credentials for platform ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        error: credResult.error.message,
      });
      return createErrorResult(platform, credResult.error.message, ErrorCode.DECRYPTION_FAILED);
    }
    const credentials = credResult.value.credentials;
    const normalizedPlatform = platform.toLowerCase();
    const eventMappings = extractEventMappings(config.eventMappings);
    const startTime = Date.now();
    try {
      const sendResult = await sendToPlatform(
        normalizedPlatform,
        credentials,
        payload.eventName,
        payload,
        eventId,
        eventMappings
      );
      const finalLatencyMs = Date.now() - startTime;
      if (sendResult.success && !sendResult.latencyMs) {
        sendResult.latencyMs = finalLatencyMs;
      }
      if (!sendResult.ok) {
        sendResult.ok = sendResult.success;
      }
      return sendResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send event to ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        eventId,
        error: errorMessage,
      });
      const { message, code } = normalizeErrorMessage(errorMessage);
      return {
        ...createErrorResult(platform, message, code),
        latencyMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send pixel event to ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        eventId,
        error: errorMessage,
      });
      return createErrorResult(platform, errorMessage, ErrorCode.PLATFORM_UNKNOWN_ERROR);
    }
  }
