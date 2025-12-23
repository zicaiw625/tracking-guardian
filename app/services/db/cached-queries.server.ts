/**
 * Cached Database Queries
 *
 * Provides caching layer for frequently accessed database queries.
 */

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

interface CacheOptions {
  /**
   * Time to live in milliseconds
   */
  ttlMs?: number;

  /**
   * Whether to refresh in background when near expiry
   */
  staleWhileRevalidate?: boolean;
}

// =============================================================================
// Cache Implementation
// =============================================================================

const DEFAULT_TTL_MS = 60_000; // 1 minute
const STALE_THRESHOLD_MS = 10_000; // 10 seconds before expiry

/**
 * Simple in-memory cache
 */
class QueryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private pendingRefresh = new Set<string>();

  /**
   * Get cached value or fetch fresh
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { ttlMs = DEFAULT_TTL_MS, staleWhileRevalidate = true } = options;
    const now = Date.now();
    const cached = this.cache.get(key);

    // Return cached if valid
    if (cached && cached.expiry > now) {
      // Check if near expiry and trigger background refresh
      if (
        staleWhileRevalidate &&
        cached.expiry - now < STALE_THRESHOLD_MS &&
        !this.pendingRefresh.has(key)
      ) {
        this.refreshInBackground(key, fetcher, ttlMs);
      }
      return cached.data;
    }

    // Fetch fresh data
    const data = await fetcher();
    this.cache.set(key, {
      data,
      expiry: now + ttlMs,
    });

    return data;
  }

  /**
   * Refresh cache in background
   */
  private async refreshInBackground(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number
  ): Promise<void> {
    this.pendingRefresh.add(key);

    try {
      const data = await fetcher();
      this.cache.set(key, {
        data,
        expiry: Date.now() + ttlMs,
      });
    } catch (error) {
      logger.warn(`[Cache] Background refresh failed for ${key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.pendingRefresh.delete(key);
    }
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate entries matching a pattern
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.pendingRefresh.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// =============================================================================
// Cached Query Functions
// =============================================================================

// Shop cache instance
const shopCache = new QueryCache<Awaited<ReturnType<typeof fetchShop>>>();

/**
 * Fetch shop from database
 */
async function fetchShop(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      piiEnabled: true,
      consentStrategy: true,
      dataRetentionDays: true,
      isActive: true,
      shopTier: true,
      primaryDomain: true,
      storefrontDomains: true,
      ingestionSecret: true,
    },
  });
}

/**
 * Get shop with caching
 */
export async function getCachedShop(
  shopDomain: string,
  options?: CacheOptions
) {
  return shopCache.getOrFetch(
    `shop:${shopDomain}`,
    () => fetchShop(shopDomain),
    options
  );
}

/**
 * Invalidate shop cache
 */
export function invalidateShopCache(shopDomain: string): void {
  shopCache.invalidate(`shop:${shopDomain}`);
}

// =============================================================================
// Shop with Pixel Configs Cache
// =============================================================================

const shopWithConfigsCache = new QueryCache<
  Awaited<ReturnType<typeof fetchShopWithConfigs>>
>();

/**
 * Fetch shop with pixel configs from database
 */
async function fetchShopWithConfigs(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      pixelConfigs: {
        where: { isActive: true },
        select: {
          id: true,
          platform: true,
          platformId: true,
          serverSideEnabled: true,
          clientSideEnabled: true,
          isActive: true,
          credentialsEncrypted: true,
        },
      },
    },
  });
}

/**
 * Get shop with pixel configs with caching
 */
export async function getCachedShopWithConfigs(
  shopDomain: string,
  options?: CacheOptions
) {
  return shopWithConfigsCache.getOrFetch(
    `shopWithConfigs:${shopDomain}`,
    () => fetchShopWithConfigs(shopDomain),
    options
  );
}

/**
 * Invalidate shop with configs cache
 */
export function invalidateShopWithConfigsCache(shopDomain: string): void {
  shopWithConfigsCache.invalidate(`shopWithConfigs:${shopDomain}`);
}

// =============================================================================
// Alert Configs Cache
// =============================================================================

const alertConfigsCache = new QueryCache<
  Awaited<ReturnType<typeof fetchAlertConfigs>>
>();

/**
 * Fetch alert configs from database
 */
async function fetchAlertConfigs(shopId: string) {
  return prisma.alertConfig.findMany({
    where: { shopId, isEnabled: true },
    select: {
      id: true,
      channel: true,
      discrepancyThreshold: true,
      settingsEncrypted: true,
    },
  });
}

/**
 * Get alert configs with caching
 */
export async function getCachedAlertConfigs(
  shopId: string,
  options?: CacheOptions
) {
  return alertConfigsCache.getOrFetch(
    `alertConfigs:${shopId}`,
    () => fetchAlertConfigs(shopId),
    options
  );
}

/**
 * Invalidate alert configs cache
 */
export function invalidateAlertConfigsCache(shopId: string): void {
  alertConfigsCache.invalidate(`alertConfigs:${shopId}`);
}

// =============================================================================
// Monthly Usage Cache
// =============================================================================

const monthlyUsageCache = new QueryCache<
  Awaited<ReturnType<typeof fetchMonthlyUsage>>
>();

/**
 * Fetch monthly usage from database
 */
async function fetchMonthlyUsage(shopId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}-${month}`;

  return prisma.monthlyUsage.findUnique({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth,
      },
    },
  });
}

/**
 * Get monthly usage with caching
 */
export async function getCachedMonthlyUsage(
  shopId: string,
  options?: CacheOptions
) {
  const now = new Date();
  const key = `monthlyUsage:${shopId}:${now.getFullYear()}-${now.getMonth() + 1}`;

  return monthlyUsageCache.getOrFetch(
    key,
    () => fetchMonthlyUsage(shopId),
    { ttlMs: 300_000, ...options } // 5 minute cache
  );
}

/**
 * Invalidate monthly usage cache
 */
export function invalidateMonthlyUsageCache(shopId: string): void {
  monthlyUsageCache.invalidatePattern(`monthlyUsage:${shopId}`);
}

// =============================================================================
// Global Cache Management
// =============================================================================

/**
 * Clear all caches (useful for testing or maintenance)
 */
export function clearAllCaches(): void {
  shopCache.clear();
  shopWithConfigsCache.clear();
  alertConfigsCache.clear();
  monthlyUsageCache.clear();
  logger.info("[Cache] All caches cleared");
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): Record<string, { size: number; keys: string[] }> {
  return {
    shop: shopCache.getStats(),
    shopWithConfigs: shopWithConfigsCache.getStats(),
    alertConfigs: alertConfigsCache.getStats(),
    monthlyUsage: monthlyUsageCache.getStats(),
  };
}

