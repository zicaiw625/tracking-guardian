export {
  processConversionJobs,
  getBatchBackoffDelay,
  calculateNextRetryTime,
  type ProcessConversionJobsResult,
} from "../../services/job-processor.server";

export {
  sendConversionToPlatform,
  getSupportedPlatforms,
  isPlatformSupported,
} from "../../services/platforms/factory";

export {
  calculateBackoff,
  shouldRetry,
  classifyHttpError,
  classifyJsError,
  formatErrorForLog,

  sendToMultiplePlatforms,

  type PlatformServiceOptions,
  type BatchSendResult,
} from "../../services/platforms/base-platform.service";

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

export type {
  ConversionData,
  PlatformCredentials,
  ConversionApiResponse,
} from "../../types";
