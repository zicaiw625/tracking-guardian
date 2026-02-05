import { z } from "zod";
import { Platform, type PlatformType } from "./enums";
import { OrderIdSchema } from "../schemas/pixel-event";

export type { PlatformType as Platform };

export const PLATFORM_NAMES: Record<PlatformType, string> = {
  [Platform.GOOGLE]: "GA4",
  [Platform.META]: "Meta (Facebook)",
  [Platform.TIKTOK]: "TikTok",
  [Platform.PINTEREST]: "Pinterest",
  [Platform.SNAPCHAT]: "Snapchat",
  [Platform.TWITTER]: "Twitter/X",
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

export interface PinterestCredentials {
  adAccountId: string;
  accessToken: string;
  testMode?: boolean;
}

export interface SnapchatCredentials {
  pixelId: string;
  accessToken: string;
  testMode?: boolean;
}

export interface TwitterCredentials {
  pixelId: string;
  accessToken: string;
  testMode?: boolean;
}

export interface WebhookCredentials {
  endpointUrl: string;
  authType: "none" | "bearer" | "basic" | "header";
  authValue?: string;
  customHeaders?: Record<string, string>;
  payloadTemplate?: string;
  timeoutMs?: number;
}

export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials
  | PinterestCredentials
  | SnapchatCredentials
  | TwitterCredentials
  | WebhookCredentials;

export interface GoogleCredentialsTyped extends GoogleCredentials {
  readonly platform: "google";
}

export interface MetaCredentialsTyped extends MetaCredentials {
  readonly platform: "meta";
}

export interface TikTokCredentialsTyped extends TikTokCredentials {
  readonly platform: "tiktok";
}

export interface PinterestCredentialsTyped extends PinterestCredentials {
  readonly platform: "pinterest";
}

export interface SnapchatCredentialsTyped extends SnapchatCredentials {
  readonly platform: "snapchat";
}

export interface TwitterCredentialsTyped extends TwitterCredentials {
  readonly platform: "twitter";
}

export type TypedPlatformCredentials =
  | GoogleCredentialsTyped
  | MetaCredentialsTyped
  | TikTokCredentialsTyped
  | PinterestCredentialsTyped
  | SnapchatCredentialsTyped
  | TwitterCredentialsTyped;

export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .min(1, "Measurement ID is required")
    .regex(/^G-[A-Z0-9]+$/i, "Invalid Measurement ID format (should start with G- followed by alphanumeric characters)"),
  apiSecret: z.string().min(1, "API Secret is required"),
});

export const MetaCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(1, "Pixel ID is required")
    .regex(/^\d+$/, "Pixel ID should be numeric"),
  accessToken: z.string().min(1, "Access Token is required"),
  testEventCode: z.string().optional(),
});

export const TikTokCredentialsSchema = z.object({
  pixelId: z.string().min(1, "Pixel ID is required"),
  accessToken: z.string().min(1, "Access Token is required"),
  testEventCode: z.string().optional(),
});

export const PinterestCredentialsSchema = z.object({
  adAccountId: z
    .string()
    .min(1, "Ad Account ID is required")
    .regex(/^\d+$/, "Ad Account ID should be numeric"),
  accessToken: z.string().min(1, "Access Token is required"),
  testMode: z.boolean().optional(),
});

export const SnapchatCredentialsSchema = z.object({
  pixelId: z.string().min(1, "Snap Pixel ID is required"),
  accessToken: z.string().min(1, "Access Token is required"),
  testMode: z.boolean().optional(),
});

export const TwitterCredentialsSchema = z.object({
  pixelId: z.string().min(1, "Twitter Pixel ID is required"),
  accessToken: z.string().min(1, "OAuth Bearer Token is required"),
  testMode: z.boolean().optional(),
});

export const GoogleCredentialsTypedSchema = GoogleCredentialsSchema.extend({
  platform: z.literal("google"),
});

export const MetaCredentialsTypedSchema = MetaCredentialsSchema.extend({
  platform: z.literal("meta"),
});

export const TikTokCredentialsTypedSchema = TikTokCredentialsSchema.extend({
  platform: z.literal("tiktok"),
});

export const PinterestCredentialsTypedSchema = PinterestCredentialsSchema.extend({
  platform: z.literal("pinterest"),
});

export const SnapchatCredentialsTypedSchema = SnapchatCredentialsSchema.extend({
  platform: z.literal("snapchat"),
});

export const TwitterCredentialsTypedSchema = TwitterCredentialsSchema.extend({
  platform: z.literal("twitter"),
});

