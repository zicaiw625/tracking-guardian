/**
 * Platform Domain Types
 *
 * Defines platform-agnostic types for ad platform integrations.
 */

// =============================================================================
// Platform Identification
// =============================================================================

/**
 * Supported ad platforms
 */
export type Platform = "google" | "meta" | "tiktok";

/**
 * Platform display names
 */
export const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  google: "GA4 (Measurement Protocol)",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

/**
 * All valid platform IDs
 */
export const PLATFORMS: readonly Platform[] = ["google", "meta", "tiktok"];

// =============================================================================
// Credentials
// =============================================================================

/**
 * Google Analytics 4 credentials
 */
export interface GoogleCredentials {
  measurementId: string;
  apiSecret: string;
}

/**
 * Meta (Facebook) CAPI credentials
 */
export interface MetaCredentials {
  pixelId: string;
  accessToken: string;
}

/**
 * TikTok Events API credentials
 */
export interface TikTokCredentials {
  pixelCode: string;
  accessToken: string;
}

/**
 * Union type for all platform credentials
 */
export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials;

/**
 * Typed credentials with discriminant
 */
export interface TypedGoogleCredentials extends GoogleCredentials {
  platform: "google";
}

export interface TypedMetaCredentials extends MetaCredentials {
  platform: "meta";
}

export interface TypedTikTokCredentials extends TikTokCredentials {
  platform: "tiktok";
}

export type TypedPlatformCredentials =
  | TypedGoogleCredentials
  | TypedMetaCredentials
  | TypedTikTokCredentials;

// =============================================================================
// Conversion Data
// =============================================================================

/**
 * Line item in a conversion
 */
export interface ConversionLineItem {
  productId: string;
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
}

/**
 * Data required to send a conversion to a platform
 */
export interface ConversionData {
  orderId: string;
  orderNumber?: string | null;
  value: number;
  currency: string;
  lineItems?: ConversionLineItem[];
  
  // Optional PII (should be hashed before sending)
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  
  // Client data
  clientIp?: string;
  userAgent?: string;
}

// =============================================================================
// Platform Response
// =============================================================================

/**
 * Platform error types
 */
export type PlatformErrorType =
  | "auth_error"
  | "validation_error"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "invalid_config"
  | "quota_exceeded"
  | "unknown";

/**
 * Platform error structure
 */
export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  isRetryable: boolean;
  platformCode?: string;
  platformMessage?: string;
  traceId?: string;
  retryAfter?: number;
}

/**
 * API response from platform
 */
export interface ConversionApiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  [key: string]: unknown;
}

/**
 * Result of sending a conversion
 */
export interface PlatformSendResult {
  success: boolean;
  response?: ConversionApiResponse;
  error?: PlatformError;
  duration?: number;
}

// =============================================================================
// Pixel Configuration
// =============================================================================

/**
 * Pixel configuration for a platform
 */
export interface PixelConfig {
  id: string;
  shopId: string;
  platform: Platform;
  platformId: string | null;
  
  // Configuration
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  eventMappings: Record<string, string> | null;
  
  // Client-side config (non-sensitive)
  clientConfig: PixelClientConfig | null;
  
  // Status
  isActive: boolean;
  migrationStatus: "not_started" | "in_progress" | "completed";
  migratedAt: Date | null;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Client-side pixel configuration
 */
export interface PixelClientConfig {
  /** Treat events as marketing (subject to consent) */
  treatAsMarketing?: boolean;
  /** Custom event mappings */
  eventMappings?: Record<string, string>;
  /** Additional options */
  [key: string]: unknown;
}

/**
 * Pixel config with decrypted credentials
 */
export interface PixelConfigWithCredentials extends PixelConfig {
  credentials: PlatformCredentials;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is a valid platform
 */
export function isValidPlatform(value: unknown): value is Platform {
  return value === "google" || value === "meta" || value === "tiktok";
}

/**
 * Check if credentials are Google credentials
 */
export function isGoogleCredentials(creds: PlatformCredentials): creds is GoogleCredentials {
  return "measurementId" in creds && "apiSecret" in creds;
}

/**
 * Check if credentials are Meta credentials
 */
export function isMetaCredentials(creds: PlatformCredentials): creds is MetaCredentials {
  return "pixelId" in creds && "accessToken" in creds && !("pixelCode" in creds);
}

/**
 * Check if credentials are TikTok credentials
 */
export function isTikTokCredentials(creds: PlatformCredentials): creds is TikTokCredentials {
  return "pixelCode" in creds && "accessToken" in creds;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: PlatformError): boolean {
  return error.isRetryable;
}

/**
 * Check if error type is retryable by default
 */
export function isRetryableErrorType(type: PlatformErrorType): boolean {
  return (
    type === "rate_limited" ||
    type === "server_error" ||
    type === "timeout" ||
    type === "network_error"
  );
}

