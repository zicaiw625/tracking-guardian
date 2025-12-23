/**
 * Pixel Events API - Consent Filtering Logic
 *
 * Handles consent-based filtering for pixel events.
 */

import { isMarketingPlatform, isAnalyticsPlatform } from "../../utils/platform-consent";
import { logger, metrics } from "../../utils/logger.server";
import type { ConsentState, PixelEventPayload } from "./types";

// =============================================================================
// Consent Check Types
// =============================================================================

export interface ConsentCheckResult {
  hasAnyConsent: boolean;
  hasMarketingConsent: boolean;
  hasAnalyticsConsent: boolean;
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
 * Check initial consent from payload.
 * Returns true if ANY consent (marketing or analytics) is present.
 */
export function checkInitialConsent(consent: ConsentState | undefined): ConsentCheckResult {
  const hasMarketingConsent = consent?.marketing === true;
  const hasAnalyticsConsent = consent?.analytics === true;
  const hasAnyConsent = hasMarketingConsent || hasAnalyticsConsent;

  // P0-04: saleOfData must be EXPLICITLY true, not just "not false"
  // undefined/null/missing = NOT allowed (strict interpretation)
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

