/**
 * Prisma JSON Type Utilities
 *
 * Type-safe utilities for working with Prisma JSON fields.
 * Provides runtime validation and type narrowing for database JSON columns.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";

// =============================================================================
// Zod Schemas for JSON Fields
// =============================================================================

/**
 * Line item schema for CAPI input
 */
export const CapiLineItemSchema = z.object({
  productId: z.string().optional(),
  variantId: z.string().optional(),
  sku: z.string().optional(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

/**
 * CAPI input schema for ConversionJob.capiInput
 */
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

/**
 * Consent state schema for PixelEventReceipt.consentState
 */
export const ConsentStateSchema = z.object({
  marketing: z.boolean().optional(),
  analytics: z.boolean().optional(),
  saleOfData: z.boolean().optional(),
});

/**
 * Trust level enum values
 */
const TrustLevelValues = ["trusted", "partial", "untrusted", "unknown"] as const;

/**
 * Consent strategy enum values
 */
const ConsentStrategyValues = ["strict", "balanced", "weak"] as const;

/**
 * Consent evidence schema for ConversionJob.consentEvidence
 */
export const ConsentEvidenceSchema = z.object({
  strategy: z.enum(ConsentStrategyValues),
  hasReceipt: z.boolean(),
  receiptTrusted: z.boolean(),
  trustLevel: z.enum(TrustLevelValues),
  consentState: ConsentStateSchema.nullable(),
  usedConsent: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Trust metadata schema for ConversionJob.trustMetadata
 */
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

/**
 * Platform results schema for ConversionJob.platformResults
 */
export const PlatformResultsSchema = z.record(z.string(), z.string());

/**
 * Risk severity enum values
 */
const RiskSeverityValues = ["low", "medium", "high", "critical"] as const;

/**
 * Risk item schema for ScanReport.riskItems
 */
export const RiskItemSchema = z.object({
  id: z.string(),
  severity: z.enum(RiskSeverityValues),
  title: z.string(),
  description: z.string(),
  platform: z.string().optional(),
  recommendation: z.string().optional(),
});

/**
 * Pixel client config schema for PixelConfig.clientConfig
 */
export const PixelClientConfigSchema = z.object({
  treatAsMarketing: z.boolean().optional(),
  conversionLabels: z.array(z.string()).optional(),
  eventMappings: z.record(z.string(), z.string()).optional(),
});

/**
 * Platform response schema for ConversionLog.platformResponse
 */
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

// =============================================================================
// Type Exports
// =============================================================================

export type CapiLineItem = z.infer<typeof CapiLineItemSchema>;
export type CapiInput = z.infer<typeof CapiInputSchema>;
export type ConsentState = z.infer<typeof ConsentStateSchema>;
export type ConsentEvidence = z.infer<typeof ConsentEvidenceSchema>;
export type TrustMetadata = z.infer<typeof TrustMetadataSchema>;
export type PlatformResults = z.infer<typeof PlatformResultsSchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;
export type PixelClientConfig = z.infer<typeof PixelClientConfigSchema>;
export type PlatformResponse = z.infer<typeof PlatformResponseSchema>;

// =============================================================================
// Safe Parsing Functions
// =============================================================================

/**
 * Result of safe parsing
 */
export interface SafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: z.ZodError;
}

/**
 * Safely parse CAPI input from JSON
 */
export function safeParseCapiInput(json: unknown): SafeParseResult<CapiInput> {
  const result = CapiInputSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Safely parse consent state from JSON
 */
export function safeParseConsentState(json: unknown): SafeParseResult<ConsentState> {
  const result = ConsentStateSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Safely parse consent evidence from JSON
 */
export function safeParseConsentEvidence(
  json: unknown
): SafeParseResult<ConsentEvidence> {
  const result = ConsentEvidenceSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Safely parse trust metadata from JSON
 */
export function safeParseTrustMetadata(
  json: unknown
): SafeParseResult<TrustMetadata> {
  const result = TrustMetadataSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Safely parse risk items from JSON array
 */
export function safeParseRiskItems(json: unknown): SafeParseResult<RiskItem[]> {
  const result = z.array(RiskItemSchema).safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

/**
 * Safely parse pixel client config from JSON
 */
export function safeParsePixelClientConfig(
  json: unknown
): SafeParseResult<PixelClientConfig> {
  const result = PixelClientConfigSchema.safeParse(json);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

// =============================================================================
// Type-Safe JSON Field Utilities
// =============================================================================

/**
 * Convert typed object to Prisma JSON input
 */
export function toJsonInput<T>(data: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}

/**
 * Parse JSON with fallback
 */
export function parseJsonWithFallback<T>(
  json: unknown,
  schema: z.ZodType<T>,
  fallback: T
): T {
  const result = schema.safeParse(json);
  return result.success ? result.data : fallback;
}

/**
 * Parse JSON or return null
 */
export function parseJsonOrNull<T>(
  json: unknown,
  schema: z.ZodType<T>
): T | null {
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Check if value is a string array
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Check if value is a valid JSON object for Prisma
 */
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

// =============================================================================
// Database Field Helpers
// =============================================================================

/**
 * Create empty CAPI input for new jobs
 */
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

/**
 * Create default consent state
 */
export function createDefaultConsentState(): ConsentState {
  return {
    marketing: undefined,
    analytics: undefined,
    saleOfData: undefined,
  };
}

/**
 * Create default trust metadata
 */
export function createDefaultTrustMetadata(): TrustMetadata {
  return {
    trustLevel: "unknown",
    hasReceipt: false,
  };
}

/**
 * Merge consent states (later values override earlier)
 */
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

/**
 * Convert value to Prisma InputJsonValue.
 * Handles undefined by returning Prisma.DbNull (for setting to DB null).
 */
export function toInputJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) {
    return Prisma.DbNull;
  }
  return value as Prisma.InputJsonValue;
}
