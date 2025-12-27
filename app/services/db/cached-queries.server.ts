

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

interface CacheOptions {

  ttlMs?: number;

  staleWhileRevalidate?: boolean;
}

const DEFAULT_TTL_MS = 60_000;
const STALE_THRESHOLD_MS = 10_000;

class QueryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private pendingRefresh = new Set<string>();

  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { ttlMs = DEFAULT_TTL_MS, staleWhileRevalidate = true } = options;
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiry > now) {

      if (
        staleWhileRevalidate &&
        cached.expiry - now < STALE_THRESHOLD_MS &&
        !this.pendingRefresh.has(key)
      ) {
        this.refreshInBackground(key, fetcher, ttlMs);
      }
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(key, {
      data,
      expiry: now + ttlMs,
    });

    return data;
  }

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

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.pendingRefresh.clear();
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

const shopCache = new QueryCache<Awaited<ReturnType<typeof fetchShop>>>();

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

export function invalidateShopCache(shopDomain: string): void {
  shopCache.invalidate(`shop:${shopDomain}`);
}

const shopWithConfigsCache = new QueryCache<
  Awaited<ReturnType<typeof fetchShopWithConfigs>>
>();

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

export function invalidateShopWithConfigsCache(shopDomain: string): void {
  shopWithConfigsCache.invalidate(`shopWithConfigs:${shopDomain}`);
}

const alertConfigsCache = new QueryCache<
  Awaited<ReturnType<typeof fetchAlertConfigs>>
>();

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

export function invalidateAlertConfigsCache(shopId: string): void {
  alertConfigsCache.invalidate(`alertConfigs:${shopId}`);
}

const monthlyUsageCache = new QueryCache<
  Awaited<ReturnType<typeof fetchMonthlyUsage>>
>();

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

export async function getCachedMonthlyUsage(
  shopId: string,
  options?: CacheOptions
) {
  const now = new Date();
  const key = `monthlyUsage:${shopId}:${now.getFullYear()}-${now.getMonth() + 1}`;

  return monthlyUsageCache.getOrFetch(
    key,
    () => fetchMonthlyUsage(shopId),
    { ttlMs: 300_000, ...options }
  );
}

export function invalidateMonthlyUsageCache(shopId: string): void {
  monthlyUsageCache.invalidatePattern(`monthlyUsage:${shopId}`);
}

export function clearAllCaches(): void {
  shopCache.clear();
  shopWithConfigsCache.clear();
  alertConfigsCache.clear();
  monthlyUsageCache.clear();
  logger.info("[Cache] All caches cleared");
}

export function getCacheStats(): Record<string, { size: number; keys: string[] }> {
  return {
    shop: shopCache.getStats(),
    shopWithConfigs: shopWithConfigsCache.getStats(),
    alertConfigs: alertConfigsCache.getStats(),
    monthlyUsage: monthlyUsageCache.getStats(),
  };
}

