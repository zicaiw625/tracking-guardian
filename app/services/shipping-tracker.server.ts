
import { logger } from "../utils/logger.server";

export type TrackingProvider = "aftership" | "17track" | "native";

export interface TrackingInfo {
  trackingNumber: string;
  carrier: string;
  status: string;
  statusDescription?: string;
  estimatedDelivery?: Date;
  events: TrackingEvent[];
}

export interface TrackingEvent {
  timestamp: Date;
  location?: string;
  description: string;
  status?: string;
}

export interface TrackingProviderConfig {
  provider: TrackingProvider;
  apiKey?: string;
  apiSecret?: string;
}

/**
 * AfterShip API 对接
 * API 文档: https://www.aftership.com/docs/api/4
 */
export class AfterShipTracker {
  private apiKey: string;
  private baseUrl = "https://api.aftership.com/v4";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTracking(trackingNumber: string, carrier?: string): Promise<TrackingInfo | null> {
    try {
      const url = carrier
        ? `${this.baseUrl}/trackings/${carrier}/${trackingNumber}`
        : `${this.baseUrl}/trackings/${trackingNumber}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "aftership-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`AfterShip API error: ${response.statusText}`);
      }

      const data = await response.json();
      const tracking = data.data.tracking;

      return {
        trackingNumber: tracking.tracking_number,
        carrier: tracking.slug,
        status: tracking.tag || "Unknown",
        statusDescription: tracking.subtag_message,
        estimatedDelivery: tracking.expected_delivery
          ? new Date(tracking.expected_delivery)
          : undefined,
        events: tracking.checkpoints?.map((cp: any) => ({
          timestamp: new Date(cp.checkpoint_time),
          location: cp.location,
          description: cp.message,
          status: cp.tag,
        })) || [],
      };
    } catch (error) {
      logger.error("Failed to fetch tracking from AfterShip", {
        error: error instanceof Error ? error.message : String(error),
        trackingNumber,
      });
      return null;
    }
  }

  async createTracking(
    trackingNumber: string,
    carrier: string,
    orderId?: string
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/trackings`, {
        method: "POST",
        headers: {
          "aftership-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tracking: {
            tracking_number: trackingNumber,
            slug: carrier,
            ...(orderId && { order_id: orderId }),
          },
        }),
      });

      return response.ok;
    } catch (error) {
      logger.error("Failed to create tracking in AfterShip", {
        error: error instanceof Error ? error.message : String(error),
        trackingNumber,
      });
      return false;
    }
  }
}

/**
 * 17Track API 对接
 * API 文档: https://documentation.17track.net/
 */
export class SeventeenTrackTracker {
  private apiKey: string;
  private baseUrl = "https://api.17track.net/track/v2.2";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTracking(trackingNumber: string, carrier?: string): Promise<TrackingInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/gettrackinfo`, {
        method: "POST",
        headers: {
          "17token": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: trackingNumber,
          carrier: carrier || "",
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`17Track API error: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.code !== 200 || !data.data?.accepted || data.data.accepted.length === 0) {
        return null;
      }

      const track = data.data.accepted[0];
      const trackInfo = data.data.track?.[track.number];

      if (!trackInfo) {
        return null;
      }

      return {
        trackingNumber: track.number,
        carrier: track.carrier || "unknown",
        status: this.mapStatus(trackInfo.latest_status?.status || "Unknown"),
        statusDescription: trackInfo.latest_status?.status_description,
        estimatedDelivery: trackInfo.latest_status?.sub_status_time
          ? new Date(trackInfo.latest_status.sub_status_time * 1000)
          : undefined,
        events:
          trackInfo.track_detail?.map((event: any) => ({
            timestamp: new Date(event.track_time * 1000),
            location: event.location,
            description: event.track_detail,
            status: event.sub_status,
          })) || [],
      };
    } catch (error) {
      logger.error("Failed to fetch tracking from 17Track", {
        error: error instanceof Error ? error.message : String(error),
        trackingNumber,
      });
      return null;
    }
  }

  private mapStatus(status: string): string {
    const statusMap: Record<string, string> = {
      "1": "InTransit",
      "2": "Expired",
      "3": "Delivered",
      "4": "Exception",
      "5": "Undelivered",
    };
    return statusMap[status] || status;
  }
}

/**
 * 统一的追踪服务
 */
export async function getTrackingInfo(
  config: TrackingProviderConfig,
  trackingNumber: string,
  carrier?: string
): Promise<TrackingInfo | null> {
  if (!config.apiKey) {
    logger.warn("Tracking provider API key not configured", { provider: config.provider });
    return null;
  }

  switch (config.provider) {
    case "aftership":
      const aftership = new AfterShipTracker(config.apiKey);
      return aftership.getTracking(trackingNumber, carrier);
    case "17track":
      const seventeenTrack = new SeventeenTrackTracker(config.apiKey);
      return seventeenTrack.getTracking(trackingNumber, carrier);
    case "native":
    default:
      // 使用 Shopify 原生追踪（通过订单信息）
      return null;
  }
}

/**
 * 从 Shopify 订单获取追踪信息
 */
export async function getTrackingFromShopifyOrder(
  orderData: {
    fulfillmentTrackingInfo?: Array<{
      number: string;
      company: string;
      url?: string;
    }>;
  }
): Promise<TrackingInfo | null> {
  if (!orderData.fulfillmentTrackingInfo || orderData.fulfillmentTrackingInfo.length === 0) {
    return null;
  }

  const tracking = orderData.fulfillmentTrackingInfo[0];
  return {
    trackingNumber: tracking.number,
    carrier: tracking.company || "unknown",
    status: "InTransit", // Shopify 不提供详细状态
    events: [],
  };
}

