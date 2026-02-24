import { z } from "zod";
import { logger } from "../utils/logger.server";

export const AlertEmailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const AlertSlackSchema = z.object({
  webhookUrl: z
    .string()
    .url("Please enter a valid URL")
    .startsWith("https://"),
});

export const AlertTelegramSchema = z.object({
  botToken: z
    .string()
    .min(30, "Invalid Bot Token format")
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "Invalid Bot Token format"),
  chatId: z
    .string()
    .regex(/^-?\d+$/, "Chat ID must be numeric"),
});

export const AlertChannelSchema = z.enum(["email", "slack", "telegram"]);
export type AlertChannel = z.infer<typeof AlertChannelSchema>;

export const AlertConfigSchema = z.object({
  channel: AlertChannelSchema,
  threshold: z.number().min(0).max(100),
  enabled: z.boolean(),
  configId: z.string().optional(),
  email: z.string().email().optional(),
  webhookUrl: z.string().url().optional(),
  botToken: z.string().optional(),
  chatId: z.string().optional(),
});

export type AlertConfig = z.infer<typeof AlertConfigSchema>;

export function validateAlertSettings(
  channel: AlertChannel,
  data: Record<string, unknown>
) {
  switch (channel) {
    case "email":
      return AlertEmailSchema.safeParse(data);
    case "slack":
      return AlertSlackSchema.safeParse(data);
    case "telegram":
      return AlertTelegramSchema.safeParse(data);
    default:
      return {
        success: false as const,
        error: {
          issues: [{ code: "custom", message: "Invalid channel", path: ["channel"] }]
        }
      };
  }
}

export const MetaCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(15, "Pixel ID must be at least 15 characters")
    .max(20, "Pixel ID must be at most 20 characters")
    .regex(/^\d+$/, "Pixel ID must contain digits only"),
  accessToken: z
    .string()
    .min(100, "Invalid Access Token length")
    .max(500, "Invalid Access Token length"),
  testEventCode: z.string().max(20).optional(),
});

export type MetaCredentialsInput = z.infer<typeof MetaCredentialsSchema>;

export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .regex(/^G-[A-Z0-9]+$/i, "Format must be G-XXXXXXXXXX"),
  apiSecret: z
    .string()
    .min(20, "Invalid API Secret length")
    .max(50, "Invalid API Secret length"),
});

export type GoogleCredentialsInput = z.infer<typeof GoogleCredentialsSchema>;

export const TikTokCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(10, "Invalid Pixel ID length")
    .max(30, "Invalid Pixel ID length"),
  accessToken: z
    .string()
    .min(50, "Invalid Access Token length")
    .max(200, "Invalid Access Token length"),
});

export type TikTokCredentialsInput = z.infer<typeof TikTokCredentialsSchema>;

export const PlatformSchema = z.enum(["meta", "google", "tiktok"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const ServerSideConfigSchema = z.object({
  platform: PlatformSchema,
  enabled: z.boolean(),
});

export function validatePlatformCredentials(
  platform: Platform,
  data: Record<string, unknown>
) {
  switch (platform) {
    case "meta":
      return MetaCredentialsSchema.safeParse(data);
    case "google":
      return GoogleCredentialsSchema.safeParse(data);
    case "tiktok":
      return TikTokCredentialsSchema.safeParse(data);
    default:
      return {
        success: false as const,
        error: {
          issues: [{ code: "custom", message: "Invalid platform", path: ["platform"] }]
        }
      };
  }
}

export const ConsentStrategySchema = z.enum(["strict", "balanced"]);
export type ConsentStrategy = z.infer<typeof ConsentStrategySchema>;

export const DataRetentionDaysSchema = z
  .number()
  .int()
  .min(30)
  .max(365)
  .refine(
    (val) => [30, 60, 90, 180, 365].includes(val),
    "Data retention days must be one of 30, 60, 90, 180, or 365"
  );

export const PrivacySettingsSchema = z.object({
  consentStrategy: ConsentStrategySchema,
  dataRetentionDays: DataRetentionDaysSchema,
});

export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

export const PixelConfigSchemaV1 = z.object({
  schema_version: z.literal("1"),
  mode: z.enum(["purchase_only", "full_funnel"]),
  enabled_platforms: z.string().default("meta,tiktok,google"),
  strictness: z.enum(["strict", "balanced"]),
});

export type PixelConfigV1 = z.infer<typeof PixelConfigSchemaV1>;

export const DEFAULT_PIXEL_CONFIG: PixelConfigV1 = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

export const WebPixelSettingsSchema = z.object({
  ingestion_key: z.string().min(1, "Ingestion key is required"),
  shop_domain: z.string().min(1, "Shop domain is required"),
  config_version: z.string().optional(),
  mode: z.enum(["purchase_only", "full_funnel"]).optional().default("purchase_only"),
  pixel_config: z.string().optional(),
  environment: z.enum(["test", "live"]).optional().default("live"),
});

export type WebPixelSettings = z.infer<typeof WebPixelSettingsSchema>;

export function parseAndValidatePixelConfig(configStr?: string): PixelConfigV1 {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }
  try {
    const parsed = JSON.parse(configStr);
    const result = PixelConfigSchemaV1.safeParse(parsed);
    if (!result.success) {
      logger.warn("[PixelConfig] Validation failed, using defaults", { issues: result.error.issues });
      return DEFAULT_PIXEL_CONFIG;
    }
    return result.data;
  } catch (e) {
    logger.warn("[PixelConfig] JSON parse failed, using defaults", { error: e });
    return DEFAULT_PIXEL_CONFIG;
  }
}

export function buildPixelConfigString(config: Partial<PixelConfigV1>): string {
  const fullConfig: PixelConfigV1 = {
    ...DEFAULT_PIXEL_CONFIG,
    ...config,
    schema_version: "1",
  };
  return JSON.stringify(fullConfig);
}

export function validateWebPixelSettings(settings: unknown):
  | { ok: true; data: WebPixelSettings }
  | { ok: false; errors: Record<string, string> } {
  const result = WebPixelSettingsSchema.safeParse(settings);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: extractZodErrors(result.error) };
}

export function parseFormDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value === "true") {
      result[key] = true;
    } else if (value === "false") {
      result[key] = false;
    } else if (!isNaN(Number(value)) && value !== "") {
      result[key] = Number(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function extractZodErrors(
  error: z.ZodError<unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};
  const issues = error.issues;
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!errors[path]) {
      errors[path] = issue.message;
    }
  }
  return errors;
}
