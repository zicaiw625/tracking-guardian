/**
 * Simple In-Memory Cache Utility
 * 
 * Provides short-term caching for frequently called functions.
 * Uses LRU eviction and automatic TTL expiration.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple LRU cache with TTL support.
 */
export class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTtlMs: number;

  constructor(options: { maxSize?: number; defaultTtlMs?: number } = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize || 1000;
    this.defaultTtlMs = options.defaultTtlMs || 60 * 1000; // 1 minute default
  }

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
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

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this.defaultTtlMs),
    });
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size;
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

    return removed;
  }
}

/**
 * Create a memoized version of an async function with caching.
 * 
 * @param fn - The async function to memoize
 * @param options - Cache options
 * @returns Memoized function
 */
export function memoizeAsync<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: {
    /** Generate cache key from arguments */
    keyFn: (...args: TArgs) => string;
    /** Cache instance to use (or creates a new one) */
    cache?: SimpleCache<TResult>;
    /** TTL in milliseconds */
    ttlMs?: number;
    /** Max cache size */
    maxSize?: number;
  }
): (...args: TArgs) => Promise<TResult> {
  const cache = options.cache || new SimpleCache<TResult>({
    maxSize: options.maxSize || 1000,
    defaultTtlMs: options.ttlMs || 60 * 1000,
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
 * Create a memoized version of a sync function with caching.
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
  const cache = options.cache || new SimpleCache<TResult>({
    maxSize: options.maxSize || 1000,
    defaultTtlMs: options.ttlMs || 60 * 1000,
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
// Singleton Cache Instances for Common Use Cases
// =============================================================================

/**
 * Cache for billing gate results.
 * Short TTL (30 seconds) to avoid stale data affecting billing.
 */
export const billingCache = new SimpleCache<{
  allowed: boolean;
  reason?: string;
  usage: { current: number; limit: number };
}>({
  maxSize: 1000,
  defaultTtlMs: 30 * 1000,
});

/**
 * Cache for shop configurations.
 * Moderate TTL (5 minutes) for relatively stable data.
 */
export const shopConfigCache = new SimpleCache<{
  id: string;
  shopDomain: string;
  plan: string;
  consentStrategy: string;
  piiEnabled: boolean;
  isActive: boolean;
}>({
  maxSize: 500,
  defaultTtlMs: 5 * 60 * 1000,
});

/**
 * Clear all caches. Useful for testing or when data needs to be refreshed.
 */
export function clearAllCaches(): void {
  billingCache.clear();
  shopConfigCache.clear();
}

/**
 * Periodic cleanup of all caches. Should be called from cron.
 */
export function cleanupCaches(): { billing: number; shopConfig: number } {
  return {
    billing: billingCache.cleanup(),
    shopConfig: shopConfigCache.cleanup(),
  };
}

