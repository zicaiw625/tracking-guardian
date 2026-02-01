export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
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
  consentStrategy?: string;
}

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskItem {
  id: string;
  name: string;
  nameKey?: string;
  nameParams?: Record<string, any>;
  description: string;
  descriptionKey?: string;
  descriptionParams?: Record<string, any>;
  severity: RiskSeverity;
  points: number;
  details?: string;
  detailsKey?: string;
  detailsParams?: Record<string, any>;
  platform?: string;
  impact?: string;
  impactKey?: string;
  impactParams?: Record<string, any>;
  recommendation?: string;
  recommendationKey?: string;
  recommendationParams?: Record<string, any>;
}

export interface ScanResult {
  scriptTags: ScriptTag[];
  checkoutConfig: CheckoutConfig | null;
  identifiedPlatforms: string[];
  additionalScriptsPatterns: Array<{ platform: string; content: string }>;
  riskItems: RiskItem[];
  riskScore: number;
}

export interface ScriptTag {
  id: number;
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
