import {
  getShopForVerification,
  getShopForVerificationWithConfigsEncrypted,
  decryptShopWithPixelConfigs,
  type ShopVerificationData,
  type ShopWithPixelConfigs,
} from "../../utils/shop-access";
import {
  getCachedShopWithConfigs,
  cacheShopWithConfigsEncrypted,
} from "../../services/shop-cache.server";

export async function getShopForPixelVerification(
  shopDomain: string
): Promise<ShopVerificationData | null> {
  return getShopForVerification(shopDomain);
}

export async function getShopForPixelVerificationWithConfigs(
  shopDomain: string,
  environment?: "test" | "live"
): Promise<ShopWithPixelConfigs | null> {
  const effectiveEnvironment = environment || "live";
  const cached = await getCachedShopWithConfigs(shopDomain, effectiveEnvironment);
  if (cached !== undefined) {
    return cached;
  }
  const encrypted = await getShopForVerificationWithConfigsEncrypted(shopDomain, effectiveEnvironment);
  if (encrypted) {
    await cacheShopWithConfigsEncrypted(shopDomain, encrypted, undefined, effectiveEnvironment);
    return decryptShopWithPixelConfigs(encrypted);
  }
  await cacheShopWithConfigsEncrypted(shopDomain, null, undefined, effectiveEnvironment);
  return null;
}
