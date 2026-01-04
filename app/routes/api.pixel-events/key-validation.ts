

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

/**
 * P0-1: ingestionKey 验证已完全移除，完全依赖 HMAC 签名验证
 * 
 * 安全架构变更：
 * - 客户端不再在请求体中发送 ingestionKey 或 ingestionSecret
 * - 服务端不再从请求体中读取或验证 ingestionKey
 * - 所有安全验证完全依赖 HMAC 签名（X-Tracking-Guardian-Signature header）
 * - 生产环境必须提供有效的 HMAC 签名，否则请求会被拒绝（403）
 * 
 * 验证流程：
 * 1. 客户端使用 ingestionSecret 生成 HMAC 签名（基于 timestamp + body hash）
 * 2. 服务端通过 shopDomain 查找 shop.ingestionSecret
 * 3. 服务端使用相同的算法验证 HMAC 签名
 * 4. 验证通过后，生成 KeyValidationResult（matched: true, reason: "hmac_verified"）
 * 
 * 主要信任依据：HMAC 签名验证（在 route.tsx 中完成）
 */

export async function getShopForPixelVerification(
  shopDomain: string
): Promise<ShopVerificationData | null> {
  return getShopForVerification(shopDomain);
}

export async function getShopForPixelVerificationWithConfigs(
  shopDomain: string
): Promise<ShopWithPixelConfigs | null> {

  const cached = await getCachedShopWithConfigs(shopDomain);
  if (cached !== undefined) {
    return cached;
  }

  const shop = await getShopForVerificationWithConfigs(shopDomain);

  await cacheShopWithConfigs(shopDomain, shop);

  return shop;
}

