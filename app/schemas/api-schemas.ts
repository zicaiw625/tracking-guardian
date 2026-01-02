

import { z } from "zod";

import { OrderIdSchema } from "./pixel-event";

export const ShopDomainSchema = z
  .string()
  .min(1, "Shop domain is required")
  .max(255, "Shop domain too long")
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/,
    "Invalid Shopify domain format"
  );


export { OrderIdSchema };

export const CheckoutTokenSchema = z
  .string()
  .min(1, "Checkout token is required")
  .max(100, "Checkout token too long");

export const PlatformSchema = z.enum(["google", "meta", "tiktok"]);

export const CurrencySchema = z
  .string()
  .length(3, "Currency must be 3 characters")
  .regex(/^[A-Z]{3}$/, "Currency must be uppercase ISO 4217 code");

export const PositiveNumberSchema = z.number().positive("Value must be positive");

export const EmailSchema = z
  .string()
  .email("Invalid email format")
  .max(254, "Email too long")
  .transform((email) => email.toLowerCase().trim());

export const PhoneSchema = z
  .string()
  .min(7, "Phone number too short")
  .max(20, "Phone number too long")
  .regex(/^[+\d\s()-]+$/, "Invalid phone format");

export const SurveyInputSchema = z.object({
  orderId: OrderIdSchema,
  orderNumber: z.string().max(50).optional(),
  feedback: z
    .string()
    .min(1, "Feedback is required")
    .max(2000, "Feedback too long (max 2000 characters)"),
  rating: z.number().int().min(1).max(5).optional(),
  category: z
    .enum([
      "product_quality",
      "delivery",
      "customer_service",
      "website_experience",
      "other",
    ])
    .optional(),
  email: EmailSchema.optional(),
  name: z.string().max(100).optional(),
  anonymous: z.boolean().optional(),
});

export type SurveyInput = z.infer<typeof SurveyInputSchema>;

export const ConsentStateSchema = z.object({
  marketing: z.boolean().optional(),
  analytics: z.boolean().optional(),
  saleOfData: z.boolean().optional(),
});

export const LineItemSchema = z.object({
  productId: z.string().optional(),
  variantId: z.string().optional(),
  sku: z.string().max(100).optional(),
  name: z.string().max(500),
  quantity: z.number().int().positive(),
  price: PositiveNumberSchema,
});

export const PixelEventBaseSchema = z.object({
  shopDomain: ShopDomainSchema,
  eventType: z.enum([
    "checkout_completed",
    "page_viewed",
    "add_to_cart",
    "checkout_started",
  ]),
  timestamp: z.number().int().positive(),
});

export const CheckoutCompletedEventSchema = PixelEventBaseSchema.extend({
  eventType: z.literal("checkout_completed"),
  orderId: OrderIdSchema,
  checkoutToken: CheckoutTokenSchema.optional(),
  value: PositiveNumberSchema,
  currency: CurrencySchema.default("USD"),
  lineItems: z.array(LineItemSchema).optional(),
  consent: ConsentStateSchema.optional(),
});

export const PageViewEventSchema = PixelEventBaseSchema.extend({
  eventType: z.literal("page_viewed"),
  pageUrl: z.string().url().max(2000).optional(),
  pageTitle: z.string().max(500).optional(),
  referrer: z.string().url().max(2000).optional(),
});

