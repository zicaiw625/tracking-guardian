

export type Platform = "google" | "meta" | "tiktok" | "bing" | "clarity";

export const PLATFORM_NAMES: Record<Platform | string, string> = {
  google: "Google Ads / GA4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  bing: "Microsoft Ads",
  clarity: "Microsoft Clarity",
};

export interface GoogleCredentials {
  
  measurementId: string;
  
  apiSecret: string;
}

export interface MetaCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

export interface TikTokCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

export interface BingCredentials {
  tagId: string;
  customerId?: string;
}

export interface ClarityCredentials {
  projectId: string;
}

export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials
  | BingCredentials
  | ClarityCredentials;

export interface LineItem {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
  price: number;
}

/**
 * P0-01: ConversionData for CAPI transmission
 * 
 * IMPORTANT: PII fields may be null/undefined due to:
 * 1. Protected Customer Data scope not granted
 * 2. Data already redacted by Shopify
 * 3. Customer did not provide the information
 * 
 * Platform services MUST handle null PII gracefully:
 * - Still send the conversion with available data
 * - Log when PII is unavailable (for debugging, not as an error)
 * - Never crash or fail the conversion due to missing PII
 */
export interface ConversionData {
  /** Required: Shopify order ID (always available) */
  orderId: string;
  /** Optional: Order display number */
  orderNumber: string | null;
  /** Required: Order value (always available) */
  value: number;
  /** Required: Currency code (always available) */
  currency: string;

  // P0-01: PII fields - all optional
  // These may be null if Protected Customer Data scope is not granted
  // or if customer data is redacted
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zip?: string | null;
  
  lineItems?: LineItem[];
}

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskItem {
  id: string;
  name: string;
  description: string;
  severity: RiskSeverity;
  points: number;
  details?: string;
  platform?: string;
}

export interface ScanResult {
  scriptTags: ScriptTag[];
  additionalScripts: string | object | null;
  checkoutConfig: CheckoutConfig | null;
  identifiedPlatforms: string[];
  riskItems: RiskItem[];
  riskScore: number;
}

export interface ScriptTag {
  id: number;
  src: string;
  event?: string;
  created_at?: string;
  updated_at?: string;
  display_scope?: string;
}

export interface CheckoutConfig {
  checkoutApiSupported?: boolean;
  features?: {
    storefront?: boolean;
  };
}

export type AlertChannel = "email" | "slack" | "telegram";

export interface EmailAlertSettings {
  email: string;
}

export interface SlackAlertSettings {
  webhookUrl: string;
}

export interface TelegramAlertSettings {
  botToken: string;
  chatId: string;
}

export type AlertSettings =
  | EmailAlertSettings
  | SlackAlertSettings
  | TelegramAlertSettings;

export interface AlertConfig {
  id: string;
  channel: AlertChannel;
  settings: AlertSettings;
  discrepancyThreshold: number;
  minOrdersForAlert: number;
  isEnabled: boolean;
}

export interface AlertData {
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  platformConversions: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
  shopDomain: string;
}

export interface ReconciliationResult {
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  shopifyRevenue: number;
  platformConversions: number;
  platformRevenue: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
}

export interface ReconciliationSummary {
  totalShopifyOrders: number;
  totalPlatformConversions: number;
  avgDiscrepancy: number;
  reports: ReconciliationReportData[];
}

export interface ReconciliationReportData {
  id: string;
  platform: string;
  reportDate: Date;
  shopifyOrders: number;
  shopifyRevenue: number;
  platformConversions: number;
  platformRevenue: number;
  orderDiscrepancy: number;
  revenueDiscrepancy: number;
  alertSent: boolean;
}

export interface MigrationConfig {
  platform: Platform;
  platformId: string;
  additionalConfig?: Record<string, string>;
}

export interface MigrationResult {
  success: boolean;
  platform: Platform;
  pixelCode: string;
  instructions: string[];
  error?: string;
}

export interface PixelConfigData {
  id: string;
  platform: string;
  platformId: string | null;
  
  clientConfig: Record<string, unknown> | null;
  
  credentialsEncrypted: string | null;
  
  credentials?: unknown;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  eventMappings: Record<string, string> | null;
  migrationStatus: string;
  migratedAt: Date | null;
  isActive: boolean;
  updatedAt?: Date;
  lastVerifiedAt?: Date;
}

