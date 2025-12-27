

import { RedisCache, SimpleCache, TTL } from "../utils/cache";
import { logger } from "../utils/logger.server";
import type { ShopVerificationData, ShopWithPixelConfigs } from "../utils/shop-access";

const shopVerificationCache = new RedisCache<ShopVerificationData>({
  prefix: "shop:verify:",
  defaultTtlMs: TTL.SHORT,
  useRedis: true,
});

const shopWithConfigsCache = new RedisCache<ShopWithPixelConfigs>({
  prefix: "shop:configs:",
  defaultTtlMs: TTL.SHORT,
  useRedis: true,
});

const billingCheckCache = new SimpleCache<{
  allowed: boolean;
  reason?: string;
  usage: { current: number; limit: number };
}>({
  maxSize: 1000,
  defaultTtlMs: TTL.VERY_SHORT,
});

function getVerificationKey(shopDomain: string): string {
  return shopDomain.toLowerCase();
}

function getConfigsKey(shopDomain: string): string {
  return shopDomain.toLowerCase();
}

function getBillingKey(shopId: string, yearMonth: string): string {
  return `${shopId}:${yearMonth}`;
}

export async function getCachedShopVerification(
  shopDomain: string
): Promise<ShopVerificationData | null | undefined> {
  const key = getVerificationKey(shopDomain);
  try {
    return await shopVerificationCache.get(key);
  } catch (error) {
    logger.warn("Failed to get cached shop verification", { shopDomain, error });
    return undefined;
  }
}

export async function cacheShopVerification(
  shopDomain: string,
  data: ShopVerificationData | null,
  ttlMs?: number
): Promise<void> {
  const key = getVerificationKey(shopDomain);
  try {
    if (data === null) {

      await shopVerificationCache.set(key, null as unknown as ShopVerificationData, TTL.VERY_SHORT);
    } else {
      await shopVerificationCache.set(key, data, ttlMs);
    }
  } catch (error) {
    logger.warn("Failed to cache shop verification", { shopDomain, error });
  }
}

export async function invalidateShopVerification(shopDomain: string): Promise<void> {
  const key = getVerificationKey(shopDomain);
  try {
    await shopVerificationCache.delete(key);
    logger.debug("Invalidated shop verification cache", { shopDomain });
  } catch (error) {
    logger.warn("Failed to invalidate shop verification cache", { shopDomain, error });
  }
}

export async function getCachedShopWithConfigs(
  shopDomain: string
): Promise<ShopWithPixelConfigs | null | undefined> {
  const key = getConfigsKey(shopDomain);
  try {
    return await shopWithConfigsCache.get(key);
  } catch (error) {
    logger.warn("Failed to get cached shop configs", { shopDomain, error });
    return undefined;
  }
}

export async function cacheShopWithConfigs(
  shopDomain: string,
  data: ShopWithPixelConfigs | null,
  ttlMs?: number
): Promise<void> {
  const key = getConfigsKey(shopDomain);
  try {
    if (data === null) {
      await shopWithConfigsCache.set(key, null as unknown as ShopWithPixelConfigs, TTL.VERY_SHORT);
    } else {
      await shopWithConfigsCache.set(key, data, ttlMs);
    }
  } catch (error) {
    logger.warn("Failed to cache shop configs", { shopDomain, error });
  }
}

export async function invalidateShopConfigs(shopDomain: string): Promise<void> {
  const key = getConfigsKey(shopDomain);
  try {
    await shopWithConfigsCache.delete(key);

    await invalidateShopVerification(shopDomain);
    logger.debug("Invalidated shop configs cache", { shopDomain });
  } catch (error) {
    logger.warn("Failed to invalidate shop configs cache", { shopDomain, error });
  }
}

interface BillingCheckResult {
  allowed: boolean;
  reason?: string;
  usage: { current: number; limit: number };
}

export function getCachedBillingCheck(
  shopId: string,
  yearMonth: string
): BillingCheckResult | undefined {
  const key = getBillingKey(shopId, yearMonth);
  return billingCheckCache.get(key);
}

export function cacheBillingCheck(
  shopId: string,
  yearMonth: string,
  result: BillingCheckResult
): void {
  const key = getBillingKey(shopId, yearMonth);
  billingCheckCache.set(key, result);
}

export function invalidateBillingCache(shopId: string, yearMonth?: string): void {
  if (yearMonth) {
    const key = getBillingKey(shopId, yearMonth);
    billingCheckCache.delete(key);
  } else {

    billingCheckCache.deletePattern(`${shopId}:`);
  }
}

export async function invalidateAllShopCaches(shopDomain: string, shopId?: string): Promise<void> {
  await Promise.all([
    invalidateShopVerification(shopDomain),
    invalidateShopConfigs(shopDomain),
  ]);

  if (shopId) {
    invalidateBillingCache(shopId);
  }

  logger.info("Invalidated all caches for shop", { shopDomain, shopId });
}

export async function getShopCacheStats(): Promise<{
  verification: { available: boolean };
  configs: { available: boolean };
  billing: { size: number; hits: number; misses: number };
}> {

  return {
    verification: {
      available: true,
    },
    configs: {
      available: true,
    },
    billing: {
      size: billingCheckCache.getStats().size,
      hits: billingCheckCache.getStats().hits,
      misses: billingCheckCache.getStats().misses,
    },
  };
}

export async function warmShopCache(
  getShopFn: (domain: string) => Promise<ShopWithPixelConfigs | null>,
  shopDomains: string[]
): Promise<{ warmed: number; failed: number }> {
  let warmed = 0;
  let failed = 0;

  const batchSize = 10;
  for (let i = 0; i < shopDomains.length; i += batchSize) {
    const batch = shopDomains.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (domain) => {
        const data = await getShopFn(domain);
        if (data) {
          await cacheShopWithConfigs(domain, data);
        }
        return domain;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        warmed++;
      } else {
        failed++;
      }
    }
  }

  logger.info("Shop cache warming completed", { warmed, failed });
  return { warmed, failed };
}

