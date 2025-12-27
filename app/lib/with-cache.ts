

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { SimpleCache, TTL } from "../utils/cache";
import { logger } from "../utils/logger.server";

export type CacheKeyFn = (args: LoaderFunctionArgs | ActionFunctionArgs) => string | null;

export type CacheInvalidateFn = (args: ActionFunctionArgs, result: unknown) => string[] | null;

export interface LoaderCacheOptions {

  key: CacheKeyFn;

  ttl?: number;

  staleWhileRevalidate?: boolean;

  cache?: SimpleCache<unknown>;

  methods?: string[];
}

export interface ActionCacheOptions {

  invalidate?: CacheInvalidateFn;

  cache?: SimpleCache<unknown>;
}

const defaultLoaderCache = new SimpleCache<unknown>({
  maxSize: 500,
  defaultTtlMs: TTL.MEDIUM,
});

export function withCache<T>(
  loader: (args: LoaderFunctionArgs) => Promise<Response | T>,
  options: LoaderCacheOptions
): (args: LoaderFunctionArgs) => Promise<Response | T> {
  const cache = options.cache ?? defaultLoaderCache;
  const ttl = options.ttl ?? TTL.MEDIUM;
  const methods = options.methods ?? ["GET"];

  return async (args: LoaderFunctionArgs): Promise<Response | T> => {
    const { request } = args;

    if (!methods.includes(request.method.toUpperCase())) {
      return loader(args);
    }

    const cacheKey = options.key(args);
    if (!cacheKey) {
      return loader(args);
    }

    const cached = cache.get(cacheKey) as T | Response | undefined;
    if (cached !== undefined) {
      logger.debug("Cache hit", { key: cacheKey });

      if (options.staleWhileRevalidate && cache.isStale(cacheKey)) {

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

    const result = await loader(args);

    if (result instanceof Response && result.status >= 400) {
      return result;
    }

    cache.set(cacheKey, result, ttl);
    return result;
  };
}

export function createUrlCacheKey(args: LoaderFunctionArgs): string | null {
  try {
    const url = new URL(args.request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return null;
    }

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

export function withCacheInvalidation<T>(
  action: (args: ActionFunctionArgs) => Promise<T>,
  options: ActionCacheOptions
): (args: ActionFunctionArgs) => Promise<T> {
  const cache = options.cache ?? defaultLoaderCache;

  return async (args: ActionFunctionArgs): Promise<T> => {
    const result = await action(args);

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

export function invalidateCache(keys: string | string[]): void {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    defaultLoaderCache.delete(key);
    logger.debug("Manual cache invalidation", { key });
  }
}

export function invalidateCachePattern(pattern: string): number {
  const count = defaultLoaderCache.deletePattern(pattern);
  logger.debug("Pattern cache invalidation", { pattern, count });
  return count;
}

export function getCacheStats() {
  return defaultLoaderCache.getStats();
}

export function clearCache(): void {
  defaultLoaderCache.clear();
  logger.info("Cache cleared");
}

export interface ConditionalCacheOptions extends LoaderCacheOptions {

  shouldCache?: (result: unknown) => boolean;
}

export function withConditionalCache<T>(
  loader: (args: LoaderFunctionArgs) => Promise<Response | T>,
  options: ConditionalCacheOptions
): (args: LoaderFunctionArgs) => Promise<Response | T> {
  const cache = options.cache ?? defaultLoaderCache;
  const ttl = options.ttl ?? TTL.MEDIUM;
  const shouldCache = options.shouldCache ?? (() => true);

  return async (args: LoaderFunctionArgs): Promise<Response | T> => {

    const cacheKey = options.key(args);
    if (!cacheKey) {
      return loader(args);
    }

    const cached = cache.get(cacheKey) as T | Response | undefined;
    if (cached !== undefined) {
      return cached;
    }

    const result = await loader(args);

    if (shouldCache(result)) {
      cache.set(cacheKey, result, ttl);
    }

    return result;
  };
}

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

export function noCacheJson<T>(data: T): Response {
  return json(data, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export { defaultLoaderCache };

