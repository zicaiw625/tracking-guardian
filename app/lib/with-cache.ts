/**
 * Loader/Action Cache Decorators
 *
 * Provides caching utilities for Remix loaders and actions.
 * Supports both in-memory and Redis-backed caching.
 */

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { SimpleCache, TTL } from "../utils/cache";
import { logger } from "../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

/**
 * Cache key generator function
 */
export type CacheKeyFn = (args: LoaderFunctionArgs | ActionFunctionArgs) => string | null;

/**
 * Cache invalidation function
 */
export type CacheInvalidateFn = (args: ActionFunctionArgs, result: unknown) => string[] | null;

/**
 * Loader cache options
 */
export interface LoaderCacheOptions {
  /** Cache key generator (return null to skip caching) */
  key: CacheKeyFn;
  /** Time-to-live in milliseconds */
  ttl?: number;
  /** Whether to return stale data while revalidating */
  staleWhileRevalidate?: boolean;
  /** Cache instance (uses default if not provided) */
  cache?: SimpleCache<unknown>;
  /** Request methods to cache (default: ["GET"]) */
  methods?: string[];
}

/**
 * Action cache invalidation options
 */
export interface ActionCacheOptions {
  /** Keys to invalidate after action */
  invalidate?: CacheInvalidateFn;
  /** Cache instance */
  cache?: SimpleCache<unknown>;
}

// =============================================================================
// Default Cache Instances
// =============================================================================

/**
 * Default loader cache
 */
const defaultLoaderCache = new SimpleCache<unknown>({
  maxSize: 500,
  defaultTtlMs: TTL.MEDIUM,
});

// =============================================================================
// Loader Caching
// =============================================================================

/**
 * Wrap a loader with caching
 *
 * @example
 * ```ts
 * export const loader = withCache(
 *   async ({ request }) => {
 *     const data = await fetchData();
 *     return json(data);
 *   },
 *   {
 *     key: ({ request }) => {
 *       const url = new URL(request.url);
 *       return `shop:${url.searchParams.get("shop")}`;
 *     },
 *     ttl: TTL.MEDIUM,
 *   }
 * );
 * ```
 */
export function withCache<T>(
  loader: (args: LoaderFunctionArgs) => Promise<Response | T>,
  options: LoaderCacheOptions
): (args: LoaderFunctionArgs) => Promise<Response | T> {
  const cache = options.cache ?? defaultLoaderCache;
  const ttl = options.ttl ?? TTL.MEDIUM;
  const methods = options.methods ?? ["GET"];

  return async (args: LoaderFunctionArgs): Promise<Response | T> => {
    const { request } = args;

    // Only cache specified methods
    if (!methods.includes(request.method.toUpperCase())) {
      return loader(args);
    }

    // Generate cache key
    const cacheKey = options.key(args);
    if (!cacheKey) {
      return loader(args);
    }

    // Check cache
    const cached = cache.get(cacheKey) as T | Response | undefined;
    if (cached !== undefined) {
      logger.debug("Cache hit", { key: cacheKey });

      // If stale-while-revalidate and cache is stale, refresh in background
      if (options.staleWhileRevalidate && cache.isStale(cacheKey)) {
        // Fire and forget - refresh cache in background
        loader(args)
          .then((result) => {
            cache.set(cacheKey, result, ttl);
            logger.debug("Cache refreshed (background)", { key: cacheKey });
          })
          .catch((error) => {
            logger.error("Background cache refresh failed", { key: cacheKey, error });
          });
      }

      return cached;
    }

    logger.debug("Cache miss", { key: cacheKey });

    // Execute loader and cache result
    const result = await loader(args);

    // Don't cache error responses
    if (result instanceof Response && result.status >= 400) {
      return result;
    }

    cache.set(cacheKey, result, ttl);
    return result;
  };
}

/**
 * Create a simple cache key from request URL and shop
 */
export function createUrlCacheKey(args: LoaderFunctionArgs): string | null {
  try {
    const url = new URL(args.request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return null;
    }

    // Create key from path + shop + relevant query params
    const relevantParams = ["platform", "page", "limit", "sort"];
    const params = relevantParams
      .map((p) => url.searchParams.get(p))
      .filter(Boolean)
      .join(":");

    return `${url.pathname}:${shop}${params ? `:${params}` : ""}`;
  } catch {
    return null;
  }
}

