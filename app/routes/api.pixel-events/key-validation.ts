import {
  getShopForVerification,
  getShopForVerificationWithConfigs,
  type ShopVerificationData,
  type ShopWithPixelConfigs,
} from "../../utils/shop-access";
import {
  getCachedShopWithConfigs,
  cacheShopWithConfigs,
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

  const cacheKey = environment ? `${shopDomain}:${environment}` : `${shopDomain}:live`;
  const cached = await getCachedShopWithConfigs(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const shop = await getShopForVerificationWithConfigs(shopDomain, environment || "live");

  await cacheShopWithConfigs(cacheKey, shop);

  return shop;
}
