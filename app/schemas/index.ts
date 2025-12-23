/**
 * Schemas Index
 *
 * Re-exports all Zod validation schemas.
 */

// Pixel event schema (primary/canonical definitions)
export * from "./pixel-event";

// Settings schemas
export * from "./settings";

// API schemas (excluding duplicates - LineItemSchema, PixelEventSchema, OrderIdSchema come from pixel-event)
export {
  ConsentStateSchema,
  type ConsentState,
  TrackingRequestSchema,
  type TrackingRequest,
  ExportRequestSchema,
  type ExportRequest,
  SurveyResponseSchema,
  type SurveyResponse,
  HealthCheckResponseSchema,
  type HealthCheckResponse,
  ShopifyDomainSchema,
  ShopifyGidSchema,
  RateLimitInfoSchema,
  type RateLimitInfo,
} from "./api";

// API schemas module for more specific types
export * as ApiSchemas from "./api-schemas";
