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
  PLATFORM_CONSENT_CONFIG,
  type ConsentState,
} from '../utils/platform-consent';
import { parseConsentState } from '../types';
import type { TrustVerificationOptions } from '../types/consent';
import type { ReceiptFields } from './receipt-matcher.server';
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

function normalizeConsentState(consent: unknown): ConsentState | null {
  if (!consent || typeof consent !== 'object') {
    return null;
  }
  const data = consent as Record<string, unknown>;
  const rawConsentState = parseConsentState(consent);
  if (!rawConsentState) {
    const saleOfData = data.saleOfDataAllowed !== undefined
      ? (typeof data.saleOfDataAllowed === 'boolean' ? data.saleOfDataAllowed : undefined)
      : (typeof data.saleOfData === 'boolean' ? data.saleOfData : undefined);
    return {
      marketing: typeof data.marketing === 'boolean' ? data.marketing : undefined,
      analytics: typeof data.analytics === 'boolean' ? data.analytics : undefined,
      saleOfDataAllowed: saleOfData,
    };
  }
  return {
    marketing: rawConsentState.marketing,
    analytics: rawConsentState.analytics,
    saleOfDataAllowed: rawConsentState.saleOfData,
  };
}

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
  const isHmacVerified = receipt?.originHost ? true : false;
  const trustResult = verifyReceiptTrust({
    receiptCheckoutToken: undefined,
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
    webhookHasCheckoutToken: !!webhookCheckoutToken,
  });
  const consentFromPayload = receipt?.payloadJson && typeof receipt.payloadJson === 'object' && receipt.payloadJson !== null && 'consent' in receipt.payloadJson
    ? (receipt.payloadJson as Record<string, unknown>).consent
    : null;
  const consentState = normalizeConsentState(consentFromPayload);
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
  const config = PLATFORM_CONSENT_CONFIG[platform];
  const requiresSaleOfData = config?.requiresSaleOfData ?? true;
  if (requiresSaleOfData && consentState?.saleOfDataAllowed === false) {
    logger.debug(`[P0-04] Platform blocked by explicit sale_of_data opt-out`, {
      platform,
      category: platformCategory,
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
  _receipt: ReceiptFields | null,
  _webhookCheckoutToken: string | undefined
): boolean {
  return false;
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
