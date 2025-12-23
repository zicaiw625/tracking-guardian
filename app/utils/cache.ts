/**
 * Enhanced Cache Utility
 *
 * Provides caching with support for:
 * - In-memory LRU cache with TTL
 * - Redis-backed cache for multi-instance deployments
 * - Stale-while-revalidate pattern
 * - Cache warming and invalidation
 */

import { getRedisClient, type RedisClientWrapper } from "./redis-client";
import { logger } from "./logger.server";

// =============================================================================
// Types
// =============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleAt?: number;
}

export interface CacheOptions {
  /** Maximum entries in memory cache */
  maxSize?: number;
  /** Default TTL in milliseconds */
  defaultTtlMs?: number;
  /** Stale-while-revalidate window in milliseconds */
  staleWindowMs?: number;
  /** Key prefix for namespacing */
  prefix?: string;
  /** Use Redis if available */
  useRedis?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  size: number;
}

// =============================================================================
// TTL Presets
// =============================================================================

export const TTL = {
  /** Very short cache for high-frequency updates (30 seconds) */
  VERY_SHORT: 30 * 1000,
  /** Short cache for billing/usage data (1 minute) */
  SHORT: 60 * 1000,
  /** Medium cache for configs (5 minutes) */
  MEDIUM: 5 * 60 * 1000,
  /** Long cache for static data (15 minutes) */
  LONG: 15 * 60 * 1000,
  /** Very long cache for rarely changing data (1 hour) */
  VERY_LONG: 60 * 60 * 1000,
} as const;

// =============================================================================
// Simple In-Memory Cache
// =============================================================================

/**
 * LRU cache with TTL and stale-while-revalidate support.
 */
export class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTtlMs: number;
  private staleWindowMs: number;
  private stats: CacheStats;

  constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtlMs = options.defaultTtlMs ?? TTL.SHORT;
    this.staleWindowMs = options.staleWindowMs ?? 0;
    this.stats = { hits: 0, misses: 0, staleHits: 0, size: 0 };
  }

  /**
   * Get a value from the cache.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    const now = Date.now();

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if completely expired
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      return undefined;
    }

    // Move to end for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Check if stale (but still valid for revalidation)
    if (entry.staleAt && now > entry.staleAt) {
      this.stats.staleHits++;
    } else {
      this.stats.hits++;
    }

    return entry.value;
  }

  /**
   * Check if a value is stale (needs refresh but still usable).
   */
  isStale(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry || !entry.staleAt) return false;
    return Date.now() > entry.staleAt;
  }

  /**
   * Set a value in the cache.
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;

    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      staleAt: this.staleWindowMs > 0 ? now + (ttl - this.staleWindowMs) : undefined,
    });

    this.stats.size = this.cache.size;
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    this.stats.size = this.cache.size;
    return result;
  }

  /**
   * Delete all keys matching a pattern.
   */
  deletePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, staleHits: 0, size: this.cache.size };
  }

  /**
   * Clean up expired entries.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    this.stats.size = this.cache.size;
    return removed;
  }

  /**
   * Get all keys (for debugging).
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// =============================================================================
// Redis-Backed Cache
// =============================================================================

/**
 * Cache that uses Redis for storage (falls back to in-memory).
 */
export class RedisCache<T> {
  private memoryCache: SimpleCache<T>;
  private prefix: string;
  private defaultTtlMs: number;
  private useRedis: boolean;

  constructor(options: CacheOptions = {}) {
    this.memoryCache = new SimpleCache<T>(options);
    this.prefix = options.prefix ?? "tg:cache:";
    this.defaultTtlMs = options.defaultTtlMs ?? TTL.MEDIUM;
    this.useRedis = options.useRedis ?? true;
  }

  private getRedisKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Get a value from cache (checks Redis first, then memory).
   */
  async get(key: string): Promise<T | undefined> {
    // Check memory cache first
    const memValue = this.memoryCache.get(key);
    if (memValue !== undefined) {
      return memValue;
    }

    // Try Redis if enabled
    if (this.useRedis) {
      try {
        const client = await getRedisClient();
        const redisValue = await client.get(this.getRedisKey(key));

        if (redisValue) {
          const parsed = JSON.parse(redisValue) as T;
          // Populate memory cache
          this.memoryCache.set(key, parsed);
          return parsed;
        }
      } catch (error) {
        logger.debug("Redis cache get error", { key, error });
      }
    }

    return undefined;
  }

