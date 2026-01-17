import { getDb } from "../../container";
import { shopConfigCache, SimpleCache } from "../../utils/cache";
import type { PixelConfig } from "@prisma/client";
import { logger } from "../../utils/logger.server";

export interface ShopBasic {
  id: string;
  shopDomain: string;
  plan: string | null;
  consentStrategy: string | null;
  isActive: boolean;
}

export interface ShopWithPixels extends ShopBasic {
  pixelConfigs: PixelConfig[];
  primaryDomain: string | null;
  storefrontDomains: string[] | null;
}

export interface ShopWithBilling extends ShopBasic {
  monthlyConversionCount: number;
  billingCycleStart: Date | null;
}

const CACHE_TTL_SHOP_PIXELS_MS = 2 * 60 * 1000;
const CACHE_TTL_SHOP_BY_DOMAIN_MS = 10 * 60 * 1000;
const CACHE_MAX_SIZE_SHOP = 500;
const CACHE_MAX_SIZE_DOMAIN = 1000;

const shopWithPixelsCache = new SimpleCache<ShopWithPixels | null>({
  maxSize: CACHE_MAX_SIZE_SHOP,
  defaultTtlMs: CACHE_TTL_SHOP_PIXELS_MS,
});

const shopByDomainCache = new SimpleCache<string | null>({
  maxSize: CACHE_MAX_SIZE_DOMAIN,
  defaultTtlMs: CACHE_TTL_SHOP_BY_DOMAIN_MS,
});

