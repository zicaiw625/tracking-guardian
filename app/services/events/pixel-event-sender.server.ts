import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { logger } from "~/utils/logger.server";
import { getShopPixelConfigs } from "../db/pixel-config-repository.server";
import { decryptCredentials } from "../credentials.server";
import { getPlatformEventName } from "../pixel-mapping.server";
import type { Platform } from "~/types/platform";
import type { PlatformCredentials } from "~/types";
import { fetchWithTimeout, DEFAULT_API_TIMEOUT_MS } from "../platforms/interface";
import {
  createDeliveryAttempt,
  updateDeliveryAttempt
} from "../event-log.server";

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const META_API_BASE_URL = "https://graph.facebook.com";
const META_API_VERSION = "v21.0";
const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

interface PixelEventSendResult {
  success: boolean;
  platform: string;
  error?: string;
  requestPayload?: unknown;
  responseStatus?: number;
  responseBody?: string;
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
        platform: "google",
        error: "Missing measurementId or apiSecret",
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
    const requestPayload = {
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ga4Payload,
    };
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ga4Payload),
      },
      DEFAULT_API_TIMEOUT_MS
    );
    const errorText = await response.text().catch(() => "");
    const isSuccess = response.status === 204 || response.ok;
    if (isSuccess) {
      return { success: true, platform: "google", requestPayload, responseStatus: response.status };
    }
    return {
      success: false,
      platform: "google",
      error: `GA4 error: ${response.status} ${errorText}`,
      requestPayload,
      responseStatus: response.status,
      responseBody: errorText,
    };
  } catch (error) {
    return {
      success: false,
      platform: "google",
      error: error instanceof Error ? error.message : String(error),
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
        platform: "meta",
        error: "Missing pixelId or accessToken",
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
    const errorData = await response.json().catch(() => ({}));
    const isSuccess = response.ok;
    if (isSuccess) {
      return { success: true, platform: "meta", requestPayload, responseStatus: response.status };
    }
    return {
      success: false,
      platform: "meta",
      error: `Meta error: ${response.status} ${errorData.error?.message || "Unknown error"}`,
      requestPayload,
      responseStatus: response.status,
      responseBody: JSON.stringify(errorData),
    };
  } catch (error) {
    return {
      success: false,
      platform: "meta",
      error: error instanceof Error ? error.message : String(error),
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
        platform: "tiktok",
        error: "Missing pixelId or accessToken",
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
    const errorData = await response.json().catch(() => ({}));
    const isSuccess = response.ok;
    if (isSuccess) {
      return { success: true, platform: "tiktok", requestPayload, responseStatus: response.status };
    }
    return {
      success: false,
      platform: "tiktok",
      error: `TikTok error: ${response.status} ${errorData.message || "Unknown error"}`,
      requestPayload,
      responseStatus: response.status,
      responseBody: JSON.stringify(errorData),
    };
  } catch (error) {
    return {
      success: false,
      platform: "tiktok",
      error: error instanceof Error ? error.message : String(error),
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
  eventLogId?: string | null,
  environment?: "test" | "live"
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
        platform,
        error: "Pixel config not found",
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
        platform,
        error: credResult.error.message,
      };
    }
    const credentials = credResult.value.credentials;
    const normalizedPlatform = platform.toLowerCase();
    const configEnvironment = (config.environment || environment || "live") as "test" | "live";
    let requestPayload: unknown = null;
    let attemptId: string | null = null;
    const eventMappings = config.eventMappings && typeof config.eventMappings === 'object'
      ? (config.eventMappings as Record<string, string>)
      : null;
    if (normalizedPlatform === "google") {
      const googleCreds = credentials as { measurementId?: string; apiSecret?: string };
      if (googleCreds.measurementId && googleCreds.apiSecret) {
        const platformEventName = mapShopifyEventToPlatform(payload.eventName, "google", eventMappings);
        const data = payload.data || {};
        const params: Record<string, unknown> = { engagement_time_msec: "1" };
        if (platformEventName !== "page_view" && data.value !== undefined && data.value !== null) {
          params.value = data.value;
        }
        if (data.currency) params.currency = data.currency;
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
          events: [{ name: platformEventName, params }],
        };
        const url = `${GA4_MEASUREMENT_PROTOCOL_URL}?measurement_id=${googleCreds.measurementId}&api_secret=${googleCreds.apiSecret}`;
        requestPayload = {
          url,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: ga4Payload,
        };
      }
    } else if (normalizedPlatform === "meta" || normalizedPlatform === "facebook") {
      const metaCreds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
      if (metaCreds.pixelId && metaCreds.accessToken) {
        const platformEventName = mapShopifyEventToPlatform(payload.eventName, "meta", eventMappings);
        const data = payload.data || {};
        const eventTime = Math.floor(Date.now() / 1000);
        const contents = data.items && Array.isArray(data.items) && data.items.length > 0
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
        if (data.currency) customData.currency = data.currency;
        if (contents.length > 0) {
          customData.contents = contents;
          customData.content_type = "product";
        }
        if (data.orderId) customData.order_id = data.orderId;
        const eventPayload = {
          data: [{
            event_name: platformEventName,
            event_time: eventTime,
            event_id: eventId,
            action_source: "website",
            custom_data: customData,
          }],
          ...(metaCreds.testEventCode && { test_event_code: metaCreds.testEventCode }),
        };
        const url = `${META_API_BASE_URL}/${META_API_VERSION}/${metaCreds.pixelId}/events`;
        requestPayload = {
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
      }
    } else if (normalizedPlatform === "tiktok") {
      const tiktokCreds = credentials as { pixelId?: string; accessToken?: string; testEventCode?: string };
      if (tiktokCreds.pixelId && tiktokCreds.accessToken) {
        const platformEventName = mapShopifyEventToPlatform(payload.eventName, "tiktok", eventMappings);
        const data = payload.data || {};
        const timestamp = new Date().toISOString();
        const contents = data.items && Array.isArray(data.items) && data.items.length > 0
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
        if (data.currency) properties.currency = data.currency;
        if (contents.length > 0) {
          properties.contents = contents;
          properties.content_type = "product";
        }
        if (data.orderId) properties.order_id = data.orderId;
        const eventPayload = {
          pixel_code: tiktokCreds.pixelId,
          event: platformEventName,
          event_id: eventId,
          timestamp,
          context: { user: {} },
          properties,
          ...(tiktokCreds.testEventCode && { test_event_code: tiktokCreds.testEventCode }),
        };
        requestPayload = {
          url: TIKTOK_API_URL,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Access-Token": "***REDACTED***",
          },
          body: { data: [eventPayload] },
        };
      }
    } else {
      logger.warn(`Unsupported platform: ${platform}`, {
        shopId,
        platform,
        eventName: payload.eventName,
      });
      return {
        success: false,
        platform,
        error: `Unsupported platform: ${platform}`,
      };
    }
    if (eventLogId && requestPayload) {
      try {
        attemptId = await createDeliveryAttempt({
          eventLogId,
          shopId,
          destinationType: normalizedPlatform,
          environment: configEnvironment,
          requestPayloadJson: requestPayload,
        });
      } catch (error) {
        logger.error("Failed to create DeliveryAttempt (non-blocking)", {
          shopId,
          eventLogId,
          platform: normalizedPlatform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
          platform,
          error: `Unsupported platform: ${platform}`,
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
      sendResult = {
        success: false,
        platform,
        error: errorMessage.includes("timeout") || errorMessage.includes("aborted")
          ? `Request timeout after ${DEFAULT_API_TIMEOUT_MS}ms`
          : errorMessage,
      };
    }
    const latencyMs = Date.now() - startTime;
    if (attemptId) {
      try {
        let errorCode: string | null = null;
        if (!sendResult.success && sendResult.error) {
          const errorMsg = sendResult.error.toLowerCase();
          const status = sendResult.responseStatus;
          if (status === 401 || status === 403 || errorMsg.includes("unauthorized") || errorMsg.includes("token")) {
            errorCode = "auth_error";
          } else if (status === 429 || errorMsg.includes("rate limit")) {
            errorCode = "rate_limited";
          } else if (status && status >= 500) {
            errorCode = "server_error";
          } else if (status === 400 || errorMsg.includes("invalid") || errorMsg.includes("validation")) {
            errorCode = "validation_error";
          } else if (errorMsg.includes("timeout") || errorMsg.includes("network")) {
            errorCode = "network_error";
          } else if (errorMsg.includes("credential") || errorMsg.includes("config")) {
            errorCode = "config_error";
          } else {
            errorCode = "send_failed";
          }
        }
        await updateDeliveryAttempt({
          attemptId,
          status: sendResult.success ? "ok" : "fail",
          errorCode,
          errorDetail: sendResult.error || null,
          responseStatus: sendResult.responseStatus || null,
          responseBodySnippet: sendResult.responseBody || null,
          latencyMs,
        });
      } catch (error) {
        logger.error("Failed to update DeliveryAttempt (non-blocking)", {
          shopId,
          attemptId,
          platform: normalizedPlatform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
      platform,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
