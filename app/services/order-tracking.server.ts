
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

export async function fetchTrackingFromAfterShip(
  trackingNumber: string,
  apiKey: string
): Promise<TrackingInfo | null> {
  try {
    // 使用新版 AfterShip Tracking API (2025-07 version)
    // 使用 GET /trackings 通过查询参数过滤，而不是直接访问 /trackings/{number}
    const url = new URL("https://api.aftership.com/tracking/2025-07/trackings");
    url.searchParams.append("tracking_numbers", trackingNumber);
    
    const response = await fetch(url.toString(), {
      headers: {
        // 使用新版 API header: as-api-key (不是 aftership-api-key)
        "as-api-key": apiKey,
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
    // 新版 API 返回格式：{ data: { trackings: [...] } }
    const trackings = data.data?.trackings || [];
    if (trackings.length === 0) {
      return null;
    }
    const tracking = trackings[0];

    return {
      trackingNumber: tracking.tracking_number || trackingNumber,
      carrier: tracking.slug || "unknown",
      status: mapAfterShipStatus(tracking.tag),
      estimatedDelivery: tracking.expected_delivery
        ? new Date(tracking.expected_delivery)
        : undefined,
      currentLocation: undefined, // 新版 API 中 location 在 checkpoints 中
      events: (tracking.checkpoints || []).map((checkpoint: {
        checkpoint_time: string;
        location?: string;
        message?: string;
        tag?: string;
      }) => ({
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

export async function fetchTrackingFrom17Track(
  trackingNumber: string,
  apiKey: string
): Promise<TrackingInfo | null> {
  try {
    // 17TRACK v2.2 API：body 是数组格式，一次最多 40 个
    const response = await fetch(`https://api.17track.net/track/v2.2/gettrackinfo`, {
      method: "POST",
      headers: {
        "17token": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          number: trackingNumber,
          carrier: "",
        },
      ]),
    });

    if (!response.ok) {
      logger.warn("17Track API error", {
        status: response.status,
        trackingNumber,
      });
      return null;
    }

    const data = await response.json();
    // 17TRACK v2.2 成功时 code 通常是 0，不是 200
    if (data.code !== 0 || !data.data?.accepted || data.data.accepted.length === 0) {
      return null;
    }

    const track = data.data.accepted[0];
    const trackInfo = data.data.track?.[track.number];

    if (!trackInfo) {
      return null;
    }

    return {
      trackingNumber: track.number || trackingNumber,
      carrier: track.carrier || "unknown",
      status: map17TrackStatus(trackInfo.latest_status?.status || "Unknown"),
      estimatedDelivery: trackInfo.latest_status?.sub_status_time
        ? new Date(trackInfo.latest_status.sub_status_time * 1000)
        : undefined,
      currentLocation: undefined, // 17track API 中 location 在 track_detail 中
      events: (trackInfo.track_detail || []).map((event: {
        track_time: number;
        location?: string;
        track_detail?: string;
        status?: string;
        sub_status?: string;
      }) => ({
        timestamp: new Date(event.track_time * 1000),
        location: event.location || undefined,
        description: event.track_detail || "",
        status: event.sub_status || "unknown",
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

export async function getTrackingFromShopify(
  shopId: string,
  orderId: string
): Promise<TrackingInfo | null> {
  try {

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

export async function getOrderTracking(
  shopId: string,
  orderId: string,
  trackingNumber?: string
): Promise<TrackingInfo | null> {
  try {

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

    if (!trackingNumber) {
      const tracking = await getTrackingFromShopify(shopId, orderId);
      if (tracking?.trackingNumber) {
        trackingNumber = tracking.trackingNumber;
      }
    }

    if (!trackingNumber) {
      return null;
    }

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

