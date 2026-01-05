

export {
  type ConversionJob,
  type JobWithShop,
  type JobStatus,
  type PlatformResultStatus,
  type ConsentState,
  type TrustResult,
  type ConsentEvidence,
  type TrustMetadata,
  type LineItem,
  type CapiInput,
  // P0-1: v1.0 版本不包含任何 PCD/PII 处理，因此移除 HashedIdentifiers 导出
  createConversionJob,
  canRetry,
  isExhausted,
  isTerminal,
  isReady,
  calculateNextRetryTime,
  getJobAge,
  allPlatformsSucceeded,
  anyPlatformSucceeded,
  getFailedPlatforms,
  isValidJobStatus,
  isValidPlatformResultStatus,
} from "./conversion.entity";

export {
  type IConversionJobRepository,
  type QueryPendingJobsOptions,
  type QueryByStatusOptions,
  type JobStatusUpdate,
  type CreateJobData,
  type BatchUpdateResult,
  type JobEvent,
  type JobCreatedEvent,
  type JobCompletedEvent,
  type JobFailedEvent,
  type JobDeadLetteredEvent,
  type ConversionJobEvent,
} from "./conversion.repository";

