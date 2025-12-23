/**
 * Platform-Related Type Definitions
 * 
 * Types for advertising platforms, credentials, and conversion data.
 */

// =============================================================================
// Platform Types
// =============================================================================

/**
 * Supported platforms for server-side conversion tracking (CAPI).
 * 
 * P0-4: bing and clarity removed - no server-side API implementation.
 * - Bing: Use Microsoft's official Shopify app instead
 * - Clarity: Client-side only tool, not suitable for CAPI
 */
export type Platform = "google" | "meta" | "tiktok";

export const PLATFORM_NAMES: Record<Platform | string, string> = {
  google: "Google Ads / GA4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

// =============================================================================
// Platform Credentials
// =============================================================================

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

/**
 * P0-4: BingCredentials and ClarityCredentials removed.
 * These platforms don't have server-side CAPI implementations.
 */

export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials;

// =============================================================================
// Conversion Data
// =============================================================================

export interface LineItem {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ConversionData {
  orderId: string;
  orderNumber: string | null;
  value: number;
  currency: string;
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

export interface ConversionApiResponse {
  success: boolean;
  conversionId?: string;
  timestamp?: string;
  events_received?: number;
  fbtrace_id?: string;
}

// =============================================================================
// Platform Error Types
// =============================================================================

export type PlatformErrorType =
  | "auth_error"
  | "invalid_config"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "validation_error"
  | "quota_exceeded"
  | "unknown";

export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  statusCode?: number;
  retryAfter?: number;
  isRetryable: boolean;
  rawError?: unknown;
}

export interface PlatformResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PlatformError;
}

// =============================================================================
// Pixel Configuration
// =============================================================================

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

// =============================================================================
// Migration Types
// =============================================================================

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

