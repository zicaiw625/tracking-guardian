

import { z } from "zod";
import { logger } from "../utils/logger.server";

export const AlertEmailSchema = z.object({
  email: z.string().email("请输入有效的邮箱地址"),
});

export const AlertSlackSchema = z.object({
  webhookUrl: z
    .string()
    .url("请输入有效的 URL")
    .startsWith("https://"),
});

export const AlertTelegramSchema = z.object({
  botToken: z
    .string()
    .min(30, "Bot Token 格式不正确")
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "Bot Token 格式不正确"),
  chatId: z
    .string()
    .regex(/^-?\d+$/, "Chat ID 应为数字"),
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
    "数据保留天数必须是 30、60、90、180 或 365"
  );

export const PrivacySettingsSchema = z.object({
  piiEnabled: z.boolean(),
  pcdAcknowledged: z.boolean().optional(),
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
  // v1 默认使用 purchase_only（仅收集结账完成事件），符合隐私最小化原则
  // 商家可在设置中切换为 full_funnel（收集全漏斗事件）
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

export const WebPixelSettingsSchema = z.object({
  ingestion_key: z.string().min(1, "Ingestion key is required"),
  shop_domain: z.string().min(1, "Shop domain is required"),
  pixel_config: z.string().optional(),
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

interface ZodErrorWithIssues {
  issues: Array<{
    path: (string | number)[];
    message: string;
  }>;
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

