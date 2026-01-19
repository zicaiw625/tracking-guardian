import { logger } from "../utils/logger.server";
import { fetchWithTimeout } from "./platforms/interface";
import { isCircuitBreakerTripped, tripCircuitBreaker } from "../utils/circuit-breaker";
import { CIRCUIT_BREAKER_CONFIG } from "../utils/config.shared";

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
  async getTracking(trackingNumber: string, carrier?: string, providerId?: string): Promise<TrackingInfo | null> {
    try {
      const url = new URL(`${this.baseUrl}/trackings`);
      url.searchParams.append("tracking_numbers", trackingNumber);
      if (carrier) {
        url.searchParams.append("slug", carrier);
      }
      const response = await fetchWithTimeout(url.toString(), {
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
      let data: unknown;
      try {
        data = await response.json();
      } catch (jsonError) {
        logger.error("Failed to parse AfterShip response as JSON", {
          error: jsonError instanceof Error ? jsonError.message : String(jsonError),
          trackingNumber,
        });
        if (providerId) {
          await tripCircuitBreaker(`tracking:${providerId}`, {
            cooldownMs: CIRCUIT_BREAKER_CONFIG.RECOVERY_TIME_MS,
          });
        }
        return null;
      }
      const trackings = Array.isArray(
        data && typeof data === "object" && data !== null && (data as { data?: { trackings?: unknown } }).data?.trackings
      )
        ? (data as { data: { trackings: unknown[] } }).data.trackings
        : [];
      if (trackings.length === 0) {
        return null;
      }
      const tracking = trackings[0] as Record<string, unknown>;
      const checkpoints = Array.isArray(tracking.checkpoints) ? tracking.checkpoints : [];
      const events = checkpoints.map((cp: Record<string, unknown>) => ({
        timestamp: new Date(typeof cp.checkpoint_time === "string" ? cp.checkpoint_time : 0),
        location: typeof cp.location === "string" ? cp.location : undefined,
        description: typeof cp.message === "string" ? cp.message : "",
        status: typeof cp.tag === "string" ? cp.tag : undefined,
      }));
      return {
        trackingNumber: typeof tracking.tracking_number === "string" ? tracking.tracking_number : String(trackingNumber),
        carrier: typeof tracking.slug === "string" ? tracking.slug : "unknown",
        status: normalizeTrackingStatus(typeof tracking.tag === "string" ? tracking.tag : "Unknown"),
        statusDescription: typeof tracking.subtag_message === "string" ? tracking.subtag_message : undefined,
        estimatedDelivery:
          typeof tracking.expected_delivery === "string"
            ? new Date(tracking.expected_delivery)
            : undefined,
        events,
      };
    } catch (error) {
      logger.error("Failed to fetch tracking from AfterShip", {
        error: error instanceof Error ? error.message : String(error),
        trackingNumber,
      });
      if (providerId) {
        await tripCircuitBreaker(`tracking:${providerId}`, {
          cooldownMs: CIRCUIT_BREAKER_CONFIG.RECOVERY_TIME_MS,
        });
      }
      return null;
    }
  }
  async createTracking(
    trackingNumber: string,
    carrier: string,
    orderId?: string
  ): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/trackings`, {
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
  async getTracking(trackingNumber: string, carrier?: string, providerId?: string): Promise<TrackingInfo | null> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/gettrackinfo`, {
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
      let data: unknown;
      try {
        data = await response.json();
      } catch (jsonError) {
        logger.error("Failed to parse 17Track response as JSON", {
          error: jsonError instanceof Error ? jsonError.message : String(jsonError),
          trackingNumber,
        });
        if (providerId) {
          await tripCircuitBreaker(`tracking:${providerId}`, {
            cooldownMs: CIRCUIT_BREAKER_CONFIG.RECOVERY_TIME_MS,
          });
        }
        return null;
      }
      const d = data && typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
      const dataData = d?.data as Record<string, unknown> | undefined;
      const accepted = Array.isArray(dataData?.accepted) ? dataData!.accepted as unknown[] : [];
      if ((d as { code?: number })?.code !== 0 || accepted.length === 0) {
        return null;
      }
      const track = accepted[0] as Record<string, unknown>;
      const trackMap = dataData?.track as Record<string, unknown> | undefined;
      const trackInfo = (typeof track?.number === "string" ? trackMap?.[track.number] : null) as Record<string, unknown> | undefined;
      if (!trackInfo) {
        return null;
      }
      const latest = trackInfo.latest_status as Record<string, unknown> | undefined;
      const rawStatus = this.mapStatus(typeof latest?.status === "string" ? latest.status : "Unknown");
      const trackDetail = Array.isArray(trackInfo.track_detail) ? trackInfo.track_detail : [];
      const events = trackDetail.map((event: Record<string, unknown>) => {
        const ts = typeof event.track_time === "number" ? event.track_time * 1000 : 0;
        return {
          timestamp: new Date(ts),
          location: typeof event.location === "string" ? event.location : undefined,
          description: typeof event.track_detail === "string" ? event.track_detail : "",
          status: typeof event.sub_status === "string" ? event.sub_status : undefined,
        };
      });
      const subStatusTime = latest?.sub_status_time;
      return {
        trackingNumber: typeof track.number === "string" ? track.number : String(trackingNumber),
        carrier: typeof track.carrier === "string" ? track.carrier : "unknown",
        status: normalizeTrackingStatus(rawStatus),
        statusDescription: typeof latest?.status_description === "string" ? latest.status_description : undefined,
        estimatedDelivery: typeof subStatusTime === "number" ? new Date(subStatusTime * 1000) : undefined,
        events,
      };
    } catch (error) {
      logger.error("Failed to fetch tracking from 17Track", {
        error: error instanceof Error ? error.message : String(error),
        trackingNumber,
      });
      if (providerId) {
        await tripCircuitBreaker(`tracking:${providerId}`, {
          cooldownMs: CIRCUIT_BREAKER_CONFIG.RECOVERY_TIME_MS,
        });
      }
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
  if (await isCircuitBreakerTripped(`tracking:${config.provider}`)) {
    return null;
  }
  switch (config.provider) {
    case "aftership": {
      const aftership = new AfterShipTracker(config.apiKey);
      return aftership.getTracking(trackingNumber, carrier, "aftership");
    }
    case "17track": {
      const seventeenTrack = new SeventeenTrackTracker(config.apiKey);
      return seventeenTrack.getTracking(trackingNumber, carrier, "17track");
    }
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
