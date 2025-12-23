/**
 * Library Exports
 *
 * Centralized exports for utility libraries and helpers.
 */

// =============================================================================
// Result Type Helpers
// =============================================================================

export {
  // Database operation helpers
  wrapDbOperation,
  wrapDbFindRequired,
  // API operation helpers
  wrapApiCall,
  // JSON parsing helpers
  parseJson,
  parseJsonSafe,
  // Batch operation helpers
  collectResults,
  collectAllResults,
  // Response helpers
  resultToResponse,
  resultToJson,
  // Conditional helpers
  executeIf,
  chain,
  // Logging helpers
  logResult,
  // Re-exports
  ok,
  err,
  isOk,
  isErr,
} from "./result-helpers";

export type { Result, AsyncResult } from "./result-helpers";

// =============================================================================
// Route Handlers
// =============================================================================

export {
  createActionHandler,
  createLoaderHandler,
  createPublicActionHandler,
  createWebhookHandler,
  createValidator,
  composeValidators,
  type AuthContext,
  type ActionHandlerConfig,
  type LoaderHandlerConfig,
  type PublicHandlerConfig,
  type WebhookHandlerConfig,
} from "./route-handler";

// =============================================================================
// Caching Utilities
// =============================================================================

export {
  // Loader/Action wrappers
  withCache,
  withCacheInvalidation,
  withConditionalCache,
  // Key generation
  createUrlCacheKey,
  // Cache management
  invalidateCache,
  invalidateCachePattern,
  getCacheStats,
  clearCache,
  // Response helpers
  cachedJson,
  noCacheJson,
  // Direct cache access
  defaultLoaderCache,
  // Types
  type CacheKeyFn,
  type CacheInvalidateFn,
  type LoaderCacheOptions,
  type ActionCacheOptions,
  type ConditionalCacheOptions,
} from "./with-cache";

