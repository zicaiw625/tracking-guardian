/**
 * Settings Schemas
 *
 * Zod validation schemas for settings forms and API requests.
 */

import { z } from "zod";

// =============================================================================
// Alert Settings Schemas
// =============================================================================

/**
 * Email alert settings
 */
export const AlertEmailSchema = z.object({
  email: z.string().email("请输入有效的邮箱地址"),
});

/**
 * Slack alert settings
 */
export const AlertSlackSchema = z.object({
  webhookUrl: z
    .string()
    .url("请输入有效的 URL")
    .startsWith("https://hooks.slack.com/", "请输入有效的 Slack Webhook URL"),
});

/**
 * Telegram alert settings
 */
export const AlertTelegramSchema = z.object({
  botToken: z
    .string()
    .min(30, "Bot Token 格式不正确")
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "Bot Token 格式不正确"),
  chatId: z
    .string()
    .regex(/^-?\d+$/, "Chat ID 应为数字"),
});

/**
 * Alert channel type
 */
export const AlertChannelSchema = z.enum(["email", "slack", "telegram"]);
export type AlertChannel = z.infer<typeof AlertChannelSchema>;

/**
 * Combined alert config schema
 */
export const AlertConfigSchema = z.object({
  channel: AlertChannelSchema,
  threshold: z.number().min(0).max(100),
  enabled: z.boolean(),
  configId: z.string().optional(),
  // Channel-specific fields (conditionally validated)
  email: z.string().email().optional(),
  webhookUrl: z.string().url().optional(),
  botToken: z.string().optional(),
  chatId: z.string().optional(),
});

export type AlertConfig = z.infer<typeof AlertConfigSchema>;

/**
 * Validate alert settings based on channel
 * Returns the result of Zod safeParse
 */
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
      // Return a fake failed result for invalid channel
      return { 
        success: false as const, 
        error: { 
          issues: [{ code: "custom", message: "Invalid channel", path: ["channel"] }] 
        } 
      };
  }
}

// =============================================================================
// Platform Credentials Schemas
// =============================================================================

/**
 * Meta CAPI credentials
 */
export const MetaCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(15, "Pixel ID 至少 15 位")
    .max(20, "Pixel ID 最多 20 位")
    .regex(/^\d+$/, "Pixel ID 应为纯数字"),
  accessToken: z
    .string()
    .min(100, "Access Token 长度不正确")
    .max(500, "Access Token 长度不正确"),
  testEventCode: z.string().max(20).optional(),
});

export type MetaCredentialsInput = z.infer<typeof MetaCredentialsSchema>;

/**
 * Google GA4 credentials
 */
export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .regex(/^G-[A-Z0-9]+$/i, "格式应为 G-XXXXXXXXXX"),
  apiSecret: z
    .string()
    .min(20, "API Secret 长度不正确")
    .max(50, "API Secret 长度不正确"),
});

export type GoogleCredentialsInput = z.infer<typeof GoogleCredentialsSchema>;

/**
 * TikTok Events API credentials
 */
export const TikTokCredentialsSchema = z.object({
  pixelId: z
    .string()
    .min(10, "Pixel ID 长度不正确")
    .max(30, "Pixel ID 长度不正确"),
  accessToken: z
    .string()
    .min(50, "Access Token 长度不正确")
    .max(200, "Access Token 长度不正确"),
});

export type TikTokCredentialsInput = z.infer<typeof TikTokCredentialsSchema>;

/**
 * Platform type
 */
export const PlatformSchema = z.enum(["meta", "google", "tiktok"]);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Server-side tracking config
 */
export const ServerSideConfigSchema = z.object({
  platform: PlatformSchema,
  enabled: z.boolean(),
});

/**
 * Validate platform credentials based on platform
 * Returns the result of Zod safeParse
 */
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
      // Return a fake failed result for invalid platform
      return { 
        success: false as const, 
        error: { 
          issues: [{ code: "custom", message: "Invalid platform", path: ["platform"] }] 
        } 
      };
  }
}

// =============================================================================
// Privacy Settings Schema
// =============================================================================

/**
 * Consent strategy type
 */
export const ConsentStrategySchema = z.enum(["strict", "balanced"]);
export type ConsentStrategy = z.infer<typeof ConsentStrategySchema>;

/**
 * Data retention days options
 */
export const DataRetentionDaysSchema = z
  .number()
  .int()
  .min(30)
  .max(365)
  .refine(
    (val) => [30, 60, 90, 180, 365].includes(val),
    "数据保留天数必须是 30、60、90、180 或 365"
  );

/**
 * Privacy settings schema
 */
export const PrivacySettingsSchema = z.object({
  piiEnabled: z.boolean(),
  pcdAcknowledged: z.boolean().optional(),
  consentStrategy: ConsentStrategySchema,
  dataRetentionDays: DataRetentionDaysSchema,
});

export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

// =============================================================================
// Form Data Parsing Helpers
// =============================================================================

/**
 * Parse form data to typed object
 */
export function parseFormDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    // Handle boolean strings
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

/**
 * Zod error with issues array (compatible with Zod v4)
 */
interface ZodErrorWithIssues {
  issues: Array<{
    path: (string | number)[];
    message: string;
  }>;
}

/**
 * Extract validation errors as field-message map
 */
export function extractZodErrors(
  error: z.ZodError<unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};
  const zodError = error as unknown as ZodErrorWithIssues;
  const issues = zodError.issues ?? [];
  
  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!errors[path]) {
      errors[path] = issue.message;
    }
  }
  return errors;
}

