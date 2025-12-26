/**
 * Database Infrastructure
 *
 * P2-1: Centralized database access layer with repositories.
 * Provides type-safe database operations with caching support.
 */

// Prisma client
export { default as prisma } from "../../db.server";

// Re-export all from services/db/index.ts
export {
  // Shop repository
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
  
  // Pixel config repository
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
  
  // Conversion job repository
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
  
  // Batch operations
  batchCompleteJobs,
  batchInsertReceipts,
  batchUpdateShops,
  executeInTransaction,
  processInChunks,
  type JobCompletionData,
  type PixelReceiptData,
  type BatchResult,
  
  // Audit repository
  createAuditLogEntry,
  batchCreateAuditLogs,
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
  
  // Cached queries
  getCachedShop,
  getCachedShopWithConfigs,
  invalidateShopWithConfigsCache,
  getCachedAlertConfigs,
  invalidateAlertConfigsCache,
  getCachedMonthlyUsage,
  invalidateMonthlyUsageCache,
  clearAllCaches,
  getCacheStats,
} from "../../services/db";

