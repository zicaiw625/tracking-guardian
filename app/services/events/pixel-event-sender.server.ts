
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { logger } from "~/utils/logger.server";
import { getShopPixelConfigs } from "../db/pixel-config-repository.server";
import { decryptCredentials } from "../credentials.server";
import { getPlatformEventName } from "../pixel-mapping.server";
import type { Platform } from "../types/platform";
import type { PlatformCredentials } from "~/types";
import { fetchWithTimeout, DEFAULT_API_TIMEOUT_MS } from "../platforms/interface";

const GA4_MEASUREMENT_PROTOCOL_URL = "https://www.google-analytics.com/mp/collect";
const META_API_BASE_URL = "https://graph.facebook.com";
const META_API_VERSION = "v21.0";
const TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

interface PixelEventSendResult {
  success: boolean;
  platform: string;
  error?: string;
}

/**
 * 将 Shopify 事件名映射到平台事件名
 * 支持所有 full_funnel 事件类型
 */
function mapShopifyEventToPlatform(
  shopifyEventName: string,
  platform: string
): string {
  // 标准化事件名
  const normalizedEvent = shopifyEventName.toLowerCase().replace(/_/g, "_");
  
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

/**
 * 发送事件到 GA4
 */
async function sendToGA4(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string
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

    const platformEventName = mapShopifyEventToPlatform(eventName, "google");
    const data = payload.data || {};
    
    // 构建 GA4 事件参数
    const params: Record<string, unknown> = {
      engagement_time_msec: "1",
    };

    // 对于 page_view 事件，不发送 value（GA4 page_view 事件不需要 value）
    if (platformEventName !== "page_view" && data.value !== undefined && data.value !== null) {
      params.value = data.value;
    }
    if (data.currency) {
      params.currency = data.currency;
    }
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      params.items = data.items.map((item) => ({
        item_id: item.id || item.productId || "",
        item_name: item.name || item.productTitle || "",
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

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ga4Payload),
      },
      DEFAULT_API_TIMEOUT_MS
    );

    if (response.status === 204 || response.ok) {
      return { success: true, platform: "google" };
    }

    const errorText = await response.text().catch(() => "");
    return {
      success: false,
      platform: "google",
      error: `GA4 error: ${response.status} ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: "google",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 发送事件到 Meta
 */
async function sendToMeta(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string
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

    const platformEventName = mapShopifyEventToPlatform(eventName, "meta");
    const data = payload.data || {};
    const eventTime = Math.floor(Date.now() / 1000);

    // 构建 contents（仅当有商品信息时）
    const contents =
      data.items && Array.isArray(data.items) && data.items.length > 0
        ? data.items.map((item) => ({
            id: item.id || item.productId || "",
            quantity: item.quantity || 1,
            item_price: item.price || 0,
          }))
        : [];

    const customData: Record<string, unknown> = {};
    
    // 对于 PageView 事件，不发送 value（Meta PageView 事件不需要 value）
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

    if (response.ok) {
      return { success: true, platform: "meta" };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      platform: "meta",
      error: `Meta error: ${response.status} ${errorData.error?.message || "Unknown error"}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: "meta",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 发送事件到 TikTok
 */
async function sendToTikTok(
  credentials: PlatformCredentials,
  eventName: string,
  payload: PixelEventPayload,
  eventId: string
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

    const platformEventName = mapShopifyEventToPlatform(eventName, "tiktok");
    const data = payload.data || {};
    const timestamp = new Date().toISOString();

    // 构建 contents（仅当有商品信息时）
    const contents =
      data.items && Array.isArray(data.items) && data.items.length > 0
        ? data.items.map((item) => ({
            content_id: item.id || item.productId || "",
            content_name: item.name || item.productTitle || "",
            quantity: item.quantity || 1,
            price: item.price || 0,
          }))
        : [];

    const properties: Record<string, unknown> = {};
    
    // 对于 PageView 事件，不发送 value（TikTok PageView 事件不需要 value）
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
        user: {}, // TikTok 需要用户数据，但对于非 purchase 事件可能没有
      },
      properties,
      ...(tiktokCreds.testEventCode && { test_event_code: tiktokCreds.testEventCode }),
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

    if (response.ok) {
      return { success: true, platform: "tiktok" };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      platform: "tiktok",
      error: `TikTok error: ${response.status} ${errorData.message || "Unknown error"}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: "tiktok",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 发送 pixel 事件到指定平台
 * 
 * P0-3: 多目的地配置支持
 * 
 * @param configId - 可选的配置ID，用于指定要使用的具体配置（支持同一平台的多个配置）
 * @param platformId - 可选的平台ID（如 GA4 property ID、Meta Pixel ID），用于进一步区分配置
 */
export async function sendPixelEventToPlatform(
  shopId: string,
  platform: string,
  payload: PixelEventPayload,
  eventId: string,
  configId?: string,
  platformId?: string
): Promise<PixelEventSendResult> {
  try {
    logger.debug(`Sending ${payload.eventName} to ${platform}`, {
      shopId,
      eventId,
      eventName: payload.eventName,
      platform,
      configId,
      platformId,
    });

    // 获取平台配置
    const pixelConfigs = await getShopPixelConfigs(shopId, { serverSideOnly: true });
    
    // P0-3: 支持多目的地配置 - 优先通过 configId 查找，其次通过 platformId，最后通过平台名称
    let config = configId 
      ? pixelConfigs.find((c) => c.id === configId && c.platform === platform)
      : platformId
      ? pixelConfigs.find((c) => c.platformId === platformId && c.platform === platform)
      : pixelConfigs.find((c) => c.platform === platform);

    // 如果通过 configId 或 platformId 没找到，但存在多个同平台配置，记录警告
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
      // 回退到第一个匹配的配置
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

    // 解密凭证
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

    // 根据平台调用相应的发送函数
    const normalizedPlatform = platform.toLowerCase();
    if (normalizedPlatform === "google") {
      return await sendToGA4(credentials, payload.eventName, payload, eventId);
    } else if (normalizedPlatform === "meta" || normalizedPlatform === "facebook") {
      return await sendToMeta(credentials, payload.eventName, payload, eventId);
    } else if (normalizedPlatform === "tiktok") {
      return await sendToTikTok(credentials, payload.eventName, payload, eventId);
    }

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