export const AddToCartEventSchema = PixelEventBaseSchema.extend({
  eventType: z.literal("add_to_cart"),
  productId: z.string(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  price: PositiveNumberSchema.optional(),
});

export const PixelEventSchema = z.discriminatedUnion("eventType", [
  CheckoutCompletedEventSchema,
  PageViewEventSchema,
  AddToCartEventSchema,
]);

export type PixelEvent = z.infer<typeof PixelEventSchema>;
export type CheckoutCompletedEvent = z.infer<typeof CheckoutCompletedEventSchema>;
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const TrackingEventSchema = z.object({
  shopDomain: ShopDomainSchema,
  orderId: OrderIdSchema,
  orderNumber: z.string().max(50).optional(),
  value: PositiveNumberSchema,
  currency: CurrencySchema.default("USD"),
  timestamp: z.number().int().positive().optional(),
  email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
  checkoutToken: CheckoutTokenSchema.optional(),
  lineItems: z.array(LineItemSchema).optional(),
  consent: ConsentStateSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TrackingEvent = z.infer<typeof TrackingEventSchema>;

export const GoogleCredentialsSchema = z.object({
  measurementId: z
    .string()
    .regex(/^G-[A-Z0-9]+$/, "Invalid GA4 Measurement ID format"),
  apiSecret: z.string().min(1, "API secret is required"),
});

export const MetaCredentialsSchema = z.object({
  pixelId: z
    .string()
    .regex(/^\d{15,16}$/, "Invalid Meta Pixel ID format"),
  accessToken: z.string().min(1, "Access token is required"),
  testEventCode: z.string().optional(),
});

export const TikTokCredentialsSchema = z.object({
  pixelId: z
    .string()
    .regex(/^[A-Z0-9]{20,}$/i, "Invalid TikTok Pixel ID format"),
  accessToken: z.string().min(1, "Access token is required"),
  testEventCode: z.string().optional(),
});

export const PixelConfigUpdateSchema = z.object({
  platform: PlatformSchema,
  credentials: z.union([
    GoogleCredentialsSchema,
    MetaCredentialsSchema,
    TikTokCredentialsSchema,
  ]),
  isActive: z.boolean().optional(),
  serverSideEnabled: z.boolean().optional(),
});

export const ShopSettingsUpdateSchema = z.object({
  consentStrategy: z.enum(["strict", "balanced", "weak"]).optional(),
  piiEnabled: z.boolean().optional(),
  storefrontDomains: z.array(z.string().max(255)).max(10).optional(),
});

export type ShopSettingsUpdate = z.infer<typeof ShopSettingsUpdateSchema>;

export const EmailAlertSettingsSchema = z.object({
  type: z.literal("email"),
  email: EmailSchema,
});

export const SlackAlertSettingsSchema = z.object({
  type: z.literal("slack"),
  webhookUrl: z.string().url().startsWith("https://", "Webhook URL 必须使用 HTTPS")
});

export const TelegramAlertSettingsSchema = z.object({
  type: z.literal("telegram"),
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

export const AlertSettingsSchema = z.discriminatedUnion("type", [
  EmailAlertSettingsSchema,
  SlackAlertSettingsSchema,
  TelegramAlertSettingsSchema,
]);

export type AlertSettings = z.infer<typeof AlertSettingsSchema>;

export const CronTaskSchema = z.enum([
  "delivery_health",
  "reconciliation",
  "process_jobs",
  "process_gdpr",
  "cleanup",
  "all",
]);

export const CronRequestSchema = z.object({
  task: CronTaskSchema.optional(),
  force: z.boolean().optional(),
});

export type CronRequest = z.infer<typeof CronRequestSchema>;

export const ExportRequestSchema = z.object({
  type: z.enum(["conversion_logs", "reconciliation_reports", "scan_reports"]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  platform: PlatformSchema.optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.number().int().positive().max(10000).default(1000),
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export function validateInput<T>(
  schema: z.ZodType<T>,
  input: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { success: false, errors };
}

export function formatZodError(error: z.ZodError): {
  message: string;
  details: Array<{ field: string; message: string }>;
} {
  const details = error.issues.map((issue) => ({
    field: issue.path.join(".") || "root",
    message: issue.message,
  }));

  return {
    message: details.map((d) => `${d.field}: ${d.message}`).join("; "),
    details,
  };
}

export function createValidator<T>(schema: z.ZodType<T>) {
  return (input: unknown): T => {
    const result = schema.safeParse(input);
    if (!result.success) {
      const { message } = formatZodError(result.error);
      throw new Error(message);
    }
    return result.data;
  };
}

