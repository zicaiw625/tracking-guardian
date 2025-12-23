/**
 * Trust Evaluation Service
 * 
 * Handles trust verification and consent evaluation for conversion jobs.
 * Provides centralized logic for determining if conversions should be sent.
 */

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

// =============================================================================
// Types
// =============================================================================

/**
 * Shop data needed for trust evaluation.
 */
export interface ShopTrustContext {
  shopDomain: string;
  primaryDomain: string | null;
  storefrontDomains: string[];
  consentStrategy: string;
}

/**
 * Result of trust and consent evaluation.
 */
export interface TrustEvaluationResult {
  trustResult: ReceiptTrustResult;
  trustMetadata: Record<string, unknown>;
  consentState: ConsentState | null;
}

/**
 * Result of platform send eligibility check.
 */
export interface PlatformEligibilityResult {
  allowed: boolean;
  skipReason?: string;
  usedConsent?: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default trust verification options.
 */
export const DEFAULT_TRUST_OPTIONS: TrustVerificationOptions = {
  strictOriginValidation: true,
  allowNullOrigin: true,
  maxReceiptAgeMs: 60 * 60 * 1000, // 1 hour
  maxTimeSkewMs: 15 * 60 * 1000,   // 15 minutes
};

// =============================================================================
// Trust Evaluation
// =============================================================================

/**
 * Evaluate trust for a conversion job.
 * 
 * @param receipt - Matching pixel event receipt (if any)
 * @param webhookCheckoutToken - Checkout token from webhook
 * @param shop - Shop context for domain validation
 * @returns Trust evaluation result
 */
export function evaluateTrust(
  receipt: ReceiptFields | null,
  webhookCheckoutToken: string | undefined,
  shop: ShopTrustContext
): TrustEvaluationResult {
  // Build allowed domains for origin validation
  const shopAllowedDomains = buildShopAllowedDomains(
    shop.shopDomain,
    shop.primaryDomain,
    shop.storefrontDomains
  );

  // Verify trust
  const trustResult = verifyReceiptTrust({
    receiptCheckoutToken: receipt?.checkoutToken,
    webhookCheckoutToken,
    ingestionKeyMatched: receipt?.signatureStatus === SignatureStatus.KEY_MATCHED,
    receiptExists: !!receipt,
    receiptOriginHost: receipt?.originHost,
    allowedDomains: shopAllowedDomains,
    clientCreatedAt: receipt?.pixelTimestamp,
    serverCreatedAt: receipt?.createdAt,
    options: DEFAULT_TRUST_OPTIONS,
  });

  // Build trust metadata for audit
  const trustMetadata = buildTrustMetadata(trustResult, {
    hasReceipt: !!receipt,
    receiptTrustLevel: receipt?.trustLevel,
    webhookHasCheckoutToken: !!webhookCheckoutToken,
  });

  // Parse consent state
  const rawConsentState = parseConsentState(receipt?.consentState);
  
  // P0-04: saleOfData must be EXPLICITLY true, not just "not false"
  // undefined/null/missing = NOT allowed (strict deny-by-default interpretation)
  const consentState: ConsentState | null = rawConsentState
    ? {
        marketing: rawConsentState.marketing,
        analytics: rawConsentState.analytics,
        saleOfDataAllowed: rawConsentState.saleOfData === true,
      }
    : null;

  return {
    trustResult,
    trustMetadata,
    consentState,
  };
}

// =============================================================================
// Platform Eligibility
// =============================================================================

/**
 * Check if a platform is eligible to receive the conversion.
 * 
 * @param platform - Platform identifier
 * @param trustResult - Trust verification result
 * @param consentState - Consent state from receipt
 * @param strategy - Shop consent strategy
 * @param treatAsMarketing - Whether platform should be treated as marketing
 * @returns Eligibility result with skip reason if not allowed
 */
export function checkPlatformEligibility(
  platform: string,
  trustResult: ReceiptTrustResult,
  consentState: ConsentState | null,
  strategy: string,
  treatAsMarketing: boolean
): PlatformEligibilityResult {
  const platformCategory = getEffectiveConsentCategory(platform, treatAsMarketing);

  // Check sale of data opt-out first
  if (consentState?.saleOfDataAllowed === false) {
    logger.debug(`[P0-04] Platform blocked by sale_of_data opt-out`, {
      platform,
    });
    return {
      allowed: false,
      skipReason: 'sale_of_data_opted_out',
    };
  }

  // Check trust level
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

  // Check consent
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

// =============================================================================
// Consent Evidence Builder
// =============================================================================

/**
 * Build consent evidence for audit logging.
 * 
 * @param strategy - Consent strategy used
 * @param hasReceipt - Whether receipt was found
 * @param trustResult - Trust verification result
 * @param consentState - Consent state
 * @returns Consent evidence object
 */
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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if receipt matched webhook by checkout token.
 */
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

/**
 * Determine if any consent is available.
 */
export function hasAnyConsentSignal(consentState: ConsentState | null): boolean {
  if (!consentState) return false;
  return (
    consentState.marketing !== undefined ||
    consentState.analytics !== undefined ||
    consentState.saleOfDataAllowed !== undefined
  );
}

/**
 * Get a human-readable trust summary.
 */
export function getTrustSummary(trustResult: ReceiptTrustResult): string {
  if (trustResult.trusted) {
    return 'trusted';
  }
  if (trustResult.level === 'partial') {
    return `partial (${trustResult.reason || 'unknown'})`;
  }
  return `untrusted (${trustResult.reason || 'unknown'})`;
}

