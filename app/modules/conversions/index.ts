

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
  // P0-3: v1.0 版本不包含任何 PCD/PII 处理，因此移除 buildMetaHashedUserData 和 buildTikTokHashedUserData 导出
  sendToMultiplePlatforms,
  // P0-3: v1.0 版本不包含任何 PCD/PII 处理，因此移除 MetaUserData, TikTokUserData, PiiQuality 类型导出
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

