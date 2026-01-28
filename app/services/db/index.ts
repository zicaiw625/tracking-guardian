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

export {
  getShopPixelConfigs,
  getPixelConfigByPlatform,
  getPixelConfigById,
  getPixelConfigSummaries,
  upsertPixelConfig,
  deactivatePixelConfig,
  deletePixelConfig,
  batchGetPixelConfigs,
  hasEnabledPixelConfigs,
  getConfiguredPlatforms,
  invalidatePixelConfigCache,
  clearPixelConfigCache,
  type PixelConfigCredentials,
  type PixelConfigFull,
  type PixelConfigSummary,
  type PixelConfigInput,
} from "./pixel-config-repository.server";


export {
  batchCompleteJobs,
  batchInsertReceipts,
  batchUpdateShops,
  executeInTransaction,
  processInChunks,
  type JobCompletionData,
  type PixelReceiptData,
  type BatchResult,
} from "./batch-operations.server";

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
