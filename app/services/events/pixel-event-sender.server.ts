import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { logger } from "~/utils/logger.server";
import { getShopPixelConfigs } from "../db/pixel-config-repository.server";
import { decryptCredentials } from "../credentials.server";
import { getPlatformEventName } from "../pixel-mapping.server";
import type { Platform } from "~/types/platform";
import type { PlatformCredentials } from "~/types";
import { fetchWithTimeout, DEFAULT_API_TIMEOUT_MS } from "../platforms/interface";

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const META_API_BASE_URL = "https://graph.facebook.com";
const META_API_VERSION = "v21.0";
const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

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
  const eventMapping: Record<string, Record<string, string>> = {
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
  const mapped = eventMapping[platform]?.[normalizedEvent];
  if (!mapped) {
    logger.warn(`No mapping found for event ${shopifyEventName} on platform ${platform}, using original name`);
    return shopifyEventName;
  }
  return mapped;
}

async function sendToGA4(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string,
  customMappings?: Record<string, string> | null
): Promise<PixelEventSendResult> {
  try {
    const googleCreds = credentials as { measurementId?: string; apiSecret?: string };
    if (!googleCreds.measurementId || !googleCreds.apiSecret) {
      return {
        success: false,
        ok: false,
        platform: "google",
        error: "Missing measurementId or apiSecret",
        errorCode: "missing_credentials",
      };
    }
    const platformEventName = mapShopifyEventToPlatform(eventName, "google", customMappings);
    const data = payload.data || {};
    const params: Record<string, unknown> = {
      engagement_time_msec: "1",
    };
    if (platformEventName !== "page_view" && data.value !== undefined && data.value !== null) {
      params.value = data.value;
    }
    if (data.currency) {
      params.currency = data.currency;
    }
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      params.items = data.items.map((item) => ({
        item_id: item.id || "",
        item_name: item.name || "",
        quantity: item.quantity || 1,
        price: item.price || 0,
      }));
    }
    const ga4Payload = {
      client_id: `server.${eventId}`,
      events: [
        {
          name: platformEventName,
          params,
        },
      ],
    };
    const url = `${GA4_MEASUREMENT_PROTOCOL_URL}?measurement_id=${googleCreds.measurementId}&api_secret=${googleCreds.apiSecret}`;
    const sanitizedUrl = url.replace(/api_secret=[^&]+/, "api_secret=***REDACTED***");
    const requestPayload = {
      url: sanitizedUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ga4Payload,
    };
    const sendStartTime = Date.now();
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ga4Payload),
      },
      DEFAULT_API_TIMEOUT_MS
    );
    const latencyMs = Date.now() - sendStartTime;
    const responseText = await response.text().catch(() => "");
    const isSuccess = response.status === 204 || response.ok;
    if (isSuccess) {
      return { 
        success: true,
        ok: true,
        platform: "google", 
        requestPayload, 
        httpStatus: response.status,
        responseBody: response.status === 204 ? "" : responseText || "success",
        latencyMs,
      };
    }
    return {
      success: false,
      ok: false,
      platform: "google",
      error: `GA4 error: ${response.status} ${responseText}`,
      errorCode: `http_${response.status}`,
      requestPayload,
      httpStatus: response.status,
      responseBody: responseText,
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      platform: "google",
      error: error instanceof Error ? error.message : String(error),
      errorCode: "send_error",
    };
  }
}

