/**
 * GDPR Service Module
 *
 * Re-exports all GDPR-related functionality from modular components.
 * This provides a clean public API while keeping implementation organized.
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Job types
  GDPRJobType,
  GDPRJobStatus,
  // Payload types
  DataRequestPayload,
  CustomerRedactPayload,
  ShopRedactPayload,
  GDPRPayload,
  // Result types
  DataRequestResult,
  CustomerRedactResult,
  ShopRedactResult,
  GDPRJobResult,
  // Export types
  ExportedConversionLog,
  ExportedSurveyResponse,
  ExportedPixelEventReceipt,
  DataLocatedSummary,
  CustomerRedactDeletionCounts,
  ShopRedactDeletionCounts,
  // Processing types
  ProcessGDPRJobResult,
  ProcessGDPRJobsResult,
  GDPRJobStatusSummary,
  GDPRComplianceResult,
  GDPRDeletionSummary,
} from "./types";

// Type guards and validation
export {
  // Type guards
  isDataRequestResult,
  isCustomerRedactResult,
  isShopRedactResult,
  // Payload parsing
  parseDataRequestPayload,
  parseCustomerRedactPayload,
  parseShopRedactPayload,
  parseGDPRPayload,
  // Zod schemas
  DataRequestPayloadSchema,
  CustomerRedactPayloadSchema,
  ShopRedactPayloadSchema,
  // Factory functions
  createEmptyDataRequestResult,
  createEmptyCustomerRedactResult,
  createEmptyShopRedactDeletionCounts,
} from "./types";

// =============================================================================
// Handlers
// =============================================================================

export {
  processDataRequest,
  processCustomerRedact,
  processShopRedact,
} from "./handlers";

// =============================================================================
// Job Processing
// =============================================================================

export {
  processGDPRJob,
  processGDPRJobs,
  getGDPRJobStatus,
} from "./job-processor";

// =============================================================================
// Compliance
// =============================================================================

export {
  checkGDPRCompliance,
  getGDPRDeletionSummary,
} from "./compliance";

