// Shared type definitions for Tracking Guardian

// ==========================================
// Platform Types
// ==========================================

export type Platform = "google" | "meta" | "tiktok" | "bing" | "clarity";

export const PLATFORM_NAMES: Record<Platform | string, string> = {
  google: "Google Ads / GA4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  bing: "Microsoft Ads",
  clarity: "Microsoft Clarity",
};

// ==========================================
// Credential Types (Encrypted Storage)
// ==========================================

/**
 * Google Credentials - GA4 Measurement Protocol
 * 
 * For server-side conversion tracking via GA4 Measurement Protocol.
 * This is the recommended approach because:
 * - Simple setup (no OAuth required)
 * - Works with GA4 properties
 * - Google Ads can import GA4 conversions for attribution
 * 
 * Get these values from GA4 Admin > Data Streams > Your Stream:
 * - measurementId: The Measurement ID (e.g., G-XXXXXXXXXX)
 * - apiSecret: Create via "Measurement Protocol API secrets"
 */
export interface GoogleCredentials {
  /** GA4 Measurement ID (e.g., G-XXXXXXXXXX) */
  measurementId: string;
  /** GA4 Measurement Protocol API Secret */
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

// ==========================================
// Conversion Data Types
// ==========================================

export interface LineItem {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
  price: number;
}

/**
 * Conversion data sent to ad platforms
 * 
 * P0-6: All PII fields are optional and may be null/undefined.
 * When Shopify's Protected Customer Data rules are enforced,
 * these fields may be empty even if piiEnabled is true.
 * Always handle these fields defensively.
 */
export interface ConversionData {
  orderId: string;
  orderNumber: string | null;
  value: number;
  currency: string;
  // P0-6: PII fields - may be null/undefined even when piiEnabled=true
  // due to Shopify's Protected Customer Data enforcement
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

// ==========================================
// Scan Report Types
// ==========================================

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

// ==========================================
// Alert Types
// ==========================================

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

// ==========================================
// Reconciliation Types
// ==========================================

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

// ==========================================
// Migration Types
// ==========================================

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

// ==========================================
// Pixel Config Types
// ==========================================

export interface PixelConfigData {
  id: string;
  platform: string;
  platformId: string | null;
  /** Non-sensitive client configuration (JSON object) */
  clientConfig: Record<string, unknown> | null;
  /** Encrypted credentials string for server-side API */
  credentialsEncrypted: string | null;
  /** @deprecated Use credentialsEncrypted instead */
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

// ==========================================
// Shop Types
// ==========================================

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
  weakConsentMode?: boolean; // P1-3: Weak consent mode (deprecated)
  consentStrategy?: string; // P0-5: "strict" | "balanced" | "weak"
}

// ==========================================
// Order Webhook Payload Types
// ==========================================

/**
 * Order webhook payload from Shopify
 * 
 * P0-6: All fields except 'id' may be null/undefined.
 * When Protected Customer Data access is not granted,
 * PII fields (email, phone, customer, billing_address) will be null.
 * Always use null-coalescing when accessing these fields.
 */
export interface OrderWebhookPayload {
  id: number;
  order_number?: number | null;
  total_price?: string | null;
  currency?: string | null;
  // P0-03: checkout_token for linking to pixel events
  checkout_token?: string | null;
  // P0-05: Additional order value fields for accurate conversion tracking
  total_tax?: string | null;
  total_shipping_price_set?: {
    shop_money?: {
      amount?: string | null;
      currency_code?: string | null;
    } | null;
  } | null;
  processed_at?: string | null;
  // P0-6: PII fields - may be null if Protected Customer Data not granted
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

// ==========================================
// API Response Types
// ==========================================

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

// ==========================================
// Conversion Log Types
// ==========================================

// P0-1 & P0-5: Extended conversion statuses
export type ConversionStatus = 
  | "pending"           // Initial state, waiting to be processed
  | "pending_consent"   // Waiting for consent confirmation
  | "sent"              // Successfully sent to platform
  | "failed"            // Failed, may retry
  | "retrying"          // Scheduled for retry
  | "limit_exceeded"    // Blocked due to billing limit
  | "dead_letter";      // Permanently failed

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

// ==========================================
// Survey Types
// ==========================================

export interface SurveyResponseData {
  orderId: string;
  orderNumber?: string;
  rating?: number;
  feedback?: string;
  source?: string;
  customAnswers?: Record<string, unknown>;
}
