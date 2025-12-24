/**
 * Platform-Related Type Definitions
 *
 * Types for advertising platforms, credentials, and conversion data.
 * Uses Discriminated Unions for type-safe platform handling.
 */

import { z } from "zod";
import { Platform, type PlatformType } from "./enums";

// =============================================================================
// Platform Types (Discriminated Union)
// =============================================================================

/**
 * Supported platforms for server-side conversion tracking (CAPI).
 *
 * P0-4: bing and clarity removed - no server-side API implementation.
 * - Bing: Use Microsoft's official Shopify app instead
 * - Clarity: Client-side only tool, not suitable for CAPI
 */
export type { PlatformType as Platform };

export const PLATFORM_NAMES: Record<Platform, string> = {
  [Platform.GOOGLE]: "GA4 (Measurement Protocol)",
  [Platform.META]: "Meta (Facebook)",
  [Platform.TIKTOK]: "TikTok",
  [Platform.PINTEREST]: "Pinterest",
  [Platform.SNAPCHAT]: "Snapchat",
  [Platform.TWITTER]: "X (Twitter)",
  [Platform.MICROSOFT]: "Microsoft Ads",
  [Platform.CLARITY]: "Microsoft Clarity",
  [Platform.UNKNOWN]: "Unknown",
};

// =============================================================================
// Platform Credentials
// =============================================================================

/**
 * Google Analytics credentials
 */
export interface GoogleCredentials {
  measurementId: string;
  apiSecret: string;
}

/**
 * Meta (Facebook) credentials
 */
export interface MetaCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

/**
 * TikTok credentials
 */
export interface TikTokCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

/**
 * Union of all platform credentials.
 */
export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials;

// =============================================================================
// Discriminated Union Credentials (for type-safe handling)
// =============================================================================

/**
 * Google credentials with discriminant
 */
export interface GoogleCredentialsTyped extends GoogleCredentials {
  readonly platform: "google";
}

/**
 * Meta credentials with discriminant
 */
export interface MetaCredentialsTyped extends MetaCredentials {
  readonly platform: "meta";
}

/**
 * TikTok credentials with discriminant
 */
export interface TikTokCredentialsTyped extends TikTokCredentials {
  readonly platform: "tiktok";
}

/**
 * Discriminated union of all platform credentials.
 * The 'platform' field acts as the discriminant.
 *
 * @example
 * ```typescript
 * function handleCredentials(creds: TypedPlatformCredentials) {
 *   switch (creds.platform) {
 *     case "google":
 *       console.log(creds.measurementId); // TypeScript knows this exists
 *       break;
 *     case "meta":
 *       console.log(creds.pixelId); // TypeScript knows this exists
 *       break;
 *     case "tiktok":
 *       console.log(creds.accessToken); // TypeScript knows this exists
 *       break;
 *   }
 * }
 * ```
 */
export type TypedPlatformCredentials =
  | GoogleCredentialsTyped
  | MetaCredentialsTyped
  | TikTokCredentialsTyped;

// =============================================================================
// Zod Schemas for Runtime Validation
// =============================================================================

/**
 * Google credentials schema (without platform discriminant)
 */
export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .min(1, "Measurement ID is required")
    .regex(/^G-[A-Z0-9]+$/i, "Invalid Measurement ID format (should be G-XXXXXXXX)"),
  apiSecret: z.string().min(1, "API Secret is required"),
});

/**
 * Meta credentials schema (without platform discriminant)
 */
export const MetaCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(1, "Pixel ID is required")
    .regex(/^\d+$/, "Pixel ID should be numeric"),
  accessToken: z.string().min(1, "Access Token is required"),
  testEventCode: z.string().optional(),
});

/**
 * TikTok credentials schema (without platform discriminant)
 */
export const TikTokCredentialsSchema = z.object({
  pixelId: z.string().min(1, "Pixel ID is required"),
  accessToken: z.string().min(1, "Access Token is required"),
  testEventCode: z.string().optional(),
});

/**
 * Typed Google credentials schema with discriminant
 */
export const GoogleCredentialsTypedSchema = GoogleCredentialsSchema.extend({
  platform: z.literal("google"),
});

/**
 * Typed Meta credentials schema with discriminant
 */
export const MetaCredentialsTypedSchema = MetaCredentialsSchema.extend({
  platform: z.literal("meta"),
});

/**
 * Typed TikTok credentials schema with discriminant
 */
export const TikTokCredentialsTypedSchema = TikTokCredentialsSchema.extend({
  platform: z.literal("tiktok"),
});

/**
 * Combined typed credentials schema using discriminated union
 */
export const PlatformCredentialsSchema = z.discriminatedUnion("platform", [
  GoogleCredentialsTypedSchema,
  MetaCredentialsTypedSchema,
  TikTokCredentialsTypedSchema,
]);

// =============================================================================
// Type Guards (structure-based detection)
// =============================================================================

/**
 * Check if credentials are Google credentials (has measurementId)
 */
export function isGoogleCredentials(
  creds: PlatformCredentials
): creds is GoogleCredentials {
  return (
    "measurementId" in creds &&
    "apiSecret" in creds &&
    typeof (creds as GoogleCredentials).measurementId === "string" &&
    typeof (creds as GoogleCredentials).apiSecret === "string"
  );
}

/**
 * Check if credentials are Meta credentials (has pixelId but no measurementId)
 */
export function isMetaCredentials(
  creds: PlatformCredentials
): creds is MetaCredentials {
  return (
    "pixelId" in creds &&
    "accessToken" in creds &&
    !("measurementId" in creds) &&
    typeof (creds as MetaCredentials).pixelId === "string" &&
    typeof (creds as MetaCredentials).accessToken === "string"
  );
}

