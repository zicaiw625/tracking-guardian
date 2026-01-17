import { createHmac } from "crypto";
import { logger } from "../../utils/logger.server";
import { fetchWithTimeout } from "../platforms/interface";
import type {
  ITrackingProvider,
  TrackingProviderCredentials,
  TrackingResult,
  TrackingError,
  BatchTrackingRequest,
  BatchTrackingResult,
  TrackingEvent,
  TrackingWebhookEvent,
} from "./types";
import { TrackingStatus } from "./types";

interface AfterShipTracking {
  id: string;
  tracking_number: string;
  slug: string;
  title: string;
  tag: string;
  subtag: string;
  subtag_message: string;
  expected_delivery: string | null;
  origin_country_iso3: string | null;
  destination_country_iso3: string | null;
  shipment_delivery_date: string | null;
  checkpoints: AfterShipCheckpoint[];
  updated_at: string;
}

interface AfterShipCheckpoint {
  created_at: string;
  tag: string;
  subtag: string;
  subtag_message: string;
  location: string | null;
  city: string | null;
  state: string | null;
  country_iso3: string | null;
  country_name: string | null;
  message: string;
  raw_tag: string;
}

interface AfterShipApiResponse<T> {
  meta: {
    code: number;
    message: string;
  };
  data: T;
}

const AFTERSHIP_STATUS_MAP: Record<string, TrackingStatus> = {
  Pending: TrackingStatus.PENDING,
  InfoReceived: TrackingStatus.INFO_RECEIVED,
  InTransit: TrackingStatus.IN_TRANSIT,
  OutForDelivery: TrackingStatus.OUT_FOR_DELIVERY,
  AttemptFail: TrackingStatus.FAILED_ATTEMPT,
  Delivered: TrackingStatus.DELIVERED,
  AvailableForPickup: TrackingStatus.AVAILABLE_FOR_PICKUP,
  Exception: TrackingStatus.EXCEPTION,
  Expired: TrackingStatus.EXPIRED,
};

function mapAfterShipStatus(tag: string): TrackingStatus {
  return AFTERSHIP_STATUS_MAP[tag] || TrackingStatus.UNKNOWN;
}

