/**
 * API Schemas
 *
 * Zod validation schemas for API endpoints.
 */

import { z } from "zod";

// =============================================================================
// Pixel Events API Schema
// =============================================================================

/**
 * Consent state enum
 */
export const ConsentStateSchema = z.enum([
  "granted",
  "denied",
  "pending",
  "unknown",
]);

export type ConsentState = z.infer<typeof ConsentStateSchema>;

/**
 * Line item in pixel event
 */
export const LineItemSchema = z.object({
  sku: z.string().max(100).optional(),
  productId: z.string().max(50).optional(),
  variantId: z.string().max(50).optional(),
  name: z.string().max(200).optional(),
  quantity: z.number().int().min(0).optional(),
  price: z.number().min(0).optional(),
});

export type LineItem = z.infer<typeof LineItemSchema>;

/**
 * Pixel event payload schema
 */
export const PixelEventSchema = z.object({
  // Required fields
  event: z.string().min(1).max(100),
  shopDomain: z.string().min(1).max(255),
  orderId: z.string().min(1).max(100),
  timestamp: z.number().int().positive(),

  // Optional fields
  ingestionKey: z.string().max(100).optional(),
  checkoutToken: z.string().max(100).optional(),
  eventId: z.string().max(100).optional(),
  clientId: z.string().max(100).optional(),

  // Consent fields
  analyticsConsent: ConsentStateSchema.optional(),
  marketingConsent: ConsentStateSchema.optional(),

  // Order data
  currency: z.string().length(3).optional(),
  value: z.number().min(0).optional(),
  lineItems: z.array(LineItemSchema).max(100).optional(),

  // Context
  userAgent: z.string().max(500).optional(),
  pageUrl: z.string().url().max(2000).optional(),
});

export type PixelEvent = z.infer<typeof PixelEventSchema>;

// =============================================================================
// Tracking API Schema
// =============================================================================

/**
 * Tracking endpoint request schema
 */
export const TrackingRequestSchema = z.object({
  event: z.string().min(1).max(50),
  shop: z.string().min(1).max(255),
  orderId: z.string().max(100).optional(),
  timestamp: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type TrackingRequest = z.infer<typeof TrackingRequestSchema>;

// =============================================================================
// Export API Schema
// =============================================================================

/**
 * Export request schema
 */
export const ExportRequestSchema = z.object({
  type: z.enum(["conversion_logs", "reconciliation_reports", "audit_logs"]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.number().int().min(1).max(10000).default(1000),
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;

// =============================================================================
// Survey API Schema
// =============================================================================

/**
 * Survey response schema
 */
export const SurveyResponseSchema = z.object({
  questionId: z.string().min(1).max(100),
  response: z.union([
    z.string().max(1000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(100)),
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SurveyResponse = z.infer<typeof SurveyResponseSchema>;

// =============================================================================
// Health Check Schema
// =============================================================================

/**
 * Health check response schema
 */
export const HealthCheckResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  version: z.string().optional(),
  uptime: z.number().optional(),
  checks: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail", "warn"]),
        message: z.string().optional(),
        latency: z.number().optional(),
      })
    )
    .optional(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

// =============================================================================
// Common Validation Patterns
// =============================================================================

/**
 * Shopify domain validation
 */
export const ShopifyDomainSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/,
    "Invalid Shopify domain format"
  );

/**
 * Shopify GID validation
 */
export const ShopifyGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/\w+\/\d+$/, "Invalid Shopify GID format");

/**
 * Order ID validation (supports both legacy and GID formats)
 */
export const OrderIdSchema = z.union([
  z.string().regex(/^\d+$/),
  ShopifyGidSchema,
  z.string().regex(/^#?\d+$/),
]);

// =============================================================================
// Rate Limiting Schema
// =============================================================================

/**
 * Rate limit info in response headers
 */
export const RateLimitInfoSchema = z.object({
  limit: z.number().int().positive(),
  remaining: z.number().int().min(0),
  reset: z.number().int().positive(),
});

export type RateLimitInfo = z.infer<typeof RateLimitInfoSchema>;