async function sendToMeta(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string,
  customMappings?: Record<string, string> | null
): Promise<PixelEventSendResult> {
  try {
    const metaCreds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
    if (!metaCreds.pixelId || !metaCreds.accessToken) {
      return {
        success: false,
        ok: false,
        platform: "meta",
        error: "Missing pixelId or accessToken",
        errorCode: "missing_credentials",
      };
    }
    const platformEventName = mapShopifyEventToPlatform(eventName, "meta", customMappings);
    const data = payload.data || {};
    const eventTime = Math.floor(Date.now() / 1000);
    const contents =
      data.items && Array.isArray(data.items) && data.items.length > 0
        ? data.items.map((item) => ({
            id: item.id || "",
            quantity: item.quantity || 1,
            item_price: item.price || 0,
          }))
        : [];
    const customData: Record<string, unknown> = {};
    if (platformEventName !== "PageView" && data.value !== undefined && data.value !== null) {
      customData.value = data.value;
    }
    if (data.currency) {
      customData.currency = data.currency;
    }
    if (contents.length > 0) {
      customData.contents = contents;
      customData.content_type = "product";
    }
    if (data.orderId) {
      customData.order_id = data.orderId;
    }
    const eventPayload = {
      data: [
        {
          event_name: platformEventName,
          event_time: eventTime,
          event_id: eventId,
          action_source: "website",
          custom_data: customData,
        },
      ],
      ...(metaCreds.testEventCode && { test_event_code: metaCreds.testEventCode }),
    };
    const url = `${META_API_BASE_URL}/${META_API_VERSION}/${metaCreds.pixelId}/events`;
    const requestPayload = {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ***REDACTED***",
      },
      body: {
        ...eventPayload,
        access_token: "***REDACTED***",
      },
    };
    const sendStartTime = Date.now();
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metaCreds.accessToken}`,
        },
        body: JSON.stringify({
          ...eventPayload,
          access_token: metaCreds.accessToken,
        }),
      },
      DEFAULT_API_TIMEOUT_MS
    );
    const latencyMs = Date.now() - sendStartTime;
    const responseData = await response.json().catch(() => ({}));
    const isSuccess = response.ok;
    if (isSuccess) {
      return { 
        success: true,
        ok: true,
        platform: "meta", 
        requestPayload, 
        httpStatus: response.status,
        responseBody: JSON.stringify(responseData) || "success",
        latencyMs,
      };
    }
    return {
      success: false,
      ok: false,
      platform: "meta",
      error: `Meta error: ${response.status} ${responseData.error?.message || "Unknown error"}`,
      errorCode: `http_${response.status}`,
      requestPayload,
      httpStatus: response.status,
      responseBody: JSON.stringify(responseData),
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      platform: "meta",
      error: error instanceof Error ? error.message : String(error),
      errorCode: "send_error",
    };
  }
}

async function sendToTikTok(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string,
  customMappings?: Record<string, string> | null
): Promise<PixelEventSendResult> {
  try {
    const tiktokCreds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
    if (!tiktokCreds.pixelId || !tiktokCreds.accessToken) {
      return {
        success: false,
        ok: false,
        platform: "tiktok",
        error: "Missing pixelId or accessToken",
        errorCode: "missing_credentials",
      };
    }
    const platformEventName = mapShopifyEventToPlatform(eventName, "tiktok", customMappings);
    const data = payload.data || {};
    const timestamp = new Date().toISOString();
    const contents =
      data.items && Array.isArray(data.items) && data.items.length > 0
        ? data.items.map((item) => ({
            content_id: item.id || "",
            content_name: item.name || "",
            quantity: item.quantity || 1,
            price: item.price || 0,
          }))
        : [];
    const properties: Record<string, unknown> = {};
    if (platformEventName !== "PageView" && data.value !== undefined && data.value !== null) {
      properties.value = data.value;
    }
    if (data.currency) {
      properties.currency = data.currency;
    }
    if (contents.length > 0) {
      properties.contents = contents;
      properties.content_type = "product";
    }
    if (data.orderId) {
      properties.order_id = data.orderId;
    }
    const eventPayload = {
      pixel_code: tiktokCreds.pixelId,
      event: platformEventName,
      event_id: eventId,
      timestamp,
      context: {
        user: {},
      },
      properties,
      ...(tiktokCreds.testEventCode && { test_event_code: tiktokCreds.testEventCode }),
    };
    const requestPayload = {
      url: TIKTOK_API_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": "***REDACTED***",
      },
      body: { data: [eventPayload] },
    };
    const sendStartTime = Date.now();
    const response = await fetchWithTimeout(
      TIKTOK_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": tiktokCreds.accessToken,
        },
        body: JSON.stringify({ data: [eventPayload] }),
      },
      DEFAULT_API_TIMEOUT_MS
    );
    const latencyMs = Date.now() - sendStartTime;
    const responseData = await response.json().catch(() => ({}));
    const isSuccess = response.ok;
    if (isSuccess) {
      return { 
        success: true,
        ok: true,
        platform: "tiktok", 
        requestPayload, 
        httpStatus: response.status,
        responseBody: JSON.stringify(responseData) || "success",
        latencyMs,
      };
    }
    return {
      success: false,
      ok: false,
      platform: "tiktok",
      error: `TikTok error: ${response.status} ${responseData.message || "Unknown error"}`,
      errorCode: `http_${response.status}`,
      requestPayload,
      httpStatus: response.status,
      responseBody: JSON.stringify(responseData),
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      platform: "tiktok",
      error: error instanceof Error ? error.message : String(error),
      errorCode: "send_error",
    };
  }
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
  try {
    logger.debug(`Sending ${payload.eventName} to ${platform}`, {
      shopId,
      eventId,
      eventName: payload.eventName,
      platform,
      configId,
      platformId,
      environment,
    });
    const pixelConfigs = await getShopPixelConfigs(shopId, {
      serverSideOnly: true,
      environment: environment || "live"
    });
    let config = configId
      ? pixelConfigs.find((c) => c.id === configId && c.platform === platform)
      : platformId
      ? pixelConfigs.find((c) => c.platformId === platformId && c.platform === platform)
      : pixelConfigs.find((c) => c.platform === platform);
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
      return {
        success: false,
        ok: false,
        platform,
        error: "Pixel config not found",
        errorCode: "config_not_found",
      };
    }
    const credResult = decryptCredentials(config, platform);
    if (!credResult.ok) {
      logger.warn(`Failed to decrypt credentials for platform ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        error: credResult.error.message,
      });
      return {
        success: false,
        ok: false,
        platform,
        error: credResult.error.message,
        errorCode: "decrypt_error",
      };
    }
    const credentials = credResult.value.credentials;
    const normalizedPlatform = platform.toLowerCase();
    const configEnvironment = (config.environment || environment || "live") as "test" | "live";
    const eventMappings = config.eventMappings && typeof config.eventMappings === 'object'
      ? (config.eventMappings as Record<string, string>)
      : null;
    const startTime = Date.now();
    let sendResult: PixelEventSendResult;
    try {
      if (normalizedPlatform === "google") {
        sendResult = await sendToGA4(credentials, payload.eventName, payload, eventId, eventMappings);
      } else if (normalizedPlatform === "meta" || normalizedPlatform === "facebook") {
        sendResult = await sendToMeta(credentials, payload.eventName, payload, eventId, eventMappings);
      } else if (normalizedPlatform === "tiktok") {
        sendResult = await sendToTikTok(credentials, payload.eventName, payload, eventId, eventMappings);
      } else {
        return {
          success: false,
          ok: false,
          platform,
          error: `Unsupported platform: ${platform}`,
          errorCode: "unsupported_platform",
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send event to ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
        eventId,
        error: errorMessage,
      });
      const latencyMs = Date.now() - startTime;
      sendResult = {
        success: false,
        ok: false,
        platform,
        error: errorMessage.includes("timeout") || errorMessage.includes("aborted")
          ? `Request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`
          : errorMessage,
        errorCode: errorMessage.includes("timeout") || errorMessage.includes("aborted")
          ? "timeout"
          : "send_error",
        latencyMs,
      };
    }
    const finalLatencyMs = Date.now() - startTime;
    if (sendResult.success && !sendResult.latencyMs) {
      sendResult.latencyMs = finalLatencyMs;
    }
    if (!sendResult.ok) {
      sendResult.ok = sendResult.success;
    }
    return sendResult;
  } catch (error) {
    logger.error(`Failed to send pixel event to ${platform}`, {
      shopId,
      platform,
      eventName: payload.eventName,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      ok: false,
      platform,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "send_error",
    };
  }
}
