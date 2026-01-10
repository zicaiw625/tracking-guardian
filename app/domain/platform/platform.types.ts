export type Platform = "google" | "meta" | "tiktok";

export const PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  google: "GA4 (Measurement Protocol)",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export const PLATFORMS: readonly Platform[] = ["google", "meta", "tiktok"];

export interface GoogleCredentials {
  measurementId: string;
  apiSecret: string;
}

export interface MetaCredentials {
  pixelId: string;
  accessToken: string;
}

export interface TikTokCredentials {
  pixelCode: string;
  accessToken: string;
}

export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials;

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

export interface ConversionLineItem {
  productId: string;
  variantId?: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ConversionData {
  orderId: string;
  orderNumber?: string | null;
  value: number;
  currency: string;
  lineItems?: ConversionLineItem[];
}

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

export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  isRetryable: boolean;
  platformCode?: string;
  platformMessage?: string;
  traceId?: string;
  retryAfter?: number;
}

export interface ConversionApiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  [key: string]: unknown;
}

export interface PlatformSendResult {
  success: boolean;
  response?: ConversionApiResponse;
  error?: PlatformError;
  duration?: number;
}

export interface PixelConfig {
  id: string;
  shopId: string;
  platform: Platform;
  platformId: string | null;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  eventMappings: Record<string, string> | null;
  clientConfig: PixelClientConfig | null;
  isActive: boolean;
  migrationStatus: "not_started" | "in_progress" | "completed";
  migratedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PixelClientConfig {
  treatAsMarketing?: boolean;
  eventMappings?: Record<string, string>;
  [key: string]: unknown;
}

export interface PixelConfigWithCredentials extends PixelConfig {
  credentials: PlatformCredentials;
}

export function isValidPlatform(value: unknown): value is Platform {
  return value === "google" || value === "meta" || value === "tiktok";
}

export function isGoogleCredentials(creds: PlatformCredentials): creds is GoogleCredentials {
  return "measurementId" in creds && "apiSecret" in creds;
}

export function isMetaCredentials(creds: PlatformCredentials): creds is MetaCredentials {
  return "pixelId" in creds && "accessToken" in creds && !("pixelCode" in creds);
}

export function isTikTokCredentials(creds: PlatformCredentials): creds is TikTokCredentials {
  return "pixelCode" in creds && "accessToken" in creds;
}

export function isRetryableError(error: PlatformError): boolean {
  return error.isRetryable;
}

export function isRetryableErrorType(type: PlatformErrorType): boolean {
  return (
    type === "rate_limited" ||
    type === "server_error" ||
    type === "timeout" ||
    type === "network_error"
  );
}
