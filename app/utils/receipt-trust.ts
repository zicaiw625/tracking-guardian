import { logger } from "./logger.server";
import { SHOPIFY_ALLOWLIST, extractOriginHost as extractOriginHostFromValidation, buildShopAllowedDomains as buildShopAllowedDomainsFromValidation } from "./origin-validation";

export { extractOriginHostFromValidation as extractOriginHost };

export function buildShopAllowedDomains(myshopifyDomain: string, primaryDomain?: string | null, customDomains?: string[]): string[] {
    return buildShopAllowedDomainsFromValidation({
        shopDomain: myshopifyDomain,
        primaryDomain,
        storefrontDomains: customDomains,
    });
}
export type TrustLevel = "trusted" | "partial" | "untrusted";

export type UntrustedReason = "missing_checkout_token" | "checkout_token_mismatch" | "missing_origin" | "invalid_origin" | "timestamp_mismatch" | "receipt_too_old" | "time_skew_exceeded" | "hmac_signature_invalid" | "order_not_found" | "receipt_not_found";
export interface ReceiptTrustResult {
    trusted: boolean;
    level: TrustLevel;
    reason?: UntrustedReason;
    details?: string;
}
export interface VerifyReceiptOptions {
    receiptCheckoutToken: string | null | undefined;
    webhookCheckoutToken: string | null | undefined;
    receiptOriginHost?: string | null;
    allowedDomains?: string[];
    clientCreatedAt?: Date | null;
    serverCreatedAt?: Date | null;
    ingestionKeyMatched: boolean;
    receiptExists: boolean;
    options?: {
        strictOriginValidation?: boolean;
        allowNullOrigin?: boolean;
        maxReceiptAgeMs?: number;
        maxTimeSkewMs?: number;
    };
}
const DEFAULT_MAX_RECEIPT_AGE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_TIME_SKEW_MS = 15 * 60 * 1000;
export function verifyReceiptTrust(options: VerifyReceiptOptions): ReceiptTrustResult {
    const { receiptCheckoutToken, webhookCheckoutToken, receiptOriginHost, allowedDomains, clientCreatedAt, serverCreatedAt, ingestionKeyMatched, receiptExists, options: validationOptions, } = options;
    const strictOriginValidation = validationOptions?.strictOriginValidation ?? false;
    const allowNullOrigin = validationOptions?.allowNullOrigin ?? true;
    const maxReceiptAgeMs = validationOptions?.maxReceiptAgeMs ?? DEFAULT_MAX_RECEIPT_AGE_MS;
    const maxTimeSkewMs = validationOptions?.maxTimeSkewMs ?? DEFAULT_MAX_TIME_SKEW_MS;
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
            reason: "hmac_signature_invalid",
            details: "HMAC signature validation failed (previously called ingestion_key_invalid)",
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
    if (strictOriginValidation && allowedDomains && allowedDomains.length > 0) {
        if (!receiptOriginHost) {
            if (allowNullOrigin) {
                logger.debug("Origin is null, allowed by allowNullOrigin setting");
            }
            else {
                return {
                    trusted: false,
                    level: "partial",
                    reason: "missing_origin",
                    details: "No origin header in request for strict validation (null origin not allowed)",
                };
            }
        }
        else {
            const isAllowedOrigin = allowedDomains.some(domain => {
                const normalizedDomain = domain.toLowerCase();
                const normalizedOrigin = receiptOriginHost.toLowerCase();
                return normalizedOrigin === normalizedDomain ||
                    normalizedOrigin.endsWith(`.${normalizedDomain}`);
            });
            const isShopifyPlatform = SHOPIFY_ALLOWLIST.some(domain => {
                const normalizedOrigin = receiptOriginHost.toLowerCase();
                return normalizedOrigin === domain || normalizedOrigin.endsWith(`.${domain}`);
            });
            if (!isAllowedOrigin && !isShopifyPlatform) {
                return {
                    trusted: false,
                    level: "partial",
                    reason: "invalid_origin",
                    details: `Origin ${receiptOriginHost} not in allowed domains`,
                };
            }
        }
    }
    if (serverCreatedAt && maxReceiptAgeMs > 0) {
        const now = Date.now();
        const receiptAge = now - serverCreatedAt.getTime();
        if (receiptAge > maxReceiptAgeMs) {
            logger.debug("Receipt too old", {
                receiptAge,
                maxReceiptAgeMs,
                serverCreatedAt: serverCreatedAt.toISOString(),
            });
            return {
                trusted: false,
                level: "partial",
                reason: "receipt_too_old",
                details: `Receipt is ${Math.round(receiptAge / 1000)}s old, exceeds ${Math.round(maxReceiptAgeMs / 1000)}s limit`,
            };
        }
    }
    if (clientCreatedAt && serverCreatedAt && maxTimeSkewMs > 0) {
        const timeSkew = Math.abs(clientCreatedAt.getTime() - serverCreatedAt.getTime());
        if (timeSkew > maxTimeSkewMs) {
            logger.debug("Time skew exceeded", {
                timeSkew,
                maxTimeSkewMs,
                clientCreatedAt: clientCreatedAt.toISOString(),
                serverCreatedAt: serverCreatedAt.toISOString(),
            });
        }
    }
    return {
        trusted: true,
        level: "trusted",
    };
}
export function isSendAllowedByTrust(trustResult: ReceiptTrustResult, platform: string, platformCategory: "marketing" | "analytics", consentStrategy: string): {
    allowed: boolean;
    reason: string;
} {
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
export function buildTrustMetadata(trustResult: ReceiptTrustResult, additionalContext?: Record<string, unknown>): Record<string, unknown> {
    return {
        trustLevel: trustResult.level,
        trusted: trustResult.trusted,
        ...(trustResult.reason && { untrustedReason: trustResult.reason }),
        ...(trustResult.details && { trustDetails: trustResult.details }),
        ...additionalContext,
        verifiedAt: new Date().toISOString(),
    };
}

