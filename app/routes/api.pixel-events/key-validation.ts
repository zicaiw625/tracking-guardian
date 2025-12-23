/**
 * Pixel Events API - Key Validation
 *
 * Ingestion key validation logic.
 */

import { getShopForVerification, timingSafeEquals, verifyWithGraceWindow, type ShopVerificationData } from "../../utils/shop-access";
import { isDevMode } from "../../utils/origin-validation";
import { trackAnomaly } from "../../utils/rate-limiter";
import { logger } from "../../utils/logger.server";
import type { KeyValidationResult } from "./types";

// =============================================================================
// Shop Lookup
// =============================================================================

/**
 * Get shop data for verification.
 */
export async function getShopForPixelVerification(
  shopDomain: string
): Promise<ShopVerificationData | null> {
  return getShopForVerification(shopDomain);
}

// =============================================================================
// Key Validation
// =============================================================================

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
 * Validate the ingestion key against shop's secret.
 */
export function validateIngestionKey(ctx: KeyValidationContext): KeyValidationOutcome {
  const { shop, ingestionKey } = ctx;

  // Case 1: Shop has no ingestion secret configured
  if (!shop.ingestionSecret) {
    if (!isDevMode()) {
      logger.warn(`Rejected: Shop ${shop.shopDomain} has no ingestion key configured`);
      return { type: "missing_key_prod", shopDomain: shop.shopDomain };
    }

    // Allow in dev mode
    logger.info(
      `[DEV] Shop ${shop.shopDomain} has no ingestion key configured - allowing request`
    );
    return {
      type: "valid",
      result: { matched: false, reason: "shop_no_key_configured_dev" },
    };
  }

  // Case 2: Request has no ingestion key
  if (!ingestionKey) {
    const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
    if (anomalyCheck.shouldBlock) {
      logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
    }
    logger.warn(`Dropped: Pixel request from ${shop.shopDomain} missing ingestion key`);
    return { type: "missing_key_request", shopDomain: shop.shopDomain };
  }

  // Case 3: Verify key with grace window for rotation
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

  // Case 4: Key mismatch
  const anomalyCheck = trackAnomaly(shop.shopDomain, "invalid_key");
  if (anomalyCheck.shouldBlock) {
    logger.warn(`Circuit breaker triggered for ${shop.shopDomain}: ${anomalyCheck.reason}`);
  }
  logger.warn(`Dropped: Ingestion key mismatch for shop ${shop.shopDomain}`);
  return { type: "key_mismatch", shopDomain: shop.shopDomain };
}