const SHOP_BASIC_SELECT = {
  id: true,
  shopDomain: true,
  plan: true,
  consentStrategy: true,
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

const CACHE_KEY_PREFIX_SHOP = "shop";
const CACHE_KEY_PREFIX_SHOP_PIXELS = "shop-pixels";
const CACHE_KEY_PREFIX_DOMAIN = "domain";

function buildShopCacheKey(shopId: string): string {
  return `${CACHE_KEY_PREFIX_SHOP}:${shopId}`;
}

function buildShopPixelsCacheKey(shopId: string): string {
  return `${CACHE_KEY_PREFIX_SHOP_PIXELS}:${shopId}`;
}

function buildDomainCacheKey(domain: string): string {
  return `${CACHE_KEY_PREFIX_DOMAIN}:${domain}`;
}

export async function getShopById(shopId: string): Promise<ShopBasic | null> {
  const cacheKey = buildShopCacheKey(shopId);
  const cached = shopConfigCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const shop = await getDb().shop.findUnique({
    where: { id: shopId },
    select: SHOP_BASIC_SELECT,
  });
  if (shop) {
    shopConfigCache.set(cacheKey, shop);
  }
  return shop;
}

export async function getShopIdByDomain(domain: string): Promise<string | null> {
  const normalizedDomain = domain.toLowerCase().trim();
  const cacheKey = buildDomainCacheKey(normalizedDomain);
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

export async function getShopWithPixels(shopId: string): Promise<ShopWithPixels | null> {
  const cacheKey = buildShopPixelsCacheKey(shopId);
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
  const storefrontDomains = Array.isArray(shop.storefrontDomains) ? shop.storefrontDomains : null;
  const result: ShopWithPixels = {
    ...shop,
    storefrontDomains,
  };
  shopWithPixelsCache.set(cacheKey, result);
  return result;
}

export async function getShopWithBilling(shopId: string): Promise<ShopWithBilling | null> {
  const shop = await getDb().shop.findUnique({
    where: { id: shopId },
    select: SHOP_WITH_BILLING_SELECT,
  });
  return shop;
}

const BATCH_QUERY_CHUNK_SIZE = 100;

export async function batchGetShops(shopIds: string[]): Promise<Map<string, ShopBasic>> {
  if (shopIds.length === 0) return new Map();
  const uniqueIds = [...new Set(shopIds)];
  const result = new Map<string, ShopBasic>();
  const uncachedIds: string[] = [];
  for (const id of uniqueIds) {
    const cacheKey = buildShopCacheKey(id);
    const cached = shopConfigCache.get(cacheKey);
    if (cached !== undefined) {
      result.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < uncachedIds.length; i += BATCH_QUERY_CHUNK_SIZE) {
      chunks.push(uncachedIds.slice(i, i + BATCH_QUERY_CHUNK_SIZE));
    }
    const shopPromises = chunks.map(chunk =>
      getDb().shop.findMany({
        where: { id: { in: chunk } },
        select: SHOP_BASIC_SELECT,
      })
    );
    const shopsArrays = await Promise.all(shopPromises);
    const shops = shopsArrays.flat();
    for (const shop of shops) {
      result.set(shop.id, shop);
      shopConfigCache.set(buildShopCacheKey(shop.id), shop);
    }
  }
  return result;
}

export async function batchGetShopsWithPixels(
  shopIds: string[]
): Promise<Map<string, ShopWithPixels>> {
  if (shopIds.length === 0) return new Map();
  const uniqueIds = [...new Set(shopIds)];
  const result = new Map<string, ShopWithPixels>();
  const uncachedIds: string[] = [];
  for (const id of uniqueIds) {
    const cacheKey = buildShopPixelsCacheKey(id);
    const cached = shopWithPixelsCache.get(cacheKey);
    if (cached !== undefined && cached !== null) {
      result.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < uncachedIds.length; i += BATCH_QUERY_CHUNK_SIZE) {
      chunks.push(uncachedIds.slice(i, i + BATCH_QUERY_CHUNK_SIZE));
    }
    const shopPromises = chunks.map(chunk =>
      getDb().shop.findMany({
        where: { id: { in: chunk } },
        select: SHOP_WITH_PIXELS_SELECT,
      })
    );
    const shopsArrays = await Promise.all(shopPromises);
    const shops = shopsArrays.flat();
    for (const shop of shops) {
      const storefrontDomains = Array.isArray(shop.storefrontDomains) ? shop.storefrontDomains : null;
      const withPixels: ShopWithPixels = {
        ...shop,
        storefrontDomains,
      };
      result.set(shop.id, withPixels);
      shopWithPixelsCache.set(buildShopPixelsCacheKey(shop.id), withPixels);
    }
  }
  return result;
}

export function invalidateShopCache(shopId: string): void {
  shopConfigCache.delete(buildShopCacheKey(shopId));
  shopWithPixelsCache.delete(buildShopPixelsCacheKey(shopId));
}

export function invalidateShopCacheByDomain(domain: string): void {
  const normalizedDomain = domain.toLowerCase().trim();
  const domainCacheKey = buildDomainCacheKey(normalizedDomain);
  const shopId = shopByDomainCache.get(domainCacheKey);
  shopByDomainCache.delete(domainCacheKey);
  if (shopId) {
    shopConfigCache.delete(buildShopCacheKey(shopId));
    shopWithPixelsCache.delete(buildShopPixelsCacheKey(shopId));
  }
}

export function clearShopCaches(): void {
  shopConfigCache.clear();
  shopWithPixelsCache.clear();
  shopByDomainCache.clear();
}

interface SlowQueryLog {
  query: string;
  params?: unknown;
  durationMs: number;
  timestamp: Date;
}

const slowQueryLogs: SlowQueryLog[] = [];
const SLOW_QUERY_THRESHOLD_MS = 100;
const MAX_SLOW_QUERY_LOGS = 100;

function logSlowQuery(query: string, durationMs: number, params?: unknown): void {
  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    slowQueryLogs.push({
      query,
      params,
      durationMs,
      timestamp: new Date(),
    });
    if (slowQueryLogs.length > MAX_SLOW_QUERY_LOGS) {
      slowQueryLogs.shift();
    }
    logger.warn(`[SLOW QUERY] ${query} took ${durationMs}ms`, { params });
  }
}

export function getSlowQueryLogs(): SlowQueryLog[] {
  return [...slowQueryLogs];
}

export function clearSlowQueryLogs(): void {
  slowQueryLogs.length = 0;
}

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

export async function prefetchShops(shopIds: string[]): Promise<void> {
  await batchGetShops(shopIds);
}

export async function prefetchShopsWithPixels(shopIds: string[]): Promise<void> {
  await batchGetShopsWithPixels(shopIds);
}

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
