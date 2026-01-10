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

function normalizeTrackingStatus(status: string): string {
  const normalized = status.toLowerCase().trim();
  if (normalized === "pending" || normalized === "inforeceived") {
    return "pending";
  }
  if (normalized === "intransit" || normalized === "outfordelivery") {
    return "in_transit";
  }
  if (normalized === "delivered") {
    return "delivered";
  }
  if (normalized === "exception" || normalized === "expired" || normalized === "attemptfail" || normalized === "undelivered") {
    return "exception";
  }
  return "pending";
}

export class AfterShipTracker {
  private apiKey: string;
  private baseUrl = "https://api.aftership.com/v4";
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  async getTracking(trackingNumber: string, carrier?: string): Promise<TrackingInfo | null> {
    try {
      const url = new URL(`${this.baseUrl}/trackings`);
      url.searchParams.append("tracking_numbers", trackingNumber);
      if (carrier) {
        url.searchParams.append("slug", carrier);
      }
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "as-api-key": this.apiKey,
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
      const trackings = data.data?.trackings || [];
      if (trackings.length === 0) {
        return null;
      }
      const tracking = trackings[0];
      return {
        trackingNumber: tracking.tracking_number,
        carrier: tracking.slug,
        status: normalizeTrackingStatus(tracking.tag || "Unknown"),
        statusDescription: tracking.subtag_message,
        estimatedDelivery: tracking.expected_delivery
          ? new Date(tracking.expected_delivery)
          : undefined,
        events: tracking.checkpoints?.map((cp: {
          checkpoint_time: string;
          location?: string;
          message?: string;
          tag?: string;
        }) => ({
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
          "as-api-key": this.apiKey,
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

export class SeventeenTrackTracker {
  private apiKey: string;
  private baseUrl = "https://api.17track.net";
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
        body: JSON.stringify([
          {
            number: trackingNumber,
            carrier: carrier || "",
          },
        ]),
      });
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`17Track API error: ${response.statusText}`);
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
      const rawStatus = this.mapStatus(trackInfo.latest_status?.status || "Unknown");
      return {
        trackingNumber: track.number,
        carrier: track.carrier || "unknown",
        status: normalizeTrackingStatus(rawStatus),
        statusDescription: trackInfo.latest_status?.status_description,
        estimatedDelivery: trackInfo.latest_status?.sub_status_time
          ? new Date(trackInfo.latest_status.sub_status_time * 1000)
          : undefined,
        events:
          trackInfo.track_detail?.map((event: {
            track_time: number;
            location?: string;
            track_detail?: string;
            status?: string;
            sub_status?: string;
          }) => ({
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
      return null;
  }
}

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
    status: "in_transit",
    events: [],
  };
}
