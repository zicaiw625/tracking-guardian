import { z } from "zod";

export const GoogleMeasurementIdSchema = z
  .string()
  .min(1, "Measurement ID is required")
  .regex(
    /^G-[A-Z0-9]{8,12}$/i,
    "Invalid Measurement ID format. Expected format: G-XXXXXXXXXX"
  );

export const GoogleApiSecretSchema = z
  .string()
  .min(1, "API Secret is required")
  .min(20, "API Secret appears too short");

export const GoogleCredentialsInputSchema = z.object({
  measurementId: GoogleMeasurementIdSchema,
  apiSecret: GoogleApiSecretSchema,
});

export type GoogleCredentialsInput = z.infer<typeof GoogleCredentialsInputSchema>;

export const MetaPixelIdSchema = z
  .string()
  .min(1, "Pixel ID is required")
  .regex(/^\d{15,16}$/, "Invalid Pixel ID format. Expected 15-16 digit number");

export const MetaAccessTokenSchema = z
  .string()
  .min(1, "Access Token is required")
  .min(50, "Access Token appears too short");

export const MetaTestEventCodeSchema = z
  .string()
  .regex(/^TEST\d+$/, "Test Event Code format: TEST followed by numbers")
  .optional();

export const MetaCredentialsInputSchema = z.object({
  pixelId: MetaPixelIdSchema,
  accessToken: MetaAccessTokenSchema,
  testEventCode: MetaTestEventCodeSchema,
});

export type MetaCredentialsInput = z.infer<typeof MetaCredentialsInputSchema>;

export const TikTokPixelCodeSchema = z
  .string()
  .min(1, "Pixel Code is required")
  .min(10, "Pixel Code appears too short");

export const TikTokAccessTokenSchema = z
  .string()
  .min(1, "Access Token is required")
  .min(20, "Access Token appears too short");

export const TikTokTestEventCodeSchema = z.string().optional();

export const TikTokCredentialsInputSchema = z.object({
  pixelCode: TikTokPixelCodeSchema,
  accessToken: TikTokAccessTokenSchema,
  testEventCode: TikTokTestEventCodeSchema,
});

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

export const TypedGoogleCredentialsSchema = GoogleCredentialsInputSchema.extend({
  platform: z.literal("google"),
});

export const TypedMetaCredentialsSchema = MetaCredentialsInputSchema.extend({
  platform: z.literal("meta"),
});

export const TypedTikTokCredentialsSchema = TikTokCredentialsInputSchema.extend({
  platform: z.literal("tiktok"),
});

export const TypedPlatformCredentialsSchema = z.discriminatedUnion("platform", [
  TypedGoogleCredentialsSchema,
  TypedMetaCredentialsSchema,
  TypedTikTokCredentialsSchema,
]);

export type TypedGoogleCredentials = z.infer<typeof TypedGoogleCredentialsSchema>;
export type TypedMetaCredentials = z.infer<typeof TypedMetaCredentialsSchema>;
export type TypedTikTokCredentials = z.infer<typeof TypedTikTokCredentialsSchema>;
export type TypedPlatformCredentials = z.infer<typeof TypedPlatformCredentialsSchema>;

export const PlatformTypeSchema = z.enum(["google", "meta", "tiktok"]);
export type PlatformType = z.infer<typeof PlatformTypeSchema>;

export interface CredentialsValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

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

export function isGoogleCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedGoogleCredentials {
  return creds.platform === "google";
}

export function isMetaCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedMetaCredentials {
  return creds.platform === "meta";
}

export function isTikTokCredentialsInput(
  creds: TypedPlatformCredentials
): creds is TypedTikTokCredentials {
  return creds.platform === "tiktok";
}