export const PlatformCredentialsSchema = z.discriminatedUnion("platform", [
  GoogleCredentialsTypedSchema,
  MetaCredentialsTypedSchema,
  TikTokCredentialsTypedSchema,
  PinterestCredentialsTypedSchema,
  SnapchatCredentialsTypedSchema,
  TwitterCredentialsTypedSchema,
]);

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

export function isTypedPinterestCredentials(
  creds: TypedPlatformCredentials
): creds is PinterestCredentialsTyped {
  return creds.platform === Platform.PINTEREST;
}

export function isTypedSnapchatCredentials(
  creds: TypedPlatformCredentials
): creds is SnapchatCredentialsTyped {
  return creds.platform === Platform.SNAPCHAT;
}

export function isTypedTwitterCredentials(
  creds: TypedPlatformCredentials
): creds is TwitterCredentialsTyped {
  return creds.platform === Platform.TWITTER;
}

export function isPinterestCredentials(
  creds: PlatformCredentials
): creds is PinterestCredentials {
  return (
    "adAccountId" in creds &&
    "accessToken" in creds &&
    typeof (creds as PinterestCredentials).adAccountId === "string" &&
    typeof (creds as PinterestCredentials).accessToken === "string"
  );
}

export function isSnapchatCredentials(
  creds: PlatformCredentials
): creds is SnapchatCredentials {
  return (
    "pixelId" in creds &&
    "accessToken" in creds &&
    typeof (creds as SnapchatCredentials).pixelId === "string" &&
    typeof (creds as SnapchatCredentials).accessToken === "string"
  );
}

export function isTwitterCredentials(
  creds: PlatformCredentials
): creds is TwitterCredentials {
  return (
    "pixelId" in creds &&
    "accessToken" in creds &&
    typeof (creds as TwitterCredentials).pixelId === "string" &&
    typeof (creds as TwitterCredentials).accessToken === "string"
  );
}

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
    case Platform.PINTEREST:
      return {
        platform: "pinterest",
        ...(creds as PinterestCredentials),
      };
    case Platform.SNAPCHAT:
      return {
        platform: "snapchat",
        ...(creds as SnapchatCredentials),
      };
    case Platform.TWITTER:
      return {
        platform: "twitter",
        ...(creds as TwitterCredentials),
      };
    default: {
      const _exhaustiveCheck: never = platform;
      throw new Error(`Unknown platform: ${_exhaustiveCheck}`);
    }
  }
}

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
    case Platform.PINTEREST:
      result = PinterestCredentialsSchema.safeParse(input);
      break;
    case Platform.SNAPCHAT:
      result = SnapchatCredentialsSchema.safeParse(input);
      break;
    case Platform.TWITTER:
      result = TwitterCredentialsSchema.safeParse(input);
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

export interface LineItem {
  id: string;
  quantity: number;
  price: number;
  productId?: string;
  variantId?: string;
  name?: string;
}

export const LineItemSchema = z.object({
  id: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  name: z.string().optional(),
});

export interface ConversionData {
  orderId: string;
  orderNumber: string | null;
  value: number;
  currency: string;
  lineItems?: LineItem[];
}

export const ConversionDataSchema = z.object({
  orderId: OrderIdSchema,
  orderNumber: z.string().nullable(),
  value: z.number().nonnegative(),
  currency: z.string().length(3),
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
  platformCode?: string;
  platformMessage?: string;
  retryAfter?: number;
  isRetryable: boolean;
  traceId?: string;
  rawError?: unknown;
}

export interface PlatformResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PlatformError;
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

export interface GooglePlatformConfig {
  platform: "google";
  platformId: string;
  credentials: GoogleCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
    conversionLabels?: string[];
  };
}

export interface MetaPlatformConfig {
  platform: "meta";
  platformId: string;
  credentials: MetaCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
    customDataEnabled?: boolean;
  };
}

export interface TikTokPlatformConfig {
  platform: "tiktok";
  platformId: string;
  credentials: TikTokCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
  };
}

export interface PinterestPlatformConfig {
  platform: "pinterest";
  platformId: string;
  credentials: PinterestCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
  };
}

export interface SnapchatPlatformConfig {
  platform: "snapchat";
  platformId: string;
  credentials: SnapchatCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
  };
}

export interface TwitterPlatformConfig {
  platform: "twitter";
  platformId: string;
  credentials: TwitterCredentials;
  clientConfig?: {
    treatAsMarketing?: boolean;
  };
}

export type PlatformConfig =
  | GooglePlatformConfig
  | MetaPlatformConfig
  | TikTokPlatformConfig
  | PinterestPlatformConfig
  | SnapchatPlatformConfig
  | TwitterPlatformConfig;

export type ExtractCredentials<T extends PlatformConfig> = T["credentials"];
