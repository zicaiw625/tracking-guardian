/**
 * ConversionJob Service
 * 
 * P0-3: This file has been refactored to eliminate duplicate processing logic.
 * 
 * The actual job processing is now ONLY in job-processor.server.ts.
 * This file provides:
 * - Re-exports of the main processing function (for backwards compatibility)
 * - Re-exports of modularized utilities (receipt matching, trust evaluation)
 * - Legacy calculateNextRetryTime function (used by retry.server.ts)
 * 
 * DO NOT add new processing logic here. All job processing should go through
 * job-processor.server.ts as the single source of truth.
 */

import { JOB_PROCESSING_CONFIG } from "../utils/config";

const { BASE_DELAY_MS, MAX_DELAY_MS, BACKOFF_MULTIPLIER } = JOB_PROCESSING_CONFIG;

// =============================================================================
// Utility Functions (kept for backwards compatibility)
// =============================================================================

/**
 * Calculate next retry time with exponential backoff and jitter.
 * 
 * @deprecated Prefer importing from job-processor.server.ts
 */
export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1), MAX_DELAY_MS);
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

// =============================================================================
// Re-exports from job-processor.server.ts (SINGLE SOURCE OF TRUTH)
// =============================================================================

/**
 * P0-3: processConversionJobs is now re-exported from job-processor.server.ts
 * This ensures there is only ONE implementation of job processing.
 */
export { 
  processConversionJobs,
  type ProcessConversionJobsResult,
  getBatchBackoffDelay,
} from './job-processor.server';

// =============================================================================
// Re-exports from Split Modules
// =============================================================================

/**
 * Receipt matching utilities
 */
export { 
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields,
  type JobForReceiptMatch,
} from './receipt-matcher.server';

/**
 * Trust and consent evaluation utilities
 */
export {
  evaluateTrust,
  checkPlatformEligibility,
  buildConsentEvidence,
  DEFAULT_TRUST_OPTIONS,
  type ShopTrustContext,
  type TrustEvaluationResult,
  type PlatformEligibilityResult,
} from './trust-evaluator.server';
