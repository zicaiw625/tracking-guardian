export {
  wrapDbOperation,
  wrapDbFindRequired,
  wrapApiCall,
  parseJson,
  parseJsonSafe,
  collectResults,
  collectAllResults,
  resultToResponse,
  resultToJson,
  executeIf,
  chain,
  logResult,
  ok,
  err,
  isOk,
  isErr,
} from "./result-helpers";

export type { Result, AsyncResult } from "./result-helpers";

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

export {
  withCache,
  withCacheInvalidation,
  withConditionalCache,
  createUrlCacheKey,
  invalidateCache,
  invalidateCachePattern,
  getCacheStats,
  clearCache,
  cachedJson,
  noCacheJson,
  defaultLoaderCache,
  type CacheKeyFn,
  type CacheInvalidateFn,
  type LoaderCacheOptions,
  type ActionCacheOptions,
  type ConditionalCacheOptions,
} from "./with-cache";
