/**
 * Shop Repository
 *
 * Centralized data access layer for Shop entities.
 * Provides caching, query optimization, and type-safe operations.
 *
 * Uses DI container for database access.
 */

import { getDb } from "../../container";
import { shopConfigCache, SimpleCache } from "../../utils/cache";
import type { PixelConfig } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal shop fields for most operations.
 */
export interface ShopBasic {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string | null;
  piiEnabled: boolean;
  isActive: boolean;
}

/**
 * Shop with all pixel configurations.
 */
export interface ShopWithPixels extends ShopBasic {
  pixelConfigs: PixelConfig[];
  primaryDomain: string | null;
  storefrontDomains: string[] | null;
}

/**
 * Shop with billing information.
 */
export interface ShopWithBilling extends ShopBasic {
  monthlyConversionCount: number;
  billingCycleStart: Date | null;
}

// =============================================================================
// Cache Instances
// =============================================================================

// Cache for shop + pixel configs (used in conversion processing)
const shopWithPixelsCache = new SimpleCache<ShopWithPixels | null>({
  maxSize: 500,
  defaultTtlMs: 2 * 60 * 1000, // 2 minutes
});

// Cache for shop domain lookups
const shopByDomainCache = new SimpleCache<string | null>({
  maxSize: 1000,
  defaultTtlMs: 10 * 60 * 1000, // 10 minutes (domains rarely change)
});

// =============================================================================
// Select Fields
// =============================================================================

const SHOP_BASIC_SELECT = {
  id: true,
  shopDomain: true,
  plan: true,
  consentStrategy: true,
  piiEnabled: true,
  isActive: true,
} as const;

const SHOP_WITH_PIXELS_SELECT = {
  ...SHOP_BASIC_SELECT,
  primaryDomain: true,
  storefrontDomains: true,
  pixelConfigs: {
    where: { isActive: true },
  },
} as const;

const SHOP_WITH_BILLING_SELECT = {
  ...SHOP_BASIC_SELECT,
  monthlyConversionCount: true,
  billingCycleStart: true,
} as const;

// =============================================================================
// Repository Functions
// =============================================================================

/**
 * Get shop by ID with basic fields.
 */
export async function getShopById(shopId: string): Promise<ShopBasic | null> {
  const cached = shopConfigCache.get(`shop:${shopId}`);
  if (cached !== undefined) {
    return cached as ShopBasic;
  }

  const shop = await getDb().shop.findUnique({
    where: { id: shopId },
    select: SHOP_BASIC_SELECT,
  });

  if (shop) {
    shopConfigCache.set(`shop:${shopId}`, shop as ShopBasic);
  }

  return shop as ShopBasic | null;
}

/**
 * Get shop ID by domain (cached heavily since domain->ID mapping rarely changes).
 */
export async function getShopIdByDomain(domain: string): Promise<string | null> {
  const normalizedDomain = domain.toLowerCase().trim();
  const cacheKey = `domain:${normalizedDomain}`;
  
  const cached = shopByDomainCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const shop = await getDb().shop.findUnique({
    where: { shopDomain: normalizedDomain },
    select: { id: true },
  });

  const shopId = shop?.id ?? null;
  shopByDomainCache.set(cacheKey, shopId);
  return shopId;
}

/**
 * Get shop with pixel configurations (for conversion processing).
 */
export async function getShopWithPixels(shopId: string): Promise<ShopWithPixels | null> {
  const cacheKey = `shop-pixels:${shopId}`;
  const cached = shopWithPixelsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const shop = await getDb().shop.findUnique({
    where: { id: shopId },
    select: SHOP_WITH_PIXELS_SELECT,
  });

  if (!shop) {
    shopWithPixelsCache.set(cacheKey, null);
    return null;
  }

  const result: ShopWithPixels = {
    ...shop,
    storefrontDomains: shop.storefrontDomains as string[] | null,
  };

  shopWithPixelsCache.set(cacheKey, result);
  return result;
}

/**
 * Get shop with billing information.
 */
export async function getShopWithBilling(shopId: string): Promise<ShopWithBilling | null> {
  // Not cached - billing data needs to be fresh
  const shop = await getDb().shop.findUnique({
    where: { id: shopId },
    select: SHOP_WITH_BILLING_SELECT,
  });

  return shop as ShopWithBilling | null;
}

/**
 * Batch fetch multiple shops by ID.
 * Returns a Map for O(1) lookup.
 */
export async function batchGetShops(shopIds: string[]): Promise<Map<string, ShopBasic>> {
  if (shopIds.length === 0) return new Map();

  const uniqueIds = [...new Set(shopIds)];
  const result = new Map<string, ShopBasic>();
  const uncachedIds: string[] = [];

  // Check cache first
  for (const id of uniqueIds) {
    const cached = shopConfigCache.get(`shop:${id}`);
    if (cached !== undefined) {
      result.set(id, cached as ShopBasic);
    } else {
      uncachedIds.push(id);
    }
  }

  // Fetch uncached
  if (uncachedIds.length > 0) {
    const shops = await getDb().shop.findMany({
      where: { id: { in: uncachedIds } },
      select: SHOP_BASIC_SELECT,
    });

    for (const shop of shops) {
      const basic = shop as ShopBasic;
      result.set(shop.id, basic);
      shopConfigCache.set(`shop:${shop.id}`, basic);
    }
  }

  return result;
}

/**
 * Batch fetch multiple shops with their pixel configs.
 */
