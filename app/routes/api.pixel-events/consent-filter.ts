/**
 * Pixel Events API - Consent Filtering Logic
 *
 * P0.6 + P0-2: Handles consent-based filtering for pixel events.
 * 
 * Consent Strategy (MUST match pixel-side consent.ts):
 * 
 * 1. All consent values default to FALSE (deny by default)
 * 2. Consent is only granted when EXPLICITLY set to true
 * 3. P0-2: saleOfData 检查改为平台级别：
 *    - 只有 requiresSaleOfData=true 的平台（Meta/TikTok）需要 saleOfData
 *    - requiresSaleOfData=false 的平台（GA4）不需要 saleOfData
 * 4. The check flow is:
 *    - Pixel: sends event only if hasAnalyticsConsent() || hasMarketingConsent()
 *    - Backend: drops if no consent at all (hasAnyConsent check)
 *    - Backend: filters platforms by:
 *      a) saleOfData (仅限 requiresSaleOfData=true 的平台)
 *      b) marketing/analytics consent
 * 
 * This ensures:
 * - No data sent to third parties without explicit consent
 * - CCPA compliance via sale_of_data check (per platform config)
 * - GA4 can still work with analytics-only consent
 * - Defense in depth (pixel + backend both check)
 */

import { isMarketingPlatform, isAnalyticsPlatform, PLATFORM_CONSENT_CONFIG } from "../../utils/platform-consent";
import { logger, metrics } from "../../utils/logger.server";
import type { ConsentState } from "./types";

/**
 * P0-2: 检查平台是否需要 saleOfData 同意。
 * 从 PLATFORM_CONSENT_CONFIG 中读取配置，默认 true（保守策略）。
 */
function platformRequiresSaleOfData(platform: string): boolean {
  const config = PLATFORM_CONSENT_CONFIG[platform];
  // 默认 true（保守策略：未知平台也要求 saleOfData）
  return config?.requiresSaleOfData ?? true;
}

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
 * P0-2: 改进版 - 按平台配置分别检查：
 * 1. Marketing 平台：需要 marketing consent + (如果 requiresSaleOfData) saleOfData
 * 2. Analytics 平台：需要 analytics consent + (如果 requiresSaleOfData) saleOfData
 * 
 * 这样 GA4 (requiresSaleOfData=false) 在只有 analytics 同意时也能工作，
 * 而 Meta/TikTok (requiresSaleOfData=true) 需要额外的 saleOfData 同意。
 */
export function filterPlatformsByConsent(
  pixelConfigs: Array<{ platform: string }>,
  consentResult: ConsentCheckResult
): PlatformFilterResult {
  const platformsToRecord: string[] = [];
  const skippedPlatforms: string[] = [];

  for (const config of pixelConfigs) {
    const platform = config.platform;
    const requiresSaleOfData = platformRequiresSaleOfData(platform);
    
    // P0-2: 先检查 saleOfData（如果平台需要）
    if (requiresSaleOfData && !consentResult.saleOfDataAllowed) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `sale_of_data required but not allowed (saleOfData=${consentResult.saleOfDataAllowed}) [P0-2]`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    // Marketing platforms need marketing consent
    if (isMarketingPlatform(platform) && !consentResult.hasMarketingConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consentResult.hasMarketingConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    // Analytics platforms need analytics consent
    if (isAnalyticsPlatform(platform) && !consentResult.hasAnalyticsConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consentResult.hasAnalyticsConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    platformsToRecord.push(platform);
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

