/**
 * API Response Schemas
 *
 * Zod schemas for validating API responses.
 * Provides type-safe response structures for all endpoints.
 */

import { z } from "zod";
import { PlatformTypeSchema } from "./platform-credentials";

// =============================================================================
// Base Response Schemas
// =============================================================================

/**
 * Base success response schema
 */
export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
});

/**
 * Base error response schema
 */
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z
    .array(
      z.object({
        field: z.string(),
        message: z.string(),
      })
    )
    .optional(),
});

/**
 * Combined base response schema
 */
export const BaseResponseSchema = z.discriminatedUnion("success", [
  SuccessResponseSchema,
  ErrorResponseSchema.extend({ success: z.literal(false) }),
]);

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type BaseResponse = z.infer<typeof BaseResponseSchema>;

// =============================================================================
// Pixel Events API Responses
// =============================================================================

/**
 * Pixel event success response
 */
export const PixelEventResponseSchema = z.object({
  success: z.literal(true),
  eventId: z.string(),
  message: z.string().optional(),
  clientSideSent: z.boolean().optional(),
  platforms: z.array(z.string()).optional(),
  skippedPlatforms: z.array(z.string()).optional(),
  trusted: z.boolean().optional(),
  consent: z
    .object({
      marketing: z.boolean().optional(),
      analytics: z.boolean().optional(),
      saleOfData: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

export type PixelEventResponse = z.infer<typeof PixelEventResponseSchema>;

// =============================================================================
// Scan API Responses
// =============================================================================

/**
 * Risk item schema
 */
export const RiskItemResponseSchema = z.object({
  id: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  description: z.string(),
  platform: z.string().optional(),
  recommendation: z.string().optional(),
});

/**
 * Scan report response schema
 */
export const ScanReportResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "scanning", "completed", "failed"]),
  riskScore: z.number().min(0).max(100),
  riskItems: z.array(RiskItemResponseSchema),
  identifiedPlatforms: z.array(z.string()),
  scriptTagsCount: z.number(),
  hasOrderStatusScripts: z.boolean(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export type RiskItemResponse = z.infer<typeof RiskItemResponseSchema>;
export type ScanReportResponse = z.infer<typeof ScanReportResponseSchema>;

// =============================================================================
// Platform Config Responses
// =============================================================================

/**
 * Platform config response schema
 */
export const PlatformConfigResponseSchema = z.object({
  id: z.string(),
  platform: PlatformTypeSchema,
  platformId: z.string().nullable(),
  isActive: z.boolean(),
  clientSideEnabled: z.boolean(),
  serverSideEnabled: z.boolean(),
  migrationStatus: z.enum(["not_started", "in_progress", "completed"]),
  migratedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Credentials are never returned in responses
  hasCredentials: z.boolean(),
  lastVerifiedAt: z.string().datetime().nullable().optional(),
});

export type PlatformConfigResponse = z.infer<typeof PlatformConfigResponseSchema>;

// =============================================================================
// Conversion Log Responses
// =============================================================================

/**
 * Conversion log entry response schema
 */
export const ConversionLogResponseSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  orderNumber: z.string().nullable(),
  orderValue: z.number(),
  currency: z.string(),
  platform: z.string(),
  eventType: z.string(),
  status: z.enum(["pending", "sent", "failed", "retrying", "dead_letter"]),
  attempts: z.number(),
  lastAttemptAt: z.string().datetime().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  clientSideSent: z.boolean(),
  serverSideSent: z.boolean(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable().optional(),
});

/**
 * Conversion logs list response schema
 */
export const ConversionLogsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ConversionLogResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  hasMore: z.boolean(),
});

export type ConversionLogResponse = z.infer<typeof ConversionLogResponseSchema>;
export type ConversionLogsResponse = z.infer<typeof ConversionLogsResponseSchema>;

// =============================================================================
// Reconciliation Responses
// =============================================================================

/**
 * Reconciliation report response schema
 */
