/**
 * Database Services Index
 *
 * Centralized exports for all database repository modules.
 */

// Shop repository
export {
  getShopById,
  getShopIdByDomain,
  getShopWithPixels,
  getShopWithBilling,
  batchGetShops,
  batchGetShopsWithPixels,
  invalidateShopCache,
  invalidateShopCacheByDomain,
  clearShopCaches,
  type ShopBasic,
  type ShopWithPixels,
  type ShopWithBilling,
} from "./shop-repository.server";

// Pixel config repository
export {
  getShopPixelConfigs,
  getPixelConfigByPlatform,
  getPixelConfigById,
  getPixelConfigSummaries,
  upsertPixelConfig,
  deactivatePixelConfig,
  deletePixelConfig,
  batchGetPixelConfigs,
  hasServerSideConfigs,
  getConfiguredPlatforms,
  invalidatePixelConfigCache,
  clearPixelConfigCache,
  type PixelConfigCredentials,
  type PixelConfigFull,
  type PixelConfigSummary,
  type PixelConfigInput,
} from "./pixel-config-repository.server";

// Conversion job repository
export {
  getPendingJobs,
  claimJobsForProcessing,
  updateJobStatus,
  batchUpdateJobStatus,
  createConversionJob,
  jobExistsForOrder,
  getJobCountsByStatus,
  getDeadLetterJobs,
  requeueDeadLetterJobs,
  cleanupOldJobs,
  type JobForProcessing,
  type QueryPendingJobsOptions,
  type JobStatusUpdate,
} from "./conversion-repository.server";

// Batch operations
export {
  batchCompleteJobs,
  batchInsertReceipts,
  batchUpdateShops,
  // Note: batchCreateAuditLogs is exported from audit-repository.server as createAuditLogsBatch
  executeInTransaction,
  processInChunks,
  type JobCompletionData,
  type PixelReceiptData,
  type BatchResult,
} from "./batch-operations.server";

// Audit repository
export {
  createAuditLogEntry,
  batchCreateAuditLogs,
  batchCreateAuditLogs as createAuditLogsBatch,
  getAuditLogsForShop,
  getAuditLogById,
  cleanupOldAuditLogs,
  countAuditLogsByAction,
  extractRequestContext,
  auditLog,
  createAuditLog,
  type ActorType,
  type AuditAction,
  type ResourceType,
  type AuditLogEntry,
  type AuditLogQueryOptions,
  type AuditLogSummary,
  type AuditLogFull,
} from "./audit-repository.server";

// Cached queries
export {
  getCachedShop,
  invalidateShopCache as invalidateCachedShop,
  getCachedShopWithConfigs,
  invalidateShopWithConfigsCache,
  getCachedAlertConfigs,
  invalidateAlertConfigsCache,
  getCachedMonthlyUsage,
  invalidateMonthlyUsageCache,
  clearAllCaches,
  getCacheStats,
} from "./cached-queries.server";
