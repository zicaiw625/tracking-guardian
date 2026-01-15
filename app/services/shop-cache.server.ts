import { RedisCache, SimpleCache, TTL } from "../utils/cache";
import { logger } from "../utils/logger.server";
import type { ShopVerificationData, ShopVerificationDataEncrypted, ShopWithPixelConfigs, ShopWithPixelConfigsEncrypted } from "../utils/shop-access";
import { decryptShopWithPixelConfigs, decryptShopVerificationData } from "../utils/shop-access";

interface ShopWithPixelConfigsWithoutSecrets {
  id: string;
  shopDomain: string;
  isActive: boolean;
  primaryDomain: string | null;
  storefrontDomains: string[];
  pixelConfigs: Array<{
    platform: string;
    id: string;
    platformId: string | null;
    clientConfig: unknown;
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
  }>;
}

interface ShopVerificationDataWithoutSecrets {
  id: string;
  shopDomain: string;
  isActive: boolean;
  previousSecretExpiry: Date | null;
  primaryDomain: string | null;
  storefrontDomains: string[];
}

const shopVerificationCacheMemory = new SimpleCache<ShopVerificationDataEncrypted>({
  maxSize: 1000,
  defaultTtlMs: TTL.VERY_SHORT,
});

const shopVerificationCacheRedis = new RedisCache<ShopVerificationDataWithoutSecrets>({
  prefix: "shop:verify:",
  defaultTtlMs: TTL.SHORT,
  useRedis: true,
});

const shopWithConfigsCacheRedis = new RedisCache<ShopWithPixelConfigsWithoutSecrets>({
  prefix: "shop:configs:",
  defaultTtlMs: TTL.SHORT,
  useRedis: true,
});

const shopWithConfigsCacheMemory = new SimpleCache<ShopWithPixelConfigsEncrypted>({
  maxSize: 1000,
  defaultTtlMs: TTL.VERY_SHORT,
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
    const memoryCached = shopVerificationCacheMemory.get(key);
    if (memoryCached !== undefined) {
      if (memoryCached === null) {
        return null;
      }
      return decryptShopVerificationData(memoryCached);
    }
    return undefined;
  } catch (error) {
    logger.warn("Failed to get cached shop verification", { shopDomain, error });
    return undefined;
  }
}

export async function cacheShopVerificationEncrypted(
  shopDomain: string,
  data: ShopVerificationDataEncrypted | null,
  ttlMs?: number
): Promise<void> {
  const key = getVerificationKey(shopDomain);
  try {
    if (data === null) {
      shopVerificationCacheMemory.delete(key);
      await shopVerificationCacheRedis.delete(key);
    } else {
      const withoutSecrets: ShopVerificationDataWithoutSecrets = {
        id: data.id,
        shopDomain: data.shopDomain,
        isActive: data.isActive,
        previousSecretExpiry: data.previousSecretExpiry,
        primaryDomain: data.primaryDomain,
        storefrontDomains: data.storefrontDomains,
      };
      await shopVerificationCacheRedis.set(key, withoutSecrets, ttlMs);
      shopVerificationCacheMemory.set(key, data, TTL.VERY_SHORT);
    }
  } catch (error) {
    logger.warn("Failed to cache shop verification", { shopDomain, error });
  }
}

export async function invalidateShopVerification(shopDomain: string): Promise<void> {
  const key = getVerificationKey(shopDomain);
  try {
    await shopVerificationCacheRedis.delete(key);
    shopVerificationCacheMemory.delete(key);
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
    const memoryCached = shopWithConfigsCacheMemory.get(key);
    if (memoryCached !== undefined) {
      if (memoryCached === null) {
        return null;
      }
      return decryptShopWithPixelConfigs(memoryCached);
    }
    return undefined;
  } catch (error) {
    logger.warn("Failed to get cached shop configs", { shopDomain, error });
    return undefined;
  }
}

export async function cacheShopWithConfigsEncrypted(
  shopDomain: string,
  data: ShopWithPixelConfigsEncrypted | null,
  ttlMs?: number
): Promise<void> {
  const key = getConfigsKey(shopDomain);
  try {
    if (data === null) {
      shopWithConfigsCacheMemory.delete(key);
      await shopWithConfigsCacheRedis.delete(key);
    } else {
      const withoutSecrets: ShopWithPixelConfigsWithoutSecrets = {
        id: data.id,
        shopDomain: data.shopDomain,
        isActive: data.isActive,
        primaryDomain: data.primaryDomain,
        storefrontDomains: data.storefrontDomains,
        pixelConfigs: data.pixelConfigs,
      };
      await shopWithConfigsCacheRedis.set(key, withoutSecrets, ttlMs);
      shopWithConfigsCacheMemory.set(key, data, TTL.VERY_SHORT);
    }
  } catch (error) {
    logger.warn("Failed to cache shop configs", { shopDomain, error });
  }
}

export async function invalidateShopConfigs(shopDomain: string): Promise<void> {
  const key = getConfigsKey(shopDomain);
  try {
    await shopWithConfigsCacheRedis.delete(key);
    shopWithConfigsCacheMemory.delete(key);
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
  const { getShopForVerificationWithConfigsEncrypted } = await import("../utils/shop-access");
  for (let i = 0; i < shopDomains.length; i += batchSize) {
    const batch = shopDomains.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (domain) => {
        const data = await getShopFn(domain);
        if (data) {
          const encrypted = await getShopForVerificationWithConfigsEncrypted(domain);
          if (encrypted) {
            await cacheShopWithConfigsEncrypted(domain, encrypted);
          }
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
