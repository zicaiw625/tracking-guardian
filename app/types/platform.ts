

import { z } from "zod";
import { Platform, type PlatformType } from "./enums";

export type { PlatformType as Platform };

export const PLATFORM_NAMES: Record<PlatformType, string> = {
  [Platform.GOOGLE]: "GA4 (Measurement Protocol)",
  [Platform.META]: "Meta (Facebook)",
  [Platform.TIKTOK]: "TikTok",
  [Platform.PINTEREST]: "Pinterest",
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

export type PlatformCredentials =
  | GoogleCredentials
  | MetaCredentials
  | TikTokCredentials
  | PinterestCredentials;

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

export type TypedPlatformCredentials =
  | GoogleCredentialsTyped
  | MetaCredentialsTyped
  | TikTokCredentialsTyped
  | PinterestCredentialsTyped;

export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .min(1, "Measurement ID is required")
    .regex(/^G-[A-Z0-9]+$/i, "Invalid Measurement ID format (should be G-XXXXXXXX)"),
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

export const PlatformCredentialsSchema = z.discriminatedUnion("platform", [
  GoogleCredentialsTypedSchema,
  MetaCredentialsTypedSchema,
  TikTokCredentialsTypedSchema,
  PinterestCredentialsTypedSchema,
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

export interface PreHashedUserData {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  country?: string;
  zp?: string;
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

export type PlatformConfig =
  | GooglePlatformConfig
  | MetaPlatformConfig
  | TikTokPlatformConfig
  | PinterestPlatformConfig;

export type ExtractCredentials<T extends PlatformConfig> = T["credentials"];
