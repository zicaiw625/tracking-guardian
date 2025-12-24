/**
 * Pixel Events API - Consent Filtering Logic
 *
 * P0.6: Handles consent-based filtering for pixel events.
 * 
 * Consent Strategy (MUST match pixel-side consent.ts):
 * 
 * 1. All consent values default to FALSE (deny by default)
 * 2. Consent is only granted when EXPLICITLY set to true
 * 3. saleOfDataAllowed must be true for marketing platforms to send CAPI
 * 4. The check flow is:
 *    - Pixel: sends event only if hasAnalyticsConsent() || hasMarketingConsent()
 *    - Backend: drops if no consent at all (hasAnyConsent check)
 *    - Backend: drops saleOfData if not explicitly allowed
 *    - Backend: filters platforms by marketing/analytics consent
 * 
 * This ensures:
 * - No data sent to third parties without explicit consent
 * - CCPA compliance via sale_of_data check
 * - Defense in depth (pixel + backend both check)
 */

import { isMarketingPlatform, isAnalyticsPlatform } from "../../utils/platform-consent";
import { logger, metrics } from "../../utils/logger.server";
import type { ConsentState } from "./types";

// =============================================================================
// Consent Check Types
// =============================================================================

export interface ConsentCheckResult {
  /** True if user has granted any consent (marketing OR analytics) */
  hasAnyConsent: boolean;
  /** True if marketing consent is explicitly granted */
  hasMarketingConsent: boolean;
  /** True if analytics consent is explicitly granted */
  hasAnalyticsConsent: boolean;
  /** True if sale of data is explicitly allowed (CCPA) */
  saleOfDataAllowed: boolean;
}

export interface PlatformFilterResult {
  platformsToRecord: string[];
  skippedPlatforms: string[];
}

// =============================================================================
// Consent Functions
// =============================================================================

/**
 * P0.6: Check initial consent from payload.
 * 
 * This MUST match the logic in pixel-side consent.ts:
 * - All values default to FALSE (deny by default)
 * - Only true === true grants consent
 * - saleOfData requires explicit true for CAPI to marketing platforms
 * 
 * @returns ConsentCheckResult with hasAnyConsent indicating if we should continue processing
 */
export function checkInitialConsent(consent: ConsentState | undefined): ConsentCheckResult {
  // P0.6: Strict boolean checks - only true === true grants consent
  // This matches pixel-side consent.ts logic exactly
  const hasMarketingConsent = consent?.marketing === true;
  const hasAnalyticsConsent = consent?.analytics === true;
  const hasAnyConsent = hasMarketingConsent || hasAnalyticsConsent;

  // P0.6: saleOfData must be EXPLICITLY true, not just "not false"
  // undefined/null/missing = NOT allowed (strict interpretation)
  // This matches pixel-side: saleOfDataAllowed = status.saleOfDataAllowed === true
  const saleOfDataAllowed = consent?.saleOfData === true;

  return {
    hasAnyConsent,
    hasMarketingConsent,
    hasAnalyticsConsent,
    saleOfDataAllowed,
  };
}

/**
 * Log silent drop when no consent is present.
 */
export function logNoConsentDrop(
  shopDomain: string,
  consent: ConsentState | undefined
): void {
  metrics.silentDrop({
    shopDomain,
    reason: "no_consent_at_all",
    category: "validation",
    sampleRate: 1,
  });

  logger.debug(`Dropping pixel event - no consent at all`, {
    shopDomain,
    marketing: consent?.marketing,
    analytics: consent?.analytics,
  });
}

/**
 * Filter platforms based on consent state.
 *
 * Marketing platforms require marketing consent.
 * Analytics platforms require analytics consent.
 */
export function filterPlatformsByConsent(
  pixelConfigs: Array<{ platform: string }>,
  consentResult: ConsentCheckResult
): PlatformFilterResult {
  const platformsToRecord: string[] = [];
  const skippedPlatforms: string[] = [];

  for (const config of pixelConfigs) {
    // Marketing platforms need marketing consent
    if (isMarketingPlatform(config.platform) && !consentResult.hasMarketingConsent) {
      logger.debug(
        `Skipping ${config.platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consentResult.hasMarketingConsent})`
      );
      skippedPlatforms.push(config.platform);
      continue;
    }

    // Analytics platforms need analytics consent
    if (isAnalyticsPlatform(config.platform) && !consentResult.hasAnalyticsConsent) {
      logger.debug(
        `Skipping ${config.platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consentResult.hasAnalyticsConsent})`
      );
      skippedPlatforms.push(config.platform);
      continue;
    }

    platformsToRecord.push(config.platform);
  }

  return { platformsToRecord, skippedPlatforms };
}

/**
 * Log consent filter metrics.
 */
export function logConsentFilterMetrics(
  shopDomain: string,
  orderId: string,
  recordedPlatforms: string[],
  skippedPlatforms: string[],
  consentResult: ConsentCheckResult
): void {
  if (skippedPlatforms.length > 0 || recordedPlatforms.length > 0) {
    metrics.consentFilter({
      shopDomain,
      orderId,
      recordedPlatforms,
      skippedPlatforms,
      marketingConsent: consentResult.hasMarketingConsent,
      analyticsConsent: consentResult.hasAnalyticsConsent,
    });
  }
}

