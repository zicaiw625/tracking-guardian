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
  receiptCheckoutToken: string | null | undefined;
  webhookCheckoutToken: string | null | undefined;
  originHost?: string | null;
  allowedDomains?: string[];
  pixelTimestamp?: number;
  webhookTimestamp?: number;
  ingestionKeyMatched: boolean;
  receiptExists: boolean;
  strictOriginValidation?: boolean;
}

const MAX_TIMESTAMP_DIFF_MS = 5 * 60 * 1000;

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

  if (!receiptExists) {
    return {
      trusted: false,
      level: "untrusted",
      reason: "receipt_not_found",
      details: "No pixel event receipt found for this order",
    };
  }

  if (!ingestionKeyMatched) {
    return {
      trusted: false,
      level: "untrusted",
      reason: "ingestion_key_invalid",
      details: "Ingestion key validation failed",
    };
  }

  if (!receiptCheckoutToken) {
    return {
      trusted: false,
      level: "partial",
      reason: "missing_checkout_token",
      details: "Receipt has no checkoutToken for verification",
    };
  }

  if (!webhookCheckoutToken) {
    return {
      trusted: false,
      level: "partial",
      reason: "missing_checkout_token",
      details: "Webhook order has no checkout_token for verification",
    };
  }

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

  if (pixelTimestamp && webhookTimestamp) {
    const timeDiff = Math.abs(pixelTimestamp - webhookTimestamp);
    if (timeDiff > MAX_TIMESTAMP_DIFF_MS) {
      logger.debug("Timestamp difference exceeds threshold", {
        pixelTimestamp,
        webhookTimestamp,
        diffMs: timeDiff,
      });
    }
  }

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

  return {
    trusted: true,
    level: "trusted",
  };
}

export function isSendAllowedByTrust(
  trustResult: ReceiptTrustResult,
  platform: string,
  platformCategory: "marketing" | "analytics",
  consentStrategy: string
): { allowed: boolean; reason: string } {
  if (consentStrategy === "weak") {
    return { allowed: true, reason: "weak_consent_mode" };
  }

  if (consentStrategy === "strict") {
    if (!trustResult.trusted || trustResult.level !== "trusted") {
      return {
        allowed: false,
        reason: `strict_mode_requires_trust:${trustResult.reason || "not_fully_trusted"}`,
      };
    }
    return { allowed: true, reason: "strict_mode_trust_verified" };
  }

  if (consentStrategy === "balanced") {
    if (platformCategory === "marketing") {
      if (trustResult.level === "untrusted") {
        return {
          allowed: false,
          reason: `balanced_mode_marketing_untrusted:${trustResult.reason}`,
        };
      }
      return { allowed: true, reason: "balanced_mode_marketing_ok" };
    }

    if (trustResult.level !== "untrusted") {
      return { allowed: true, reason: "balanced_mode_analytics_ok" };
    }

    logger.debug(`Allowing analytics platform ${platform} despite untrusted receipt`);
    return { allowed: true, reason: "balanced_mode_analytics_fallback" };
  }

  return {
    allowed: trustResult.trusted,
    reason: trustResult.trusted ? "default_trusted" : `default_untrusted:${trustResult.reason}`,
  };
}

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

export function buildShopAllowedDomains(
  myshopifyDomain: string,
  primaryDomain?: string | null,
  customDomains?: string[]
): string[] {
  const domains = new Set<string>();
  
  domains.add(myshopifyDomain);
  
  if (primaryDomain) {
    domains.add(primaryDomain);
  }
  
  if (customDomains) {
    customDomains.forEach(d => domains.add(d));
  }
  
  domains.add("checkout.shopify.com");
  
  return Array.from(domains);
}

