/**
 * Conversions Module
 *
 * Handles server-side conversion tracking:
 * - Job processing pipeline
 * - Platform adapters (Meta, Google, TikTok)
 * - Retry and dead letter management
 * - Billing integration
 *
 * P2-1: Unified conversion processing with platform abstraction.
 */

// Job processing
export {
  processConversionJobs,
  getBatchBackoffDelay,
  calculateNextRetryTime,
  type ProcessConversionJobsResult,
} from "../../services/job-processor.server";

// Note: Receipt matching and trust evaluation are now exported from the ingest module
// Import from "~/modules/ingest" for: batchFetchReceipts, findReceiptForJob, evaluateTrust, etc.

// Platform adapters
export {
  sendConversionToPlatform,
  getSupportedPlatforms,
  isPlatformSupported,
} from "../../services/platforms/factory";

// Platform utilities
export {
  calculateBackoff,
  shouldRetry,
  classifyHttpError,
  classifyJsError,
  formatErrorForLog,
  buildMetaHashedUserData,
  buildTikTokHashedUserData,
  sendToMultiplePlatforms,
  type MetaUserData,
  type TikTokUserData,
  type PiiQuality,
  type PlatformServiceOptions,
  type BatchSendResult,
} from "../../services/platforms/base-platform.service";

// Retry management
export {
  processPendingConversions,
  processRetries,
  getDeadLetterItems,
  retryDeadLetter,
  retryAllDeadLetters,
  getRetryStats,
  checkTokenExpirationIssues,
  classifyFailureReason,
  type FailureReason,
} from "../../services/retry.server";

// Platform types
export type {
  ConversionData,
  PlatformCredentials,
  ConversionApiResponse,
} from "../../types";

