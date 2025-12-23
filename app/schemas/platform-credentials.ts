/**
 * Platform Credentials Validation Schemas
 *
 * Zod schemas for validating platform-specific credentials.
 * Provides type-safe validation with detailed error messages.
 */

import { z } from "zod";

// =============================================================================
// Google Analytics / GA4 Credentials
// =============================================================================

/**
 * Google Analytics Measurement ID format: G-XXXXXXXXXX
 */
export const GoogleMeasurementIdSchema = z
  .string()
  .min(1, "Measurement ID is required")
  .regex(
    /^G-[A-Z0-9]{8,12}$/i,
    "Invalid Measurement ID format. Expected format: G-XXXXXXXXXX"
  );

/**
 * Google Analytics API Secret (32+ character string)
 */
export const GoogleApiSecretSchema = z
  .string()
  .min(1, "API Secret is required")
  .min(20, "API Secret appears too short");

/**
 * Google Analytics credentials schema
 */
export const GoogleCredentialsInputSchema = z.object({
  measurementId: GoogleMeasurementIdSchema,
  apiSecret: GoogleApiSecretSchema,
});

export type GoogleCredentialsInput = z.infer<typeof GoogleCredentialsInputSchema>;

// =============================================================================
// Meta (Facebook) Credentials
// =============================================================================

/**
 * Meta Pixel ID format: 15-16 digit numeric string
 */
export const MetaPixelIdSchema = z
  .string()
  .min(1, "Pixel ID is required")
  .regex(/^\d{15,16}$/, "Invalid Pixel ID format. Expected 15-16 digit number");

/**
 * Meta Access Token (long-lived token, typically 100+ characters)
 */
export const MetaAccessTokenSchema = z
  .string()
  .min(1, "Access Token is required")
  .min(50, "Access Token appears too short");

/**
 * Meta Test Event Code (optional, for testing)
 */
export const MetaTestEventCodeSchema = z
  .string()
  .regex(/^TEST\d+$/, "Test Event Code format: TEST followed by numbers")
  .optional();

/**
 * Meta (Facebook) credentials schema
 */
export const MetaCredentialsInputSchema = z.object({
  pixelId: MetaPixelIdSchema,
  accessToken: MetaAccessTokenSchema,
  testEventCode: MetaTestEventCodeSchema,
});

export type MetaCredentialsInput = z.infer<typeof MetaCredentialsInputSchema>;

// =============================================================================
// TikTok Credentials
// =============================================================================

/**
 * TikTok Pixel Code format: uppercase alphanumeric, 20+ characters
 */
export const TikTokPixelCodeSchema = z
  .string()
  .min(1, "Pixel Code is required")
  .min(10, "Pixel Code appears too short");

/**
 * TikTok Access Token
 */
export const TikTokAccessTokenSchema = z
  .string()
  .min(1, "Access Token is required")
  .min(20, "Access Token appears too short");

/**
 * TikTok Test Event Code (optional)
 */
export const TikTokTestEventCodeSchema = z.string().optional();

/**
 * TikTok credentials schema
 */
export const TikTokCredentialsInputSchema = z.object({
  pixelCode: TikTokPixelCodeSchema,
  accessToken: TikTokAccessTokenSchema,
  testEventCode: TikTokTestEventCodeSchema,
});

// Also support pixelId as alias for pixelCode
export const TikTokCredentialsInputSchemaWithAlias = z.object({
  pixelId: TikTokPixelCodeSchema.optional(),
  pixelCode: TikTokPixelCodeSchema.optional(),
  accessToken: TikTokAccessTokenSchema,
  testEventCode: TikTokTestEventCodeSchema,
}).transform((data) => ({
  pixelCode: data.pixelCode || data.pixelId || "",
  accessToken: data.accessToken,
  testEventCode: data.testEventCode,
}));

export type TikTokCredentialsInput = z.infer<typeof TikTokCredentialsInputSchema>;

// =============================================================================
// Typed Platform Credentials (with discriminant)
// =============================================================================

/**
 * Google credentials with platform discriminant
 */
export const TypedGoogleCredentialsSchema = GoogleCredentialsInputSchema.extend({
  platform: z.literal("google"),
});

/**
 * Meta credentials with platform discriminant
 */
export const TypedMetaCredentialsSchema = MetaCredentialsInputSchema.extend({
  platform: z.literal("meta"),
});

/**
 * TikTok credentials with platform discriminant
 */
export const TypedTikTokCredentialsSchema = TikTokCredentialsInputSchema.extend({
  platform: z.literal("tiktok"),
});

/**
 * Discriminated union of all typed credentials
 */
export const TypedPlatformCredentialsSchema = z.discriminatedUnion("platform", [
  TypedGoogleCredentialsSchema,
  TypedMetaCredentialsSchema,
  TypedTikTokCredentialsSchema,
]);

export type TypedGoogleCredentials = z.infer<typeof TypedGoogleCredentialsSchema>;
export type TypedMetaCredentials = z.infer<typeof TypedMetaCredentialsSchema>;
export type TypedTikTokCredentials = z.infer<typeof TypedTikTokCredentialsSchema>;
export type TypedPlatformCredentials = z.infer<typeof TypedPlatformCredentialsSchema>;

// =============================================================================
// Platform Type Enum
// =============================================================================

export const PlatformTypeSchema = z.enum(["google", "meta", "tiktok"]);
export type PlatformType = z.infer<typeof PlatformTypeSchema>;

// =============================================================================
// Validation Functions
// =============================================================================

export interface CredentialsValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validate Google credentials
 */
export function validateGoogleCredentials(
  input: unknown
): CredentialsValidationResult<GoogleCredentialsInput> {
  const result = GoogleCredentialsInputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/**
 * Validate Meta credentials
 */
export function validateMetaCredentials(
  input: unknown
): CredentialsValidationResult<MetaCredentialsInput> {
  const result = MetaCredentialsInputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/**
 * Validate TikTok credentials
 */
export function validateTikTokCredentials(
  input: unknown
): CredentialsValidationResult<TikTokCredentialsInput> {
  const result = TikTokCredentialsInputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/**
 * Validate credentials for a specific platform
 */
export function validateCredentialsForPlatform(
  platform: PlatformType,
  input: unknown
): CredentialsValidationResult<GoogleCredentialsInput | MetaCredentialsInput | TikTokCredentialsInput> {
  switch (platform) {
    case "google":
      return validateGoogleCredentials(input);
    case "meta":
      return validateMetaCredentials(input);
    case "tiktok":
      return validateTikTokCredentials(input);
    default: {
      const _exhaustive: never = platform;
      return { success: false, errors: [`Unknown platform: ${_exhaustive}`] };
    }
  }
}

/**
 * Validate typed platform credentials
 */
export function validateTypedCredentials(
  input: unknown
): CredentialsValidationResult<TypedPlatformCredentials> {
  const result = TypedPlatformCredentialsSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if credentials are for Google
 */
export function isGoogleCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedGoogleCredentials {
  return creds.platform === "google";
}

/**
 * Check if credentials are for Meta
 */
export function isMetaCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedMetaCredentials {
  return creds.platform === "meta";
}

/**
 * Check if credentials are for TikTok
 */
export function isTikTokCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedTikTokCredentials {
  return creds.platform === "tiktok";
}

