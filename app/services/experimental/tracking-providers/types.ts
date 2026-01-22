export enum TrackingStatus {
  PENDING = "pending",
  INFO_RECEIVED = "info_received",
  IN_TRANSIT = "in_transit",
  OUT_FOR_DELIVERY = "out_for_delivery",
  DELIVERED = "delivered",
  FAILED_ATTEMPT = "failed_attempt",
  AVAILABLE_FOR_PICKUP = "available_for_pickup",
  EXCEPTION = "exception",
  EXPIRED = "expired",
  UNKNOWN = "unknown",
}

export interface TrackingEvent {
  timestamp: Date;
  status: TrackingStatus;
  description: string;
  location?: string;
  rawStatus?: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  carrierCode: string;
  currentStatus: TrackingStatus;
  estimatedDelivery?: Date;
  originCountry?: string;
  destinationCountry?: string;
  events: TrackingEvent[];
  lastUpdate: Date;
  rawData?: Record<string, unknown>;
}

export interface BatchTrackingRequest {
  trackings: Array<{
    trackingNumber: string;
    carrier?: string;
    carrierCode?: string;
  }>;
}

export interface BatchTrackingResult {
  results: Array<TrackingResult | TrackingError>;
  successCount: number;
  failureCount: number;
}

export interface TrackingError {
  trackingNumber: string;
  error: string;
  errorCode?: string;
}

export interface TrackingProviderCredentials {
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
}

export interface TrackingWebhookEvent {
  trackingNumber: string;
  carrier: string;
  carrierCode: string;
  status: TrackingStatus;
  previousStatus?: TrackingStatus;
  event: TrackingEvent;
  rawPayload: Record<string, unknown>;
}

export interface ITrackingProvider {
  readonly name: string;
  readonly code: string;
  initialize(credentials: TrackingProviderCredentials): Promise<void>;
  getTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<TrackingResult | TrackingError>;
  batchGetTracking(
    request: BatchTrackingRequest
  ): Promise<BatchTrackingResult>;
  registerTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<boolean>;
  unregisterTracking(trackingNumber: string): Promise<boolean>;
  parseWebhook(
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): TrackingWebhookEvent | null;
  verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean;
  detectCarrier(trackingNumber: string): Promise<string | null>;
}

export interface CarrierInfo {
  code: string;
  name: string;
  country?: string;
  website?: string;
  trackingUrl?: string;
}

export const COMMON_CARRIERS: CarrierInfo[] = [
  { code: "sf-express", name: "顺丰速运", country: "CN", website: "https://www.sf-express.com" },
  { code: "yto", name: "圆通速递", country: "CN", website: "https://www.yto.net.cn" },
  { code: "zto", name: "中通快递", country: "CN", website: "https://www.zto.com" },
  { code: "yunda", name: "韵达快递", country: "CN", website: "https://www.yundaex.com" },
  { code: "sto", name: "申通快递", country: "CN", website: "https://www.sto.cn" },
  { code: "ems", name: "中国邮政EMS", country: "CN", website: "https://www.ems.com.cn" },
  { code: "jd", name: "京东物流", country: "CN", website: "https://www.jd.com" },
  { code: "cainiao", name: "菜鸟物流", country: "CN", website: "https://www.cainiao.com" },
  { code: "dhl", name: "DHL", country: "DE", website: "https://www.dhl.com" },
  { code: "fedex", name: "FedEx", country: "US", website: "https://www.fedex.com" },
  { code: "ups", name: "UPS", country: "US", website: "https://www.ups.com" },
  { code: "usps", name: "USPS", country: "US", website: "https://www.usps.com" },
  { code: "royal-mail", name: "Royal Mail", country: "GB", website: "https://www.royalmail.com" },
  { code: "canada-post", name: "Canada Post", country: "CA", website: "https://www.canadapost.ca" },
  { code: "australia-post", name: "Australia Post", country: "AU", website: "https://www.auspost.com.au" },
  { code: "japan-post", name: "Japan Post", country: "JP", website: "https://www.post.japanpost.jp" },
  { code: "yanwen", name: "燕文物流", country: "CN", website: "https://www.yanwen.com" },
  { code: "4px", name: "递四方", country: "CN", website: "https://www.4px.com" },
  { code: "cne", name: "CNE", country: "CN", website: "https://www.cne.com" },
];
