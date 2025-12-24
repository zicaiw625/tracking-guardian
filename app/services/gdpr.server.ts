/**
 * GDPR Service
 *
 * BACKWARDS COMPATIBILITY LAYER
 * =============================
 * 
 * This file provides backwards compatibility for existing imports.
 * All implementations have been moved to app/services/gdpr/.
 * 
 * RECOMMENDED:
 *   import { processGDPRJob, checkGDPRCompliance } from "~/services/gdpr"
 * 
 * LEGACY (still works):
 *   import { processGDPRJob } from "~/services/gdpr.server"
 * 
 * @deprecated Prefer importing from "~/services/gdpr" directly
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
