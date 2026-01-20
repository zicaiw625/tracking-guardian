import { evaluatePlatformConsentWithStrategy, type ConsentState } from "../utils/platform-consent";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
