/**
 * Webhook-Related Type Definitions
 * 
 * Types for Shopify webhooks, order payloads, and API responses.
 */

// =============================================================================
// Order Webhook Payload
// =============================================================================

/**
 * Full order payload from Shopify webhooks.
 * Contains PII fields that should be handled with care.
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
 * Minimal order payload without PII.
 * Used for logging and non-sensitive operations.
 */
export interface MinimalOrderPayload {
  id: number;
  order_number?: number | null;
  total_price?: string | null;
  currency?: string | null;
  checkout_token?: string | null;
  processed_at?: string | null;
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
 * Convert full order payload to minimal (PII-free) version.
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

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Standard API response wrapper.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// =============================================================================
// Survey Response
// =============================================================================

/**
 * Post-purchase survey response data.
 */
export interface SurveyResponseData {
  orderId?: string;
  orderNumber?: string;
  checkoutToken?: string;
  rating?: number;
  feedback?: string;
  source?: string;
  customAnswers?: Record<string, unknown>;
}

// =============================================================================
// Shop Data
// =============================================================================

/**
 * Shop data structure for internal use.
 */
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

// =============================================================================
// Scan and Risk Assessment
// =============================================================================

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskItem {
  id: string;
  name: string;
  description: string;
  severity: RiskSeverity;
  points: number;
  details?: string;
  platform?: string;
  impact?: string;
}

export interface ScanResult {
  scriptTags: ScriptTag[];
  checkoutConfig: CheckoutConfig | null;
  identifiedPlatforms: string[];
  riskItems: RiskItem[];
  riskScore: number;
}

export interface ScriptTag {
  /** Numeric ID for display purposes */
  id: number;
  /** Original GraphQL global ID (gid://shopify/ScriptTag/123) for mutations */
  gid?: string;
  src: string;
  event?: string;
  created_at?: string;
  updated_at?: string;
  display_scope?: string;
  cache?: boolean;
}

export interface CheckoutConfig {
  checkoutApiSupported?: boolean;
  features?: {
    storefront?: boolean;
  };
}

// =============================================================================
// Alert Configuration
// =============================================================================

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

// =============================================================================
// Reconciliation
// =============================================================================

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

