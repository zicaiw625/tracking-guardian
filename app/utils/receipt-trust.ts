/**
 * P0-1 & P1-2: Receipt Trust Verification Module
 * 
 * This module provides a centralized definition of "trusted request"
 * for pixel event receipts. A receipt is considered trusted when:
 * 
 * 1. Ingestion key matches (basic authentication)
 * 2. Checkout token binds to webhook order (proof of legitimate order)
 * 3. Timestamp is within acceptable window
 * 4. Origin is from allowed storefront domain (when enforced)
 * 
 * Trust levels:
 * - trusted: Full verification passed, safe for marketing platforms
 * - partial: Ingestion key matched but checkout token not verified
 * - untrusted: Failed verification, only analytics (with consent) allowed
 */

import { logger } from "./logger";

export type TrustLevel = "trusted" | "partial" | "untrusted";

export type UntrustedReason =
  | "missing_checkout_token"
  | "checkout_token_mismatch"
  | "missing_origin"
  | "invalid_origin"
  | "timestamp_mismatch"
  | "ingestion_key_missing"
  | "ingestion_key_invalid"
  | "order_not_found"
  | "receipt_not_found";

export interface ReceiptTrustResult {
  trusted: boolean;
  level: TrustLevel;
  reason?: UntrustedReason;
  details?: string;
}

export interface VerifyReceiptOptions {
  /** Checkout token from pixel event receipt */
  receiptCheckoutToken: string | null | undefined;
  /** Checkout token from webhook order payload */
  webhookCheckoutToken: string | null | undefined;
  /** Origin host from the pixel event request */
  originHost?: string | null;
  /** Allowed storefront domains for the shop */
  allowedDomains?: string[];
  /** Timestamp from pixel event */
  pixelTimestamp?: number;
  /** Timestamp from webhook */
  webhookTimestamp?: number;
  /** Whether ingestion key was validated */
  ingestionKeyMatched: boolean;
  /** Whether the receipt exists */
  receiptExists: boolean;
  /** Whether origin validation is strict (production mode) */
  strictOriginValidation?: boolean;
}

/**
 * Maximum time difference allowed between pixel and webhook timestamps (5 minutes)
 */
const MAX_TIMESTAMP_DIFF_MS = 5 * 60 * 1000;

/**
 * Verify a pixel event receipt against webhook data to determine trust level.
 * 
 * This is the single source of truth for receipt trust determination.
 * Use this function instead of checking individual flags.
 */
export function verifyReceiptTrust(options: VerifyReceiptOptions): ReceiptTrustResult {
  const {
    receiptCheckoutToken,
    webhookCheckoutToken,
    originHost,
    allowedDomains,
    pixelTimestamp,
    webhookTimestamp,
    ingestionKeyMatched,
    receiptExists,
    strictOriginValidation = false,
  } = options;

  // Step 1: Check if receipt exists
  if (!receiptExists) {
    return {
      trusted: false,
      level: "untrusted",
      reason: "receipt_not_found",
      details: "No pixel event receipt found for this order",
    };
  }

  // Step 2: Check ingestion key
  if (!ingestionKeyMatched) {
    return {
      trusted: false,
      level: "untrusted",
      reason: "ingestion_key_invalid",
      details: "Ingestion key validation failed",
    };
  }

  // Step 3: Check checkout token binding (critical for trust)
  if (!receiptCheckoutToken) {
    return {
      trusted: false,
      level: "partial",
      reason: "missing_checkout_token",
      details: "Receipt has no checkoutToken for verification",
    };
  }

  if (!webhookCheckoutToken) {
    // Webhook might not have checkout_token in some edge cases
    return {
      trusted: false,
      level: "partial",
      reason: "missing_checkout_token",
      details: "Webhook order has no checkout_token for verification",
    };
  }

  // P0-1: Core security check - checkout token must match
  if (receiptCheckoutToken !== webhookCheckoutToken) {
    logger.warn("Checkout token mismatch detected", {
      receiptToken: receiptCheckoutToken.substring(0, 8) + "...",
      webhookToken: webhookCheckoutToken.substring(0, 8) + "...",
    });
    return {
      trusted: false,
      level: "untrusted",
      reason: "checkout_token_mismatch",
      details: "Checkout token does not match webhook order",
    };
  }

  // Step 4: Optional timestamp consistency check
  if (pixelTimestamp && webhookTimestamp) {
    const timeDiff = Math.abs(pixelTimestamp - webhookTimestamp);
    if (timeDiff > MAX_TIMESTAMP_DIFF_MS) {
      logger.debug("Timestamp difference exceeds threshold", {
        pixelTimestamp,
        webhookTimestamp,
        diffMs: timeDiff,
      });
      // This is a soft warning, not a hard failure
      // Orders might be placed and paid at different times
    }
  }

  // Step 5: Optional origin validation (when strict mode enabled)
  if (strictOriginValidation && allowedDomains && allowedDomains.length > 0) {
    if (!originHost) {
      return {
        trusted: false,
        level: "partial",
        reason: "missing_origin",
        details: "No origin header in request for strict validation",
      };
    }

    const isAllowedOrigin = allowedDomains.some(domain => 
      originHost === domain || originHost.endsWith(`.${domain}`)
    );

    if (!isAllowedOrigin) {
      return {
        trusted: false,
        level: "partial",
        reason: "invalid_origin",
        details: `Origin ${originHost} not in allowed domains`,
      };
    }
  }

  // All checks passed - fully trusted
  return {
    trusted: true,
    level: "trusted",
  };
}