export interface ShopData {
  id: string;
  shopDomain: string;
  accessToken: string | null;
  email: string | null;
  name: string | null;
  plan: string;
  monthlyOrderLimit: number;
  isActive: boolean;
  piiEnabled?: boolean;
  weakConsentMode?: boolean; 
  consentStrategy?: string; 
}

/**
 * P2-1: MinimalOrderPayload - Data-minimized order structure for CAPI transmission
 * 
 * This type represents the minimum data needed for conversion tracking:
 * - Order identification (id, order_number)
 * - Order value and currency (for attribution)
 * - Line items (for product-level attribution)
 * - Checkout token (for pixel event matching)
 * 
 * IMPORTANT: This type intentionally EXCLUDES PII fields (email, phone, etc.)
 * to enforce data minimization. The application should never store or transmit
 * customer PII unless explicitly enabled and properly consented.
 * 
 * Use this type for:
 * - ConversionJob.capiInput JSON structure
 * - Conversion platform API payloads
 * - Any data that leaves the system
 * 
 * Use OrderWebhookPayload for:
 * - Receiving raw Shopify webhook payloads
 * - Temporary processing before data minimization
 */
export interface MinimalOrderPayload {
  /** Shopify order ID (always available) */
  id: number;
  /** Order display number */
  order_number?: number | null;
  /** Order total value */
  total_price?: string | null;
  /** Currency code (ISO 4217) */
  currency?: string | null;
  /** Checkout token for pixel event matching */
  checkout_token?: string | null;
  /** Order timestamp */
  processed_at?: string | null;
  /** Line items for product-level attribution */
  line_items?: Array<{
    product_id?: number;
    variant_id?: number;
    sku?: string;
    title?: string;
    name?: string;
    quantity?: number;
    price?: string;
  }> | null;
}

/**
 * OrderWebhookPayload - Full Shopify webhook payload structure
 * 
 * This type represents the complete order data from Shopify webhooks,
 * including PII fields that may or may not be present depending on:
 * - Protected Customer Data scope approval
 * - Data redaction status
 * - Customer consent
 * 
 * WARNING: Do not store or transmit this data directly. Extract only
 * the necessary fields into MinimalOrderPayload for CAPI transmission.
 * 
 * @see MinimalOrderPayload for the data-minimized version
 */
export interface OrderWebhookPayload {
  id: number;
  order_number?: number | null;
  total_price?: string | null;
  currency?: string | null;
  
  checkout_token?: string | null;
  
  total_tax?: string | null;
  total_shipping_price_set?: {
    shop_money?: {
      amount?: string | null;
      currency_code?: string | null;
    } | null;
  } | null;
  processed_at?: string | null;
  
  // PII fields - may be null/redacted, should NOT be stored or transmitted
  // See MinimalOrderPayload for data-minimized version
  email?: string | null;
  phone?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: {
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    city?: string | null;
    province?: string | null;
    country_code?: string | null;
    zip?: string | null;
  } | null;
  line_items?: Array<{
    product_id?: number;
    variant_id?: number;
    sku?: string;
    title?: string;
    name?: string;
    quantity?: number;
    price?: string;
  }> | null;
}

/**
 * P2-1: Helper function to convert OrderWebhookPayload to MinimalOrderPayload
 * 
 * Use this function to extract only the necessary data from a full webhook payload
 * before storing in ConversionJob.capiInput or transmitting to ad platforms.
 */
export function toMinimalOrderPayload(order: OrderWebhookPayload): MinimalOrderPayload {
  return {
    id: order.id,
    order_number: order.order_number,
    total_price: order.total_price,
    currency: order.currency,
    checkout_token: order.checkout_token,
    processed_at: order.processed_at,
    line_items: order.line_items,
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ConversionApiResponse {
  success: boolean;
  conversionId?: string;
  timestamp?: string;
  events_received?: number;
  fbtrace_id?: string;
}

export type ConversionStatus = 
  | "pending"           
  | "pending_consent"   
  | "sent"              
  | "failed"            
  | "retrying"          
  | "limit_exceeded"    
  | "dead_letter";      

export interface ConversionLogData {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  orderValue: number;
  currency: string;
  platform: string;
  eventType: string;
  status: ConversionStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  errorMessage: string | null;
  platformResponse: unknown;
  clientSideSent: boolean;
  serverSideSent: boolean;
  createdAt: Date;
  sentAt: Date | null;
}

export interface SurveyResponseData {
  orderId: string;
  orderNumber?: string;
  rating?: number;
  feedback?: string;
  source?: string;
  customAnswers?: Record<string, unknown>;
}
