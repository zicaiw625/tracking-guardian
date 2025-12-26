/**
 * Cache Infrastructure
 *
 * P2-1: Centralized caching layer with Redis support.
 */

// Redis client
export {
  getRedisClient,
  getRedisClientSync,
  getRedisConnectionInfo,
  closeRedisConnection,
  RedisClientFactory,
  type RedisClientWrapper,
  type ConnectionInfo,
} from "../../utils/redis-client";

// In-memory cache
export {
  SimpleCache,
  RedisCache,
  memoize,
  memoizeAsync,
  clearAllCaches,
  cleanupCaches,
  getCacheStats,
  invalidateShopCaches,
  warmCache,
  warmRedisCache,
  registerCacheWarmer,
  runCacheWarmers,
  
  // Cache instances
  billingCache,
  shopConfigCache,
  pixelConfigCache,
  secretCache,
  
  // Cache utilities
  TTL,
  CACHE_NAMESPACES,
  CacheKeyBuilder,
  CacheKeys,
  
  // Types
  type CacheOptions,
  type CacheStats,
  type ShopConfigCacheEntry,
  type CacheWarmerOptions,
  type CacheWarmEntry,
  type CacheWarmResult,
} from "../../utils/cache";

// Rate limiting (cache-based)
export {
  withRateLimit,
  checkRateLimitAsync,
  checkRateLimitSync,
  getRateLimitStoreSize,
  clearRateLimitStore,
  getRateLimitBackendInfo,
  getMemoryRateLimitStoreSize,
  ipKeyExtractor,
  shopKeyExtractor,
  pathIpKeyExtractor,
  pathShopKeyExtractor,
  standardRateLimit,
  strictRateLimit,
  webhookRateLimit,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitedHandler,
} from "../../middleware/rate-limit";

// Circuit breaker
export {
  checkCircuitBreaker,
  tripCircuitBreaker,
  resetCircuitBreaker,
  getCircuitBreakerState,
  isCircuitBreakerTripped,
  getCircuitBreakerStats,
  type CircuitBreakerConfig,
  type CircuitBreakerState,
  type CircuitBreakerResult,
} from "../../utils/circuit-breaker";