export const ReconciliationReportResponseSchema = z.object({
  id: z.string(),
  platform: z.string(),
  reportDate: z.string(),
  shopifyOrders: z.number(),
  shopifyRevenue: z.number(),
  platformConversions: z.number(),
  platformRevenue: z.number(),
  orderDiscrepancy: z.number(),
  revenueDiscrepancy: z.number(),
  status: z.enum(["pending", "completed", "failed"]),
  alertSent: z.boolean(),
  createdAt: z.string().datetime(),
});

export type ReconciliationReportResponse = z.infer<typeof ReconciliationReportResponseSchema>;

// =============================================================================
// Health Check Responses
// =============================================================================

/**
 * Service health status
 */
export const ServiceHealthSchema = z.object({
  name: z.string(),
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
});

/**
 * Health check response schema
 */
export const HealthCheckResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  version: z.string(),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  services: z.array(ServiceHealthSchema),
});

export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// =============================================================================
// Shop Settings Responses
// =============================================================================

/**
 * Shop settings response schema
 */
export const ShopSettingsResponseSchema = z.object({
  shopDomain: z.string(),
  plan: z.string(),
  monthlyOrderLimit: z.number(),
  piiEnabled: z.boolean(),
  consentStrategy: z.enum(["strict", "balanced", "weak"]),
  dataRetentionDays: z.number(),
  primaryDomain: z.string().nullable(),
  storefrontDomains: z.array(z.string()),
  webPixelId: z.string().nullable().optional(),
  shopTier: z.enum(["plus", "non_plus"]).nullable().optional(),
  typOspPagesEnabled: z.boolean().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ShopSettingsResponse = z.infer<typeof ShopSettingsResponseSchema>;

// =============================================================================
// Alert Config Responses
// =============================================================================

/**
 * Alert config response schema
 */
export const AlertConfigResponseSchema = z.object({
  id: z.string(),
  channel: z.enum(["email", "slack", "telegram"]),
  isEnabled: z.boolean(),
  discrepancyThreshold: z.number(),
  minOrdersForAlert: z.number(),
  frequency: z.enum(["daily", "weekly", "instant"]),
  lastAlertAt: z.string().datetime().nullable().optional(),
  // Settings are partially masked for security
  settingsSummary: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AlertConfigResponse = z.infer<typeof AlertConfigResponseSchema>;

// =============================================================================
// Billing Responses
// =============================================================================

/**
 * Billing status response schema
 */
export const BillingStatusResponseSchema = z.object({
  plan: z.string(),
  monthlyLimit: z.number(),
  currentUsage: z.number(),
  usagePercentage: z.number(),
  resetDate: z.string(),
  upgradeAvailable: z.boolean(),
  features: z.array(z.string()),
});

export type BillingStatusResponse = z.infer<typeof BillingStatusResponseSchema>;

// =============================================================================
// Export Responses
// =============================================================================

/**
 * Export job response schema
 */
export const ExportJobResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  type: z.string(),
  format: z.enum(["json", "csv"]),
  recordCount: z.number().optional(),
  downloadUrl: z.string().url().optional(),
  expiresAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;

// =============================================================================
// Cron Response
// =============================================================================

/**
 * Cron task result schema
 */
export const CronTaskResultSchema = z.object({
  task: z.string(),
  success: z.boolean(),
  duration: z.number(),
  itemsProcessed: z.number().optional(),
  errors: z.array(z.string()).optional(),
});

/**
 * Cron response schema
 */
export const CronResponseSchema = z.object({
  success: z.literal(true),
  results: z.array(CronTaskResultSchema),
  totalDuration: z.number(),
  timestamp: z.string().datetime(),
});

export type CronTaskResult = z.infer<typeof CronTaskResultSchema>;
export type CronResponse = z.infer<typeof CronResponseSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Create a standard API response
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string
): { success: true; data: T; message?: string } {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

/**
 * Create a standard error response
 */
export function createErrorResponse(
  error: string,
  code?: string,
  details?: Array<{ field: string; message: string }>
): ErrorResponse {
  return {
    success: false,
    error,
    ...(code && { code }),
    ...(details && { details }),
  };
}

/**
 * Validate and parse an API response
 */
export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((i) => i.message).join("; "),
  };
}