  /**
   * Set a value in cache (writes to both Redis and memory).
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;

    // Set in memory cache
    this.memoryCache.set(key, value, ttl);

    // Set in Redis if enabled
    if (this.useRedis) {
      try {
        const client = await getRedisClient();
        const ttlSeconds = Math.ceil(ttl / 1000);
        await client.set(this.getRedisKey(key), JSON.stringify(value), { EX: ttlSeconds });
      } catch (error) {
        logger.debug("Redis cache set error", { key, error });
      }
    }
  }

  /**
   * Delete a key from cache.
   */
  async delete(key: string): Promise<boolean> {
    const memDeleted = this.memoryCache.delete(key);

    if (this.useRedis) {
      try {
        const client = await getRedisClient();
        await client.del(this.getRedisKey(key));
      } catch (error) {
        logger.debug("Redis cache delete error", { key, error });
      }
    }

    return memDeleted;
  }

  /**
   * Delete all keys matching a pattern.
   */
  async deletePattern(pattern: string): Promise<number> {
    const memCount = this.memoryCache.deletePattern(pattern);

    if (this.useRedis) {
      try {
        const client = await getRedisClient();
        const keys = await client.keys(`${this.prefix}${pattern}`);
        for (const key of keys) {
          await client.del(key);
        }
      } catch (error) {
        logger.debug("Redis cache deletePattern error", { pattern, error });
      }
    }

    return memCount;
  }

  /**
   * Clear all entries.
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (this.useRedis) {
      try {
        const client = await getRedisClient();
        const keys = await client.keys(`${this.prefix}*`);
        for (const key of keys) {
          await client.del(key);
        }
      } catch (error) {
        logger.debug("Redis cache clear error", { error });
      }
    }
  }

  /**
   * Get or set a value (cache-aside pattern).
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlMs);
    return value;
  }
}

// =============================================================================
// Memoization Helpers
// =============================================================================

/**
 * Create a memoized async function.
 */
export function memoizeAsync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: {
    keyFn: (...args: TArgs) => string;
    cache?: SimpleCache<TResult>;
    ttlMs?: number;
    maxSize?: number;
  }
): (...args: TArgs) => Promise<TResult> {
  const cache =
    options.cache ??
    new SimpleCache<TResult>({
      maxSize: options.maxSize ?? 1000,
      defaultTtlMs: options.ttlMs ?? TTL.SHORT,
    });

  return async function memoized(...args: TArgs): Promise<TResult> {
    const key = options.keyFn(...args);

    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = await fn(...args);
    cache.set(key, result, options.ttlMs);
    return result;
  };
}

/**
 * Create a memoized sync function.
 */
export function memoize<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  options: {
    keyFn: (...args: TArgs) => string;
    cache?: SimpleCache<TResult>;
    ttlMs?: number;
    maxSize?: number;
  }
): (...args: TArgs) => TResult {
  const cache =
    options.cache ??
    new SimpleCache<TResult>({
      maxSize: options.maxSize ?? 1000,
      defaultTtlMs: options.ttlMs ?? TTL.SHORT,
    });

  return function memoized(...args: TArgs): TResult {
    const key = options.keyFn(...args);

    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = fn(...args);
    cache.set(key, result, options.ttlMs);
    return result;
  };
}

// =============================================================================
// Singleton Cache Instances
// =============================================================================

/**
 * Cache for billing gate results.
 */
export const billingCache = new SimpleCache<{
  allowed: boolean;
  reason?: string;
  usage: { current: number; limit: number };
}>({
  maxSize: 1000,
  defaultTtlMs: TTL.VERY_SHORT,
});

/**
 * Shop configuration cache entry type.
 * Matches ShopBasic from shop-repository.server.ts.
 */
export interface ShopConfigCacheEntry {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string | null;
  piiEnabled: boolean;
  isActive: boolean;
}