/**
 * Check if credentials are TikTok credentials
 * Note: TikTok and Meta have same structure, use platform context to distinguish
 */
export function isTikTokCredentials(
  creds: PlatformCredentials
): creds is TikTokCredentials {
  return (
    "pixelId" in creds &&
    "accessToken" in creds &&
    typeof (creds as TikTokCredentials).pixelId === "string" &&
    typeof (creds as TikTokCredentials).accessToken === "string"
  );
}

/**
 * Check if typed credentials are for a specific platform
 */
export function isTypedGoogleCredentials(
  creds: TypedPlatformCredentials
): creds is GoogleCredentialsTyped {
  return creds.platform === Platform.GOOGLE;
}

export function isTypedMetaCredentials(
  creds: TypedPlatformCredentials
): creds is MetaCredentialsTyped {
  return creds.platform === Platform.META;
}

export function isTypedTikTokCredentials(
  creds: TypedPlatformCredentials
): creds is TikTokCredentialsTyped {
  return creds.platform === Platform.TIKTOK;
}

// =============================================================================
// Credential Utilities
// =============================================================================

/**
 * Add platform discriminant to credentials.
 */
export function upgradeCredentials(
  platform: PlatformType,
  creds: PlatformCredentials
): TypedPlatformCredentials {
  switch (platform) {
    case Platform.GOOGLE:
      return {
        platform: "google",
        ...(creds as GoogleCredentials),
      };
    case Platform.META:
      return {
        platform: "meta",
        ...(creds as MetaCredentials),
      };
    case Platform.TIKTOK:
      return {
        platform: "tiktok",
        ...(creds as TikTokCredentials),
      };
    default: {
      // Exhaustiveness check
      const _exhaustiveCheck: never = platform;
      throw new Error(`Unknown platform: ${_exhaustiveCheck}`);
    }
  }
}

/**
 * Validate and parse typed credentials with Zod
 */
export function validateCredentials(
  input: unknown
): { success: true; data: TypedPlatformCredentials } | { success: false; errors: string[] } {
  const result = PlatformCredentialsSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}

/**
 * Validate credentials for a specific platform
 */
export function validatePlatformCredentials(
  platform: PlatformType,
  input: unknown
): { success: true; data: PlatformCredentials } | { success: false; errors: string[] } {
  let result;
  switch (platform) {
    case Platform.GOOGLE:
      result = GoogleCredentialsSchema.safeParse(input);
      break;
    case Platform.META:
      result = MetaCredentialsSchema.safeParse(input);
      break;
    case Platform.TIKTOK:
      result = TikTokCredentialsSchema.safeParse(input);
      break;
    default: {
      const _exhaustiveCheck: never = platform;
      return { success: false, errors: [`Unknown platform: ${_exhaustiveCheck}`] };
    }
  }

  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}

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

export const LineItemSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative(),
});

/**
 * P1-2: 预哈希的 PII 数据
 * 
 * 这些字段已经是 SHA256 哈希值，平台 service 可以直接使用。
 * 命名遵循 Meta CAPI 的规范。
 */
export interface PreHashedUserData {
  em?: string;  // hashed email
  ph?: string;  // hashed phone
  fn?: string;  // hashed first name
  ln?: string;  // hashed last name
  ct?: string;  // hashed city
  st?: string;  // hashed state
  country?: string;  // hashed country
  zp?: string;  // hashed zip
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
  // P1-2: 预哈希的 PII 数据（可选）
  // 如果存在，平台 service 应优先使用这些数据，避免重复哈希
  preHashedUserData?: PreHashedUserData | null;
}

export const ConversionDataSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().nullable(),
  value: z.number().nonnegative(),
  currency: z.string().length(3),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  lineItems: z.array(LineItemSchema).optional(),
});

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

/**
 * Categories of platform API errors.
 */
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

/**
 * Standardized platform error format.
 * Used across all platform services for consistent error handling.
 */
export interface PlatformError {
  /** Error category */
  type: PlatformErrorType;
  /** Human-readable error message */
  message: string;
  /** HTTP status code (if applicable) */
  statusCode?: number;
  /** Platform-specific error code */
  platformCode?: string;
  /** Platform-specific error message */
  platformMessage?: string;
  /** Seconds to wait before retry (for rate limiting) */
  retryAfter?: number;
  /** Whether the operation can be retried */
  isRetryable: boolean;
  /** Platform trace ID (e.g., fbtrace_id for Meta) */
  traceId?: string;
  /** Original error object for debugging */
  rawError?: unknown;
}

/**
 * Generic result type for platform operations.
 */
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
  platform: PlatformType;
  platformId: string;
  additionalConfig?: Record<string, string>;
}

export interface MigrationResult {
  success: boolean;
  platform: PlatformType;
  pixelCode: string;
  instructions: string[];
  error?: string;
}

// =============================================================================
// Platform Config with Credentials (Discriminated)
// =============================================================================

/**
 * Google platform configuration with credentials
 */
export interface GooglePlatformConfig {
  platform: "google";
  platformId: string;
  credentials: GoogleCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
    conversionLabels?: string[];
  };
}

/**
 * Meta platform configuration with credentials
 */
export interface MetaPlatformConfig {
  platform: "meta";
  platformId: string;
  credentials: MetaCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
    customDataEnabled?: boolean;
  };
}

/**
 * TikTok platform configuration with credentials
 */
export interface TikTokPlatformConfig {
  platform: "tiktok";
  platformId: string;
  credentials: TikTokCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
  };
}

/**
 * Discriminated union of platform configurations
 */
export type PlatformConfig =
  | GooglePlatformConfig
  | MetaPlatformConfig
  | TikTokPlatformConfig;

/**
 * Extract credentials type from platform config
 */
export type ExtractCredentials<T extends PlatformConfig> = T["credentials"];
