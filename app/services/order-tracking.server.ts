
import { logger } from "../utils/logger.server";
import prisma from "../db.server";

export interface TrackingProvider {
  name: "aftership" | "17track" | "native";
  apiKey?: string;
  apiUrl?: string;
}

export interface TrackingInfo {
  trackingNumber: string;
  carrier: string;
  status: "pending" | "in_transit" | "delivered" | "exception";
  estimatedDelivery?: Date;
  currentLocation?: string;
  events: Array<{
    timestamp: Date;
    location?: string;
    description: string;
    status: string;
  }>;
}

/**
 * 从 AfterShip API 获取物流追踪信息
 */
export async function fetchTrackingFromAfterShip(
  trackingNumber: string,
  apiKey: string
): Promise<TrackingInfo | null> {
  try {
    const response = await fetch(`https://api.aftership.com/v4/trackings/${trackingNumber}`, {
      headers: {
        "aftership-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      logger.warn("AfterShip API error", {
        status: response.status,
        trackingNumber,
      });
      return null;
    }

    const data = await response.json();
    const tracking = data.data?.tracking;

    if (!tracking) {
      return null;
    }

    return {
      trackingNumber: tracking.tracking_number || trackingNumber,
      carrier: tracking.slug || tracking.courier || "unknown",
      status: mapAfterShipStatus(tracking.tag),
      estimatedDelivery: tracking.expected_delivery
        ? new Date(tracking.expected_delivery)
        : undefined,
      currentLocation: tracking.location || undefined,
      events: (tracking.checkpoints || []).map((checkpoint: any) => ({
        timestamp: new Date(checkpoint.checkpoint_time),
        location: checkpoint.location || undefined,
        description: checkpoint.message || "",
        status: checkpoint.tag || "unknown",
      })),
    };
  } catch (error) {
    logger.error("Failed to fetch tracking from AfterShip", {
      trackingNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 从 17Track API 获取物流追踪信息
 */
export async function fetchTrackingFrom17Track(
  trackingNumber: string,
  apiKey: string
): Promise<TrackingInfo | null> {
  try {
    const response = await fetch(`https://api.17track.net/track/v2.2/gettrackinfo`, {
      method: "POST",
      headers: {
        "17token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        numbers: [trackingNumber],
      }),
    });

    if (!response.ok) {
      logger.warn("17Track API error", {
        status: response.status,
        trackingNumber,
      });
      return null;
    }

    const data = await response.json();
    const track = data.data?.accepted?.[0];

    if (!track) {
      return null;
    }

    return {
      trackingNumber: track.number || trackingNumber,
      carrier: track.carrier || "unknown",
      status: map17TrackStatus(track.latest_status),
      estimatedDelivery: track.latest_checkpoint_time
        ? new Date(track.latest_checkpoint_time)
        : undefined,
      currentLocation: track.latest_checkpoint_location || undefined,
      events: (track.trackings || []).map((event: any) => ({
        timestamp: new Date(event.checkpoint_time),
        location: event.location || undefined,
        description: event.checkpoint_status || "",
        status: event.tag || "unknown",
      })),
    };
  } catch (error) {
    logger.error("Failed to fetch tracking from 17Track", {
      trackingNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 从 Shopify Fulfillment 获取物流追踪信息（原生方式）
 */
export async function getTrackingFromShopify(
  shopId: string,
  orderId: string
): Promise<TrackingInfo | null> {
  try {
    // 从数据库获取订单的 fulfillment 信息
    // 注意：这需要从 Shopify Admin API 获取，这里简化处理
    const order = await prisma.conversionJob.findFirst({
      where: {
        shopId,
        orderId,
      },
      select: {
        orderNumber: true,
      },
    });

    if (!order) {
      return null;
    }

    // 返回基础追踪信息（需要从 Shopify API 获取实际数据）
    return {
      trackingNumber: order.orderNumber || "",
      carrier: "shopify",
      status: "pending",
      events: [],
    };
  } catch (error) {
    logger.error("Failed to get tracking from Shopify", {
      shopId,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 获取订单追踪信息（统一接口）
 */
export async function getOrderTracking(
  shopId: string,
  orderId: string,
  trackingNumber?: string
): Promise<TrackingInfo | null> {
  try {
    // 获取店铺的订单追踪配置
    const setting = await prisma.uiExtensionSetting.findUnique({
      where: {
        shopId_moduleKey: {
          shopId,
          moduleKey: "order_tracking",
        },
      },
    });

    if (!setting || !setting.isEnabled) {
      return null;
    }

    const config = setting.settingsJson as {
      provider?: "aftership" | "17track" | "native";
      apiKey?: string;
    } | null;

    const provider = config?.provider || "native";

    // 如果没有追踪号，尝试从订单获取
    if (!trackingNumber) {
      const tracking = await getTrackingFromShopify(shopId, orderId);
      if (tracking?.trackingNumber) {
        trackingNumber = tracking.trackingNumber;
      }
    }

    if (!trackingNumber) {
      return null;
    }

    // 根据提供商获取追踪信息
    switch (provider) {
      case "aftership":
        if (config?.apiKey) {
          return await fetchTrackingFromAfterShip(trackingNumber, config.apiKey);
        }
        break;

      case "17track":
        if (config?.apiKey) {
          return await fetchTrackingFrom17Track(trackingNumber, config.apiKey);
        }
        break;

      case "native":
      default:
        return await getTrackingFromShopify(shopId, orderId);
    }

    return null;
  } catch (error) {
    logger.error("Failed to get order tracking", {
      shopId,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 映射 AfterShip 状态到统一状态
 */
function mapAfterShipStatus(tag: string): TrackingInfo["status"] {
  switch (tag?.toLowerCase()) {
    case "pending":
    case "info_received":
      return "pending";
    case "in_transit":
    case "out_for_delivery":
      return "in_transit";
    case "delivered":
      return "delivered";
    case "exception":
    case "expired":
    case "failed_attempt":
      return "exception";
    default:
      return "pending";
  }
}

/**
 * 映射 17Track 状态到统一状态
 */
function map17TrackStatus(status: string): TrackingInfo["status"] {
  switch (status?.toLowerCase()) {
    case "pending":
    case "notfound":
      return "pending";
    case "transit":
    case "in_transit":
      return "in_transit";
    case "delivered":
      return "delivered";
    case "exception":
    case "expired":
      return "exception";
    default:
      return "pending";
  }
}

