/**
 * 物流追踪服务提供商接口定义
 *
 * 支持集成第三方物流追踪服务，如：
 * - AfterShip
 * - 17Track
 * - ShipStation
 * - Track17 API
 */

// ============================================================
// 通用类型
// ============================================================

/**
 * 物流追踪状态枚举
 */
export enum TrackingStatus {
  PENDING = "pending",           // 等待揽收
  INFO_RECEIVED = "info_received", // 信息已接收
  IN_TRANSIT = "in_transit",     // 运输中
  OUT_FOR_DELIVERY = "out_for_delivery", // 派送中
  DELIVERED = "delivered",       // 已签收
  FAILED_ATTEMPT = "failed_attempt", // 投递失败
  AVAILABLE_FOR_PICKUP = "available_for_pickup", // 待自提
  EXCEPTION = "exception",       // 异常
  EXPIRED = "expired",           // 已过期
  UNKNOWN = "unknown",           // 未知状态
}

/**
 * 单个物流事件
 */
export interface TrackingEvent {
  timestamp: Date;
  status: TrackingStatus;
  description: string;
  location?: string;
  rawStatus?: string;
}

/**
 * 物流追踪结果
 */
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

/**
 * 批量追踪请求
 */
export interface BatchTrackingRequest {
  trackings: Array<{
    trackingNumber: string;
    carrier?: string;
    carrierCode?: string;
  }>;
}

/**
 * 批量追踪结果
 */
export interface BatchTrackingResult {
  results: Array<TrackingResult | TrackingError>;
  successCount: number;
  failureCount: number;
}

/**
 * 追踪错误
 */
export interface TrackingError {
  trackingNumber: string;
  error: string;
  errorCode?: string;
}

/**
 * 物流服务商凭证
 */
export interface TrackingProviderCredentials {
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
}

/**
 * Webhook 事件
 */
export interface TrackingWebhookEvent {
  trackingNumber: string;
  carrier: string;
  carrierCode: string;
  status: TrackingStatus;
  previousStatus?: TrackingStatus;
  event: TrackingEvent;
  rawPayload: Record<string, unknown>;
}

// ============================================================
// 服务提供商接口
// ============================================================

/**
 * 物流追踪服务提供商接口
 */
export interface ITrackingProvider {
  /**
   * 服务商名称
   */
  readonly name: string;

  /**
   * 服务商代码
   */
  readonly code: string;

  /**
   * 初始化服务商
   */
  initialize(credentials: TrackingProviderCredentials): Promise<void>;

  /**
   * 获取单个运单追踪信息
   */
  getTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<TrackingResult | TrackingError>;

  /**
   * 批量获取追踪信息
   */
  batchGetTracking(
    request: BatchTrackingRequest
  ): Promise<BatchTrackingResult>;

  /**
   * 注册追踪（用于 Webhook 通知）
   */
  registerTracking(
    trackingNumber: string,
    carrier?: string
  ): Promise<boolean>;

  /**
   * 取消追踪注册
   */
  unregisterTracking(trackingNumber: string): Promise<boolean>;

  /**
   * 解析 Webhook 事件
   */
  parseWebhook(
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): TrackingWebhookEvent | null;

  /**
   * 验证 Webhook 签名
   */
  verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean;

  /**
   * 自动检测运输商
   */
  detectCarrier(trackingNumber: string): Promise<string | null>;
}

// ============================================================
// 运输商信息
// ============================================================

/**
 * 运输商信息
 */
export interface CarrierInfo {
  code: string;
  name: string;
  country?: string;
  website?: string;
  trackingUrl?: string; // 追踪链接模板，例如 "https://example.com/track?num={tracking_number}"
}

/**
 * 常用运输商列表
 */
export const COMMON_CARRIERS: CarrierInfo[] = [
  // 中国
  { code: "sf-express", name: "顺丰速运", country: "CN", website: "https://www.sf-express.com" },
  { code: "yto", name: "圆通速递", country: "CN", website: "https://www.yto.net.cn" },
  { code: "zto", name: "中通快递", country: "CN", website: "https://www.zto.com" },
  { code: "yunda", name: "韵达快递", country: "CN", website: "https://www.yundaex.com" },
  { code: "sto", name: "申通快递", country: "CN", website: "https://www.sto.cn" },
  { code: "ems", name: "中国邮政EMS", country: "CN", website: "https://www.ems.com.cn" },
  { code: "jd", name: "京东物流", country: "CN", website: "https://www.jdl.com" },
  { code: "cainiao", name: "菜鸟物流", country: "CN", website: "https://www.cainiao.com" },

  // 国际
  { code: "dhl", name: "DHL", country: "DE", website: "https://www.dhl.com" },
  { code: "fedex", name: "FedEx", country: "US", website: "https://www.fedex.com" },
  { code: "ups", name: "UPS", country: "US", website: "https://www.ups.com" },
  { code: "usps", name: "USPS", country: "US", website: "https://www.usps.com" },
  { code: "royal-mail", name: "Royal Mail", country: "GB", website: "https://www.royalmail.com" },
  { code: "canada-post", name: "Canada Post", country: "CA", website: "https://www.canadapost-postescanada.ca" },
  { code: "australia-post", name: "Australia Post", country: "AU", website: "https://auspost.com.au" },
  { code: "japan-post", name: "Japan Post", country: "JP", website: "https://www.post.japanpost.jp" },

  // 跨境电商专线
  { code: "yanwen", name: "燕文物流", country: "CN", website: "https://www.yw56.com.cn" },
  { code: "4px", name: "递四方", country: "CN", website: "https://www.4px.com" },
  { code: "cne", name: "CNE", country: "CN", website: "https://www.cne.com" },
];