export async function batchGetShopsWithPixels(
  shopIds: string[]
): Promise<Map<string, ShopWithPixels>> {
  if (shopIds.length === 0) return new Map();

  const uniqueIds = [...new Set(shopIds)];
  const result = new Map<string, ShopWithPixels>();
  const uncachedIds: string[] = [];

  // Check cache
  for (const id of uniqueIds) {
    const cached = shopWithPixelsCache.get(`shop-pixels:${id}`);
    if (cached !== undefined && cached !== null) {
      result.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  // Fetch uncached
  if (uncachedIds.length > 0) {
    const shops = await getDb().shop.findMany({
      where: { id: { in: uncachedIds } },
      select: SHOP_WITH_PIXELS_SELECT,
    });

    for (const shop of shops) {
      const withPixels: ShopWithPixels = {
        ...shop,
        storefrontDomains: shop.storefrontDomains as string[] | null,
      };
      result.set(shop.id, withPixels);
      shopWithPixelsCache.set(`shop-pixels:${shop.id}`, withPixels);
    }
  }

  return result;
}

/**
 * Invalidate cache for a specific shop.
 */
export function invalidateShopCache(shopId: string): void {
  shopConfigCache.delete(`shop:${shopId}`);
  shopWithPixelsCache.delete(`shop-pixels:${shopId}`);
}

/**
 * Invalidate cache for a shop by domain.
 */
export function invalidateShopCacheByDomain(domain: string): void {
  const normalizedDomain = domain.toLowerCase().trim();
  shopByDomainCache.delete(`domain:${normalizedDomain}`);
}

/**
 * Clear all shop caches.
 */
export function clearShopCaches(): void {
  shopConfigCache.clear();
  shopWithPixelsCache.clear();
  shopByDomainCache.clear();
}

// =============================================================================
// Query Monitoring
// =============================================================================

interface SlowQueryLog {
  query: string;
  params?: unknown;
  durationMs: number;
  timestamp: Date;
}

const slowQueryLogs: SlowQueryLog[] = [];
const SLOW_QUERY_THRESHOLD_MS = 100;
const MAX_SLOW_QUERY_LOGS = 100;

/**
 * Log slow queries for monitoring.
 */
function logSlowQuery(query: string, durationMs: number, params?: unknown): void {
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    slowQueryLogs.push({
      query,
      params,
      durationMs,
      timestamp: new Date(),
    });

    // Keep only the most recent logs
    if (slowQueryLogs.length > MAX_SLOW_QUERY_LOGS) {
      slowQueryLogs.shift();
    }

    console.warn(`[SLOW QUERY] ${query} took ${durationMs}ms`, { params });
  }
}

/**
 * Get recent slow query logs.
 */
export function getSlowQueryLogs(): SlowQueryLog[] {
  return [...slowQueryLogs];
}

/**
 * Clear slow query logs.
 */
export function clearSlowQueryLogs(): void {
  slowQueryLogs.length = 0;
}

/**
 * Wrap a database operation with timing.
 */
async function withTiming<T>(
  queryName: string,
  operation: () => Promise<T>,
  params?: unknown
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    const durationMs = Date.now() - start;
    logSlowQuery(queryName, durationMs, params);
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    logSlowQuery(`${queryName} (ERROR)`, durationMs, params);
    throw error;
  }
}

// =============================================================================
// Enhanced Batch Operations
// =============================================================================

/**
 * Chunked batch fetch for large ID lists.
 * Prevents query size limits from being exceeded.
 */
export async function chunkedBatchGetShops(
  shopIds: string[],
  chunkSize: number = 100
): Promise<Map<string, ShopBasic>> {
  const result = new Map<string, ShopBasic>();

  for (let i = 0; i < shopIds.length; i += chunkSize) {
    const chunk = shopIds.slice(i, i + chunkSize);
    const chunkResult = await batchGetShops(chunk);

    for (const [id, shop] of chunkResult) {
      result.set(id, shop);
    }
  }

  return result;
}

// =============================================================================
// Query Performance Helpers
// =============================================================================

/**
 * Prefetch and cache shops for upcoming operations.
 */
export async function prefetchShops(shopIds: string[]): Promise<void> {
  await batchGetShops(shopIds);
}

/**
 * Prefetch and cache shops with pixel configs.
 */
export async function prefetchShopsWithPixels(shopIds: string[]): Promise<void> {
  await batchGetShopsWithPixels(shopIds);
}

/**
 * Get cache hit rate statistics.
 */
export function getShopCacheStats(): {
  shopConfig: { hits: number; misses: number; hitRate: number };
  shopWithPixels: { hits: number; misses: number; hitRate: number };
  shopByDomain: { hits: number; misses: number; hitRate: number };
} {
  const shopStats = shopConfigCache.getStats();
  const pixelStats = shopWithPixelsCache.getStats();
  const domainStats = shopByDomainCache.getStats();

  const calcHitRate = (hits: number, misses: number) =>
    hits + misses > 0 ? hits / (hits + misses) : 0;

  return {
    shopConfig: {
      hits: shopStats.hits,
      misses: shopStats.misses,
      hitRate: calcHitRate(shopStats.hits, shopStats.misses),
    },
    shopWithPixels: {
      hits: pixelStats.hits,
      misses: pixelStats.misses,
      hitRate: calcHitRate(pixelStats.hits, pixelStats.misses),
    },
    shopByDomain: {
      hits: domainStats.hits,
      misses: domainStats.misses,
      hitRate: calcHitRate(domainStats.hits, domainStats.misses),
    },
  };
}