export class AfterShipProvider implements ITrackingProvider {
  readonly name = "AfterShip";
  readonly code = "aftership";
  private apiKey: string = "";
  private webhookSecret: string = "";
  private baseUrl = "https://api.aftership.com";
  async initialize(credentials: TrackingProviderCredentials): Promise<void> {
    this.apiKey = credentials.apiKey;
    this.webhookSecret = credentials.webhookSecret || "";
    logger.info("AfterShip provider initialized");
  }
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "as-api-key": this.apiKey,
      "Content-Type": "application/json",
    };
    const response = await fetchWithTimeout(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json()) as AfterShipApiResponse<T>;
    if (data.meta.code !== 200 && data.meta.code !== 201) {
      throw new Error(`AfterShip API error: ${data.meta.message}`);
    }
    return data.data;
  }
  async getTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<TrackingResult | TrackingError> {
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
        throw new Error(`AfterShip API error: ${response.statusText}`);
      }
      const data = (await response.json()) as AfterShipApiResponse<{ trackings: AfterShipTracking[] }>;
      if (data.meta.code !== 200 && data.meta.code !== 201) {
        throw new Error(`AfterShip API error: ${data.meta.message}`);
      }
      const trackings = data.data?.trackings || [];
      if (trackings.length === 0) {
        return {
          trackingNumber,
          error: "Tracking not found",
          errorCode: "AFTERSHIP_NOT_FOUND",
        };
      }
      return this.transformTracking(trackings[0]);
    } catch (error) {
      logger.error(`AfterShip getTracking failed for ${trackingNumber}:`, error);
      return {
        trackingNumber,
        error: error instanceof Error ? error.message : "Unknown error",
        errorCode: "AFTERSHIP_ERROR",
      };
    }
  }
  async batchGetTracking(request: BatchTrackingRequest): Promise<BatchTrackingResult> {
    const results: Array<TrackingResult | TrackingError> = [];
    let successCount = 0;
    let failureCount = 0;
    const promises = request.trackings.map((t) =>
      this.getTracking(t.trackingNumber, t.carrierCode)
    );
    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
        if ("events" in result.value) {
          successCount++;
        } else {
          failureCount++;
        }
      } else {
        failureCount++;
        results.push({
          trackingNumber: "unknown",
          error: result.reason?.message || "Unknown error",
        });
      }
    }
    return { results, successCount, failureCount };
  }
  async registerTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        tracking: {
          tracking_number: trackingNumber,
          ...(carrier && { slug: carrier }),
        },
      };
      await this.request<{ tracking: AfterShipTracking }>("POST", "/trackings", body);
      return true;
    } catch (error) {
      logger.error(`AfterShip registerTracking failed for ${trackingNumber}:`, error);
      return false;
    }
  }
  async unregisterTracking(trackingNumber: string): Promise<boolean> {
    try {
      await this.request<void>("DELETE", `/trackings/${trackingNumber}`);
      return true;
    } catch (error) {
      logger.error(`AfterShip unregisterTracking failed for ${trackingNumber}:`, error);
      return false;
    }
  }
  parseWebhook(
    payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): TrackingWebhookEvent | null {
    try {
      const msg = payload.msg as AfterShipTracking | undefined;
      if (!msg || !msg.tracking_number) {
        return null;
      }
      const latestCheckpoint = msg.checkpoints?.[0];
      return {
        trackingNumber: msg.tracking_number,
        carrier: msg.title,
        carrierCode: msg.slug,
        status: mapAfterShipStatus(msg.tag),
        previousStatus: undefined,
        event: latestCheckpoint
          ? this.transformCheckpoint(latestCheckpoint)
          : {
              timestamp: new Date(msg.updated_at),
              status: mapAfterShipStatus(msg.tag),
              description: msg.subtag_message,
            },
        rawPayload: payload,
      };
    } catch (error) {
      logger.error("AfterShip parseWebhook failed:", error);
      return null;
    }
  }
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn("AfterShip webhook secret not configured");
      return true;
    }
    try {
      const expectedSignature = createHmac("sha256", this.webhookSecret)
        .update(payload)
        .digest("hex");
      return expectedSignature === signature;
    } catch (error) {
      logger.error("AfterShip signature verification failed:", error);
      return false;
    }
  }
  async detectCarrier(trackingNumber: string): Promise<string | null> {
    try {
      const data = await this.request<{ couriers: Array<{ slug: string; name: string }> }>(
        "POST",
        "/couriers/detect",
        { tracking: { tracking_number: trackingNumber } }
      );
      if (data.couriers && data.couriers.length > 0) {
        return data.couriers[0].slug;
      }
      return null;
    } catch (error) {
      logger.error(`AfterShip detectCarrier failed for ${trackingNumber}:`, error);
      return null;
    }
  }
  private transformTracking(tracking: AfterShipTracking): TrackingResult {
    const rawData: Record<string, unknown> = {
      id: tracking.id,
      tracking_number: tracking.tracking_number,
      slug: tracking.slug,
      title: tracking.title,
      tag: tracking.tag,
      subtag: tracking.subtag,
      subtag_message: tracking.subtag_message,
      expected_delivery: tracking.expected_delivery,
      origin_country_iso3: tracking.origin_country_iso3,
      destination_country_iso3: tracking.destination_country_iso3,
      shipment_delivery_date: tracking.shipment_delivery_date,
      checkpoints: tracking.checkpoints,
      updated_at: tracking.updated_at,
    };
    return {
      trackingNumber: tracking.tracking_number,
      carrier: tracking.title,
      carrierCode: tracking.slug,
      currentStatus: mapAfterShipStatus(tracking.tag),
      estimatedDelivery: tracking.expected_delivery
        ? new Date(tracking.expected_delivery)
        : undefined,
      originCountry: tracking.origin_country_iso3 || undefined,
      destinationCountry: tracking.destination_country_iso3 || undefined,
      events: tracking.checkpoints.map((cp) => this.transformCheckpoint(cp)),
      lastUpdate: new Date(tracking.updated_at),
      rawData,
    };
  }
  private transformCheckpoint(checkpoint: AfterShipCheckpoint): TrackingEvent {
    const location = [checkpoint.city, checkpoint.state, checkpoint.country_name]
      .filter(Boolean)
      .join(", ");
    return {
      timestamp: new Date(checkpoint.created_at),
      status: mapAfterShipStatus(checkpoint.tag),
      description: checkpoint.message || checkpoint.subtag_message,
      location: location || checkpoint.location || undefined,
      rawStatus: checkpoint.raw_tag,
    };
  }
}

export const afterShipProvider = new AfterShipProvider();
