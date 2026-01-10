import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { evaluatePlatformConsentWithStrategy, type ConsentState } from "../utils/platform-consent";
const CONSENT_TIMEOUT_HOURS = 24;
const BATCH_SIZE = 100;
interface ConsentReconciliationResult {
    processed: number;
    resolved: number;
    expired: number;
    errors: number;
}
function evaluateConsentForPlatform(platform: string, strategy: string, consentState: ConsentState | null, hasVerifiedReceipt: boolean): {
    allowed: boolean;
    reason: string;
} {
    const decision = evaluatePlatformConsentWithStrategy(platform, strategy, consentState, hasVerifiedReceipt, false);
    return {
        allowed: decision.allowed,
        reason: decision.reason || (decision.allowed ? "consent_granted" : "consent_denied"),
    };
}
export async function reconcilePendingConsent(): Promise<ConsentReconciliationResult> {
    logger.debug(`reconcilePendingConsent called but conversionLog table no longer exists`);
    return { processed: 0, resolved: 0, expired: 0, errors: 0 };
}
export async function getConsentPendingStats(): Promise<{
    total: number;
    approaching_timeout: number;
    by_shop: Array<{
        shopDomain: string;
        count: number;
    }>;
}> {
    logger.debug(`getConsentPendingStats called but conversionLog table no longer exists`);
    return {
        total: 0,
        approaching_timeout: 0,
        by_shop: [],
    };
}
