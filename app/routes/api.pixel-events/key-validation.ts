

import {
  getShopForVerification,
  getShopForVerificationWithConfigs,
  timingSafeEquals,
  verifyWithGraceWindow,
  type ShopVerificationData,
  type ShopWithPixelConfigs,
} from "../../utils/shop-access";
import {
  getCachedShopWithConfigs,
  cacheShopWithConfigs,
} from "../../services/shop-cache.server";
import { isDevMode } from "../../utils/origin-validation";
import { trackAnomaly } from "../../utils/rate-limiter";
import { logger } from "../../utils/logger.server";
import type { KeyValidationResult } from "./types";

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

/**
 * P0-4: ingestionKey 验证已废弃
 * 
 * 此文件保留用于向后兼容和 secret 轮换场景，但不再作为主要验证方式。
 * 主要信任依据已改为 HMAC 签名验证（在 route.tsx 中完成）。
 * 
 * 注意：新代码不应调用 validateIngestionKey，应直接使用 HMAC 验证结果。
 */

export interface KeyValidationContext {
  shop: ShopVerificationData;
  ingestionKey: string | null;
  shopAllowedDomains: string[];
}

export type KeyValidationOutcome =
  | { type: "valid"; result: KeyValidationResult }
  | { type: "missing_key_prod"; shopDomain: string }
  | { type: "missing_key_request"; shopDomain: string }
  | { type: "key_mismatch"; shopDomain: string };

/**
 * @deprecated P0-4: 此函数已废弃，仅用于向后兼容和 secret 轮换场景
 * 新代码应直接使用 HMAC 验证结果，不再依赖 ingestionKey 验证
 */
export function validateIngestionKey(ctx: KeyValidationContext): KeyValidationOutcome {
  const { shop, ingestionKey } = ctx;

  if (!shop.ingestionSecret) {
    if (!isDevMode()) {
      logger.warn(`Rejected: Shop ${shop.shopDomain} has no ingestion key configured`);
      return { type: "missing_key_prod", shopDomain: shop.shopDomain };
    }

    logger.info(
      `[DEV] Shop ${shop.shopDomain} has no ingestion key configured - allowing request`
    );
    return {
      type: "valid",
      result: { matched: false, reason: "shop_no_key_configured_dev" },
    };
  }

  if (!ingestionKey) {
    const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
    }
    logger.warn(`Dropped: Pixel request from ${shop.shopDomain} missing ingestion key`);
    return { type: "missing_key_request", shopDomain: shop.shopDomain };
  }

  const matchResult = verifyWithGraceWindow(shop, (secret) =>
    timingSafeEquals(secret, ingestionKey)
  );

  if (matchResult.matched) {
    return {
      type: "valid",
      result: {
        matched: true,
        reason: matchResult.usedPreviousSecret ? "matched_previous_secret" : "matched",
        usedPreviousSecret: matchResult.usedPreviousSecret,
      },
    };
  }

  const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
  if (anomalyCheck.shouldBlock) {
    logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
  }
  logger.warn(`Dropped: Ingestion key mismatch for shop ${shop.shopDomain}`);
  return { type: "key_mismatch", shopDomain: shop.shopDomain };
}

