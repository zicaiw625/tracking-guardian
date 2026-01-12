import {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  buildShopAllowedDomains,
  type ReceiptTrustResult,
} from '../utils/receipt-trust';
import {
  evaluatePlatformConsentWithStrategy,
  getEffectiveConsentCategory,
  type ConsentState,
} from '../utils/platform-consent';
import { parseConsentState } from '../types';
import type { TrustVerificationOptions } from '../types/consent';
import type { ReceiptFields } from './receipt-matcher.server';
import { SignatureStatus } from '../types/enums';
import { logger } from '../utils/logger.server';

export interface ShopTrustContext {
  shopDomain: string;
  primaryDomain: string | null;
  storefrontDomains: string[];
  consentStrategy: string;
}

export interface TrustEvaluationResult {
  trustResult: ReceiptTrustResult;
  trustMetadata: Record<string, unknown>;
  consentState: ConsentState | null;
}

export interface PlatformEligibilityResult {
  allowed: boolean;
  skipReason?: string;
  usedConsent?: string;
}

export const DEFAULT_TRUST_OPTIONS: TrustVerificationOptions = {
  strictOriginValidation: true,
  allowNullOrigin: true,
  maxReceiptAgeMs: 60 * 60 * 1000,
  maxTimeSkewMs: 15 * 60 * 1000,
};

export function evaluateTrust(
  receipt: ReceiptFields | null,
  webhookCheckoutToken: string | undefined,
  shop: ShopTrustContext
): TrustEvaluationResult {
  const shopAllowedDomains = buildShopAllowedDomains(
    shop.shopDomain,
    shop.primaryDomain,
    shop.storefrontDomains
  );
  const isHmacVerified = receipt?.signatureStatus === SignatureStatus.KEY_MATCHED ||
                         receipt?.signatureStatus === "hmac_verified";
  const trustResult = verifyReceiptTrust({
    receiptCheckoutToken: receipt?.checkoutToken,
    webhookCheckoutToken,
    ingestionKeyMatched: isHmacVerified,
    receiptExists: !!receipt,
    receiptOriginHost: receipt?.originHost,
    allowedDomains: shopAllowedDomains,
    clientCreatedAt: receipt?.pixelTimestamp,
    serverCreatedAt: receipt?.createdAt,
    options: DEFAULT_TRUST_OPTIONS,
  });
  const trustMetadata = buildTrustMetadata(trustResult, {
    hasReceipt: !!receipt,
    receiptTrustLevel: receipt?.trustLevel,
    webhookHasCheckoutToken: !!webhookCheckoutToken,
  });
  const rawConsentState = parseConsentState(receipt?.consentState);
  const consentState: ConsentState | null = rawConsentState
    ? {
        marketing: rawConsentState.marketing,
        analytics: rawConsentState.analytics,
        saleOfDataAllowed: rawConsentState.saleOfData,
      }
    : null;
  return {
    trustResult,
    trustMetadata,
    consentState,
  };
}

export function checkPlatformEligibility(
  platform: string,
  trustResult: ReceiptTrustResult,
  consentState: ConsentState | null,
  strategy: string,
  treatAsMarketing: boolean
): PlatformEligibilityResult {
  const platformCategory = getEffectiveConsentCategory(platform, treatAsMarketing);
  if (consentState?.saleOfDataAllowed === false) {
    logger.debug(`[P0-04] Platform blocked by explicit sale_of_data opt-out`, {
      platform,
    });
    return {
      allowed: false,
      skipReason: 'sale_of_data_opted_out',
    };
  }
  const trustAllowed = isSendAllowedByTrust(
    trustResult,
    platform,
    platformCategory,
    strategy
  );
  if (!trustAllowed.allowed) {
    logger.debug(`[P0-01] Platform blocked by trust check`, {
      platform,
      reason: trustAllowed.reason,
      trustLevel: trustResult.level,
    });
    return {
      allowed: false,
      skipReason: `trust_${trustAllowed.reason}`,
    };
  }
  const hasVerifiedReceipt = trustResult.trusted || trustResult.level === 'partial';
  const consentDecision = evaluatePlatformConsentWithStrategy(
    platform,
    strategy,
    consentState,
    hasVerifiedReceipt,
    treatAsMarketing
  );
  if (!consentDecision.allowed) {
    const skipReason = consentDecision.reason || 'consent_denied';
    logger.debug(`[P0-07] Platform blocked by consent check`, {
      platform,
      skipReason,
      usedConsent: consentDecision.usedConsent,
      strategy,
    });
    return {
      allowed: false,
      skipReason: skipReason.replace(/\s+/g, '_').toLowerCase(),
      usedConsent: consentDecision.usedConsent,
    };
  }
  logger.debug(`Platform consent check passed`, {
    platform,
    strategy,
    usedConsent: consentDecision.usedConsent,
    trustLevel: trustResult.level,
  });
  return {
    allowed: true,
    usedConsent: consentDecision.usedConsent,
  };
}

export function buildConsentEvidence(
  strategy: string,
  hasReceipt: boolean,
  trustResult: ReceiptTrustResult,
  consentState: ConsentState | null
): Record<string, unknown> {
  return {
    strategy,
    hasReceipt,
    receiptTrusted: trustResult.trusted,
    trustLevel: trustResult.level,
    consentState: consentState || null,
  };
}

export function didReceiptMatchByToken(
  receipt: ReceiptFields | null,
  webhookCheckoutToken: string | undefined
): boolean {
  return !!(
    receipt &&
    webhookCheckoutToken &&
    receipt.checkoutToken === webhookCheckoutToken
  );
}

export function hasAnyConsentSignal(consentState: ConsentState | null): boolean {
  if (!consentState) return false;
  return (
    consentState.marketing !== undefined ||
    consentState.analytics !== undefined ||
    consentState.saleOfDataAllowed !== undefined
  );
}

export function getTrustSummary(trustResult: ReceiptTrustResult): string {
  if (trustResult.trusted) {
    return 'trusted';
  }
  if (trustResult.level === 'partial') {
    return `partial (${trustResult.reason || 'unknown'})`;
  }
  return `untrusted (${trustResult.reason || 'unknown'})`;
}
