/**
 * GDPR Service
 *
 * This file is maintained for backward compatibility.
 * All implementations have been moved to app/services/gdpr/.
 *
 * New code should import from './gdpr' or './gdpr/index'.
 */

// =============================================================================
// Re-exports from Modular Structure
// =============================================================================

// Types
export type {
  GDPRJobType,
  DataRequestPayload,
  CustomerRedactPayload,
  ShopRedactPayload,
  DataRequestResult,
  CustomerRedactResult,
  ShopRedactResult,
  GDPRComplianceResult,
  GDPRDeletionSummary,
} from "./gdpr";

// Processing functions
export {
  processGDPRJob,
  processGDPRJobs,
  getGDPRJobStatus,
} from "./gdpr";

// Compliance functions
export {
  checkGDPRCompliance,
  getGDPRDeletionSummary,
} from "./gdpr";
