import { logger } from "../utils/logger.server";
import prisma from "../db.server";
import { getUiModuleConfig } from "./ui-extension.server";

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
    const url = new URL("https://api.aftership.com/v4/trackings");
    url.searchParams.append("tracking_numbers", trackingNumber);
    const response = await fetch(url.toString(), {
      headers: {
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
      currentLocation: undefined,
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
    const response = await fetch(`https://api.17track.net/track/v2.2/register`, {
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
      currentLocation: undefined,
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
    const config = await getUiModuleConfig(shopId, "order_tracking");
    if (!config.isEnabled) {
      return null;
    }
    const settings = config.settings as {
      provider?: "aftership" | "17track" | "native";
      apiKey?: string;
    } | null;
    const provider = settings?.provider || "native";
    const { canUseThirdPartyTracking } = await import("../utils/version-gate");
    if (provider !== "native") {
      const gateResult = canUseThirdPartyTracking(provider);
      if (!gateResult.allowed) {
        logger.warn(`Third-party tracking provider ${provider} not available in v1.0`, {
          shopId,
          orderId,
          reason: gateResult.reason,
        });
      }
    }
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
        if (settings?.apiKey) {
          return await fetchTrackingFromAfterShip(trackingNumber, settings.apiKey);
        }
        break;
      case "17track":
        if (settings?.apiKey) {
          return await fetchTrackingFrom17Track(trackingNumber, settings.apiKey);
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