/**
 * Cache for shop configurations.
 */
export const shopConfigCache = new SimpleCache<ShopConfigCacheEntry>({
  maxSize: 500,
  defaultTtlMs: TTL.MEDIUM,
});

/**
 * Cache for pixel configurations.
 */
export const pixelConfigCache = new SimpleCache<{
  id: string;
  platform: string;
  platformId: string | null;
  isActive: boolean;
  serverSideEnabled: boolean;
}>({
  maxSize: 500,
  defaultTtlMs: TTL.MEDIUM,
});

/**
 * Cache for ingestion secrets (for fast validation).
 */
export const secretCache = new SimpleCache<{
  ingestionSecret: string;
  storefrontDomains: string[];
}>({
  maxSize: 1000,
  defaultTtlMs: TTL.SHORT,
});

// =============================================================================
// Global Cache Operations
// =============================================================================

/**
 * Clear all caches.
 */
export function clearAllCaches(): void {
  billingCache.clear();
  shopConfigCache.clear();
  pixelConfigCache.clear();
  secretCache.clear();
}

/**
 * Clean up all caches.
 */
export function cleanupCaches(): Record<string, number> {
  return {
    billing: billingCache.cleanup(),
    shopConfig: shopConfigCache.cleanup(),
    pixelConfig: pixelConfigCache.cleanup(),
    secret: secretCache.cleanup(),
  };
}

/**
 * Get statistics for all caches.
 */
export function getCacheStats(): Record<string, CacheStats> {
  return {
    billing: billingCache.getStats(),
    shopConfig: shopConfigCache.getStats(),
    pixelConfig: pixelConfigCache.getStats(),
    secret: secretCache.getStats(),
  };
}

/**
 * Invalidate shop-related caches.
 */
export function invalidateShopCaches(shopDomain: string): void {
  shopConfigCache.delete(shopDomain);
  billingCache.delete(shopDomain);
  pixelConfigCache.deletePattern(`${shopDomain}:*`);
  secretCache.delete(shopDomain);
}

// =============================================================================
// Type-Safe Cache Key Builders
// =============================================================================

/**
 * Cache key namespace configuration.
 */
export const CACHE_NAMESPACES = {
  BILLING: "billing",
  SHOP_CONFIG: "shop",
  PIXEL_CONFIG: "pixel",
  SECRET: "secret",
  SHOP_PIXEL: "shop-pixels",
  SHOP_DOMAIN: "shop-domain",
  USAGE: "usage",
} as const;

type CacheNamespace = typeof CACHE_NAMESPACES[keyof typeof CACHE_NAMESPACES];

/**
 * Type-safe cache key builder.
 * Provides compile-time safety and consistency for cache key generation.
 */
export class CacheKeyBuilder {
  private namespace: CacheNamespace;

  constructor(namespace: CacheNamespace) {
    this.namespace = namespace;
  }

  /**
   * Build a simple key with one identifier.
   */
  simple(id: string): string {
    return `${this.namespace}:${id}`;
  }

  /**
   * Build a composite key with multiple identifiers.
   */
  composite(...parts: string[]): string {
    return `${this.namespace}:${parts.join(":")}`;
  }

  /**
   * Build a key with a type suffix.
   */
  typed(id: string, type: string): string {
    return `${this.namespace}:${id}:${type}`;
  }

  /**
   * Build a pattern for matching multiple keys.
   */
  pattern(prefix: string = ""): string {
    return `${this.namespace}:${prefix}*`;
  }
}

/**
 * Pre-configured cache key builders for each namespace.
 */
export const CacheKeys = {
  billing: new CacheKeyBuilder(CACHE_NAMESPACES.BILLING),
  shopConfig: new CacheKeyBuilder(CACHE_NAMESPACES.SHOP_CONFIG),
  pixelConfig: new CacheKeyBuilder(CACHE_NAMESPACES.PIXEL_CONFIG),
  secret: new CacheKeyBuilder(CACHE_NAMESPACES.SECRET),
  shopPixels: new CacheKeyBuilder(CACHE_NAMESPACES.SHOP_PIXEL),
  shopDomain: new CacheKeyBuilder(CACHE_NAMESPACES.SHOP_DOMAIN),
  usage: new CacheKeyBuilder(CACHE_NAMESPACES.USAGE),
} as const;

