import {
  getShopForVerification,
  getShopForVerificationWithConfigs,
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
  const cached = await getCachedShopWithConfigs(shopDomain);
  if (cached !== undefined) {
    return cached;
  }
  const encrypted = await getShopForVerificationWithConfigsEncrypted(shopDomain, environment || "live");
  if (encrypted) {
    await cacheShopWithConfigsEncrypted(shopDomain, encrypted);
    return decryptShopWithPixelConfigs(encrypted);
  }
  await cacheShopWithConfigsEncrypted(shopDomain, null);
  return null;
}