/**
 * P0-4: Determine if a platform send is allowed based on receipt trust
 * and consent strategy.
 * 
 * @param trustResult - Result from verifyReceiptTrust
 * @param platform - Platform name (google, meta, tiktok)
 * @param platformCategory - Platform category (marketing or analytics)
 * @param consentStrategy - Shop's consent strategy (strict, balanced, weak)
 */
export function isSendAllowedByTrust(
  trustResult: ReceiptTrustResult,
  platform: string,
  platformCategory: "marketing" | "analytics",
  consentStrategy: string
): { allowed: boolean; reason: string } {
  // Weak strategy: always allow
  if (consentStrategy === "weak") {
    return { allowed: true, reason: "weak_consent_mode" };
  }

  // Strict strategy: require full trust for all platforms
  if (consentStrategy === "strict") {
    if (!trustResult.trusted || trustResult.level !== "trusted") {
      return {
        allowed: false,
        reason: `strict_mode_requires_trust:${trustResult.reason || "not_fully_trusted"}`,
      };
    }
    return { allowed: true, reason: "strict_mode_trust_verified" };
  }

  // Balanced strategy: marketing requires trust, analytics is more permissive
  if (consentStrategy === "balanced") {
    if (platformCategory === "marketing") {
      // Marketing platforms require at least partial trust
      if (trustResult.level === "untrusted") {
        return {
          allowed: false,
          reason: `balanced_mode_marketing_untrusted:${trustResult.reason}`,
        };
      }
      return { allowed: true, reason: "balanced_mode_marketing_ok" };
    }

    // Analytics platforms: allow even with partial trust
    if (trustResult.level !== "untrusted") {
      return { allowed: true, reason: "balanced_mode_analytics_ok" };
    }

    // Untrusted: still allow analytics but log it
    logger.debug(`Allowing analytics platform ${platform} despite untrusted receipt`);
    return { allowed: true, reason: "balanced_mode_analytics_fallback" };
  }

  // Default: require trust
  return {
    allowed: trustResult.trusted,
    reason: trustResult.trusted ? "default_trusted" : `default_untrusted:${trustResult.reason}`,
  };
}

/**
 * Build a trust metadata object for storing in ConversionLog/Job
 */
export function buildTrustMetadata(
  trustResult: ReceiptTrustResult,
  additionalContext?: Record<string, unknown>
): Record<string, unknown> {
  return {
    trustLevel: trustResult.level,
    trusted: trustResult.trusted,
    ...(trustResult.reason && { untrustedReason: trustResult.reason }),
    ...(trustResult.details && { trustDetails: trustResult.details }),
    ...additionalContext,
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * P0-2: Extract and normalize origin host from Origin header
 */
export function extractOriginHost(origin: string | null): string | null {
  if (!origin || origin === "null") {
    return null;
  }

  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * P0-2: Build allowed domains list for a shop
 */
export function buildShopAllowedDomains(
  myshopifyDomain: string,
  primaryDomain?: string | null,
  customDomains?: string[]
): string[] {
  const domains = new Set<string>();
  
  // Always allow the myshopify domain
  domains.add(myshopifyDomain);
  
  // Add primary domain if set
  if (primaryDomain) {
    domains.add(primaryDomain);
  }
  
  // Add any custom domains
  if (customDomains) {
    customDomains.forEach(d => domains.add(d));
  }
  
  // Always allow Shopify checkout domains
  domains.add("checkout.shopify.com");
  
  return Array.from(domains);
}