// =============================================================================
// Cache Warming Infrastructure
// =============================================================================

/**
 * Cache warmer options.
 */
export interface CacheWarmerOptions {
  /** Maximum concurrent warming operations */
  concurrency?: number;
  /** Whether to log warming progress */
  verbose?: boolean;
  /** Error handler */
  onError?: (key: string, error: unknown) => void;
}

/**
 * Cache warm entry definition.
 */
export interface CacheWarmEntry<T> {
  key: string;
  factory: () => Promise<T>;
  ttlMs?: number;
}

/**
 * Cache warming result.
 */
export interface CacheWarmResult {
  success: number;
  failed: number;
  errors: Array<{ key: string; error: string }>;
  durationMs: number;
}

/**
 * Warm cache with multiple entries.
 */
export async function warmCache<T>(
  cache: SimpleCache<T>,
  entries: CacheWarmEntry<T>[],
  options: CacheWarmerOptions = {}
): Promise<CacheWarmResult> {
  const { concurrency = 5, verbose = false, onError } = options;
  const startTime = Date.now();

  let success = 0;
  let failed = 0;
  const errors: Array<{ key: string; error: string }> = [];

  // Process in batches
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          const value = await entry.factory();
          cache.set(entry.key, value, entry.ttlMs);
          return { key: entry.key, success: true };
        } catch (error) {
          throw { key: entry.key, error };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        success++;
        if (verbose) {
          logger.debug(`Cache warmed: ${result.value.key}`);
        }
      } else {
        failed++;
        const { key, error } = result.reason as { key: string; error: unknown };
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ key, error: errorMessage });
        onError?.(key, error);
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (verbose) {
    logger.info(`Cache warming completed`, {
      success,
      failed,
      durationMs,
    });
  }

  return { success, failed, errors, durationMs };
}

/**
 * Warm Redis-backed cache with multiple entries.
 */
export async function warmRedisCache<T>(
  cache: RedisCache<T>,
  entries: CacheWarmEntry<T>[],
  options: CacheWarmerOptions = {}
): Promise<CacheWarmResult> {
  const { concurrency = 5, verbose = false, onError } = options;
  const startTime = Date.now();

  let success = 0;
  let failed = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          const value = await entry.factory();
          await cache.set(entry.key, value, entry.ttlMs);
          return { key: entry.key, success: true };
        } catch (error) {
          throw { key: entry.key, error };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        success++;
        if (verbose) {
          logger.debug(`Redis cache warmed: ${result.value.key}`);
        }
      } else {
        failed++;
        const { key, error } = result.reason as { key: string; error: unknown };
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ key, error: errorMessage });
        onError?.(key, error);
      }
    }
  }

  const durationMs = Date.now() - startTime;

  if (verbose) {
    logger.info(`Redis cache warming completed`, {
      success,
      failed,
      durationMs,
    });
  }

  return { success, failed, errors, durationMs };
}

// =============================================================================
// Cache Warming Registration
// =============================================================================

type WarmupFactory = () => Promise<CacheWarmResult>;

const registeredWarmers: Map<string, WarmupFactory> = new Map();

/**
 * Register a cache warmer for startup.
 */
export function registerCacheWarmer(name: string, factory: WarmupFactory): void {
  registeredWarmers.set(name, factory);
}

/**
 * Run all registered cache warmers.
 */
export async function runCacheWarmers(): Promise<Record<string, CacheWarmResult>> {
  const results: Record<string, CacheWarmResult> = {};

  for (const [name, factory] of registeredWarmers) {
    try {
      results[name] = await factory();
      logger.info(`Cache warmer "${name}" completed`, { name, ...results[name] });
    } catch (error) {
      logger.error(`Cache warmer "${name}" failed`, error);
      results[name] = {
        success: 0,
        failed: 1,
        errors: [{ key: name, error: String(error) }],
        durationMs: 0,
      };
    }
  }

  return results;
}
