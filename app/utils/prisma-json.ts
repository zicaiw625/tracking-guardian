

import { z } from "zod";
import { Prisma } from "@prisma/client";

export const CapiLineItemSchema = z.object({
  productId: z.string().optional(),
  variantId: z.string().optional(),
  sku: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

export const CapiInputSchema = z.object({
  orderId: z.string(),
  value: z.number(),
  currency: z.string().default("USD"),
  orderNumber: z.string().nullish(),
  items: z.array(CapiLineItemSchema).optional(),
  contentIds: z.array(z.string()).optional(),
  numItems: z.number().optional(),
  tax: z.number().optional(),
  shipping: z.number().optional(),
  processedAt: z.string().optional(),
  webhookReceivedAt: z.string().optional(),
  checkoutToken: z.string().nullish(),
  shopifyOrderId: z.union([z.number(), z.string()]).optional(),
});

export const ConsentStateSchema = z.object({
  marketing: z.boolean().optional(),
  analytics: z.boolean().optional(),
  saleOfData: z.boolean().optional(),
});

const TrustLevelValues = ["trusted", "partial", "untrusted", "unknown"] as const;

const ConsentStrategyValues = ["strict", "balanced", "weak"] as const;

export const ConsentEvidenceSchema = z.object({
  strategy: z.enum(ConsentStrategyValues),
  hasReceipt: z.boolean(),
  receiptTrusted: z.boolean(),
  trustLevel: z.enum(TrustLevelValues),
  consentState: ConsentStateSchema.nullable(),
  usedConsent: z.string().optional(),
  reason: z.string().optional(),
});

export const TrustMetadataSchema = z.object({
  trustLevel: z.enum(TrustLevelValues),
  reason: z.string().optional(),
  verifiedAt: z.string().optional(),
  hasReceipt: z.boolean().optional(),
  receiptTrustLevel: z.string().optional(),
  webhookHasCheckoutToken: z.boolean().optional(),
  checkoutTokenMatched: z.boolean().optional(),
  originValidated: z.boolean().optional(),
});

export const PlatformResultsSchema = z.record(z.string(), z.string());

const RiskSeverityValues = ["low", "medium", "high", "critical"] as const;

export const RiskItemSchema = z.object({
  id: z.string(),
  severity: z.enum(RiskSeverityValues),
  title: z.string(),
  description: z.string(),
  platform: z.string().optional(),
  recommendation: z.string().optional(),
});

export const PixelClientConfigSchema = z.object({
  treatAsMarketing: z.boolean().optional(),
  conversionLabels: z.array(z.string()).optional(),
  eventMappings: z.record(z.string(), z.string()).optional(),
  mode: z.enum(["purchase_only", "full_funnel"]).optional(),
  purchaseStrategy: z.enum(["server_side_only", "hybrid"]).optional(),
});

export const PlatformResponseSchema = z.object({
  success: z.boolean().optional(),
  events_received: z.number().optional(),
  fbtrace_id: z.string().optional(),
  conversionId: z.string().optional(),
  timestamp: z.string().optional(),
  error: z
    .object({
      code: z.union([z.number(), z.string()]).optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type CapiLineItem = z.infer<typeof CapiLineItemSchema>;
export type CapiInput = z.infer<typeof CapiInputSchema>;
export type ConsentState = z.infer<typeof ConsentStateSchema>;
export type ConsentEvidence = z.infer<typeof ConsentEvidenceSchema>;
export type TrustMetadata = z.infer<typeof TrustMetadataSchema>;
export type PlatformResults = z.infer<typeof PlatformResultsSchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;
export type PixelClientConfig = z.infer<typeof PixelClientConfigSchema>;
export type PlatformResponse = z.infer<typeof PlatformResponseSchema>;

export interface SafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: z.ZodError;
}

export function safeParseCapiInput(json: unknown): SafeParseResult<CapiInput> {
  const result = CapiInputSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function safeParseConsentState(json: unknown): SafeParseResult<ConsentState> {
  const result = ConsentStateSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function safeParseConsentEvidence(
  json: unknown
): SafeParseResult<ConsentEvidence> {
  const result = ConsentEvidenceSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function safeParseTrustMetadata(
  json: unknown
): SafeParseResult<TrustMetadata> {
  const result = TrustMetadataSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function safeParseRiskItems(json: unknown): SafeParseResult<RiskItem[]> {
  const result = z.array(RiskItemSchema).safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function safeParsePixelClientConfig(
  json: unknown
): SafeParseResult<PixelClientConfig> {
  const result = PixelClientConfigSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export function toJsonInput<T>(data: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

export function parseJsonWithFallback<T>(
  json: unknown,
  schema: z.ZodType<T>,
  fallback: T
): T {
  const result = schema.safeParse(json);
  return result.success ? result.data : fallback;
}

export function parseJsonOrNull<T>(
  json: unknown,
  schema: z.ZodType<T>
): T | null {
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isPrismaJson(value: unknown): value is Prisma.JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isPrismaJson);
  }
  if (isObject(value)) {
    return Object.values(value).every(isPrismaJson);
  }
  return false;
}

export function createEmptyCapiInput(orderId: string, value: number, currency = "USD"): CapiInput {
  return {
    orderId,
    value,
    currency,
    orderNumber: null,
    items: [],
    checkoutToken: null,
  };
}

export function createDefaultConsentState(): ConsentState {
  return {
    marketing: undefined,
    analytics: undefined,
    saleOfData: undefined,
  };
}

export function createDefaultTrustMetadata(): TrustMetadata {
  return {
    trustLevel: "unknown",
    hasReceipt: false,
  };
}

export function mergeConsentStates(
  base: ConsentState | null,
  override: ConsentState | null
): ConsentState {
  return {
    marketing: override?.marketing ?? base?.marketing,
    analytics: override?.analytics ?? base?.analytics,
    saleOfData: override?.saleOfData ?? base?.saleOfData,
  };
}

export function toInputJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}