// =============================================================================
// Action Cache Invalidation
// =============================================================================

/**
 * Wrap an action with cache invalidation
 *
 * @example
 * ```ts
 * export const action = withCacheInvalidation(
 *   async ({ request }) => {
 *     await updateData(request);
 *     return json({ success: true });
 *   },
 *   {
 *     invalidate: ({ request }) => {
 *       const shop = getShopFromRequest(request);
 *       return [
 *         `shop:${shop}:settings`,
 *         `shop:${shop}:config`,
 *       ];
 *     },
 *   }
 * );
 * ```
 */
export function withCacheInvalidation<T>(
  action: (args: ActionFunctionArgs) => Promise<T>,
  options: ActionCacheOptions
): (args: ActionFunctionArgs) => Promise<T> {
  const cache = options.cache ?? defaultLoaderCache;

  return async (args: ActionFunctionArgs): Promise<T> => {
    const result = await action(args);

    // Invalidate specified keys
    if (options.invalidate) {
      const keys = options.invalidate(args, result);
      if (keys) {
        for (const key of keys) {
          cache.delete(key);
          logger.debug("Cache invalidated", { key });
        }
      }
    }

    return result;
  };
}

// =============================================================================
// Cache Management Utilities
// =============================================================================

/**
 * Manually invalidate cache entries
 */
export function invalidateCache(keys: string | string[]): void {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    defaultLoaderCache.delete(key);
    logger.debug("Manual cache invalidation", { key });
  }
}

/**
 * Invalidate all cache entries matching a pattern
 */
export function invalidateCachePattern(pattern: string): number {
  const count = defaultLoaderCache.deletePattern(pattern);
  logger.debug("Pattern cache invalidation", { pattern, count });
  return count;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return defaultLoaderCache.getStats();
}

/**
 * Clear all cached data
 */
export function clearCache(): void {
  defaultLoaderCache.clear();
  logger.info("Cache cleared");
}

// =============================================================================
// Conditional Caching
// =============================================================================

/**
 * Cache based on response content
 */
export interface ConditionalCacheOptions extends LoaderCacheOptions {
  /** Only cache if this function returns true */
  shouldCache?: (result: unknown) => boolean;
}

/**
 * Wrap loader with conditional caching
 */
export function withConditionalCache<T>(
  loader: (args: LoaderFunctionArgs) => Promise<Response | T>,
  options: ConditionalCacheOptions
): (args: LoaderFunctionArgs) => Promise<Response | T> {
  const cache = options.cache ?? defaultLoaderCache;
  const ttl = options.ttl ?? TTL.MEDIUM;
  const shouldCache = options.shouldCache ?? (() => true);

  return async (args: LoaderFunctionArgs): Promise<Response | T> => {
    // Generate cache key
    const cacheKey = options.key(args);
    if (!cacheKey) {
      return loader(args);
    }

    // Check cache
    const cached = cache.get(cacheKey) as T | Response | undefined;
    if (cached !== undefined) {
      return cached;
    }

    // Execute loader
    const result = await loader(args);

    // Conditionally cache result
    if (shouldCache(result)) {
      cache.set(cacheKey, result, ttl);
    }

    return result;
  };
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a cached JSON response with cache headers
 */
export function cachedJson<T>(
  data: T,
  options: {
    maxAge?: number;
    sMaxAge?: number;
    staleWhileRevalidate?: number;
  } = {}
): Response {
  const {
    maxAge = 0,
    sMaxAge = 60,
    staleWhileRevalidate = 300,
  } = options;

  const cacheControl = [
    maxAge > 0 ? `max-age=${maxAge}` : "no-cache",
    sMaxAge > 0 ? `s-maxage=${sMaxAge}` : null,
    staleWhileRevalidate > 0 ? `stale-while-revalidate=${staleWhileRevalidate}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return json(data, {
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * Create a no-cache JSON response
 */
export function noCacheJson<T>(data: T): Response {
  return json(data, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

// =============================================================================
// Export Cache Instance for Direct Access
// =============================================================================

export { defaultLoaderCache };


