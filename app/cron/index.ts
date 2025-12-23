/**
 * Cron Module
 *
 * Centralized exports for cron-related functionality.
 * This module provides a clean public API for cron operations.
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Result types
  CleanupResult,
  ShopStatusRefreshResult,
  DeliveryHealthResult,
  DeliveryHealthCheckItem,
  ReconciliationTaskResult,
  CronResult,
  // Response types
  CronSuccessResponse,
  CronSkippedResponse,
  CronErrorResponse,
  CronResponse,
  // Auth types
  ReplayProtectionResult,
  CronHttpMethod,
  // Batch delete types
  DeletableRecord,
  BatchDeleteResult,
  CleanupShopData,
  ShopRetentionGroup,
  // Logger type
  CronLogger,
  // Cron task result types
  GDPRProcessingResult,
  GDPRComplianceCheckResult,
  ConsentReconciliationResult,
  ConversionJobResult,
  PendingConversionResult,
  RetryProcessingResult,
} from "./types";

// Type guards
export { isCronSuccess, isCronSkipped, isCronError } from "./types";

// =============================================================================
// Authentication
// =============================================================================

export { validateCronAuth, verifyReplayProtection } from "./auth";

// =============================================================================
// Tasks
// =============================================================================

export { executeCronTasks, cleanupExpiredData, refreshAllShopsStatus } from "./tasks";

