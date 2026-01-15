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
