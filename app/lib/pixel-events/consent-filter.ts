import { getEffectiveConsentCategory, PLATFORM_CONSENT_CONFIG } from "../../utils/platform-consent";
import { logger, metrics } from "../../utils/logger.server";
import type { ConsentState } from "./types";

function platformRequiresSaleOfData(platform: string): boolean {
  const config = PLATFORM_CONSENT_CONFIG[platform];
  return config?.requiresSaleOfData ?? true;
}

export interface ConsentCheckResult {
  hasAnyConsent: boolean;
  hasMarketingConsent: boolean;
  hasAnalyticsConsent: boolean;
  saleOfDataAllowed?: boolean;
}

export interface PlatformFilterResult {
  platformsToRecord: Array<{ platform: string; configId?: string; platformId?: string }>;
  skippedPlatforms: string[];
}

export function checkInitialConsent(consent: ConsentState | undefined): ConsentCheckResult {
  const hasMarketingConsent = consent?.marketing === true;
  const hasAnalyticsConsent = consent?.analytics === true;
  const saleOfDataAllowed = consent?.saleOfData;
  return {
    hasAnyConsent: hasAnalyticsConsent || hasMarketingConsent,
    hasMarketingConsent,
    hasAnalyticsConsent,
    saleOfDataAllowed,
  };
}

export function logNoConsentDrop(
  shopDomain: string,
  consent: ConsentState | undefined
): void {
  metrics.silentDrop({
    shopDomain,
    reason: "no_analytics_consent",
    category: "validation",
    sampleRate: 1,
  });
  logger.debug(`Dropping pixel event - analytics consent not granted`, {
    shopDomain,
    marketing: consent?.marketing,
    analytics: consent?.analytics,
  });
}

export function filterPlatformsByConsent(
  pixelConfigs: Array<{
    platform: string;
    id?: string;
    platformId?: string | null;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
    clientConfig?: {
      treatAsMarketing?: boolean;
    } | null;
  }>,
  consentResult: ConsentCheckResult
): PlatformFilterResult {
  const platformsToRecord: Array<{ platform: string; configId?: string; platformId?: string }> = [];
  const skippedPlatforms: string[] = [];
  for (const config of pixelConfigs) {
    const platform = config.platform;
    const treatAsMarketing = config.clientConfig?.treatAsMarketing === true;
    const consentCategory = getEffectiveConsentCategory(platform, treatAsMarketing);
    const isMarketing = consentCategory === "marketing";
    const isAnalytics = consentCategory === "analytics";
    const requiresSaleOfData = platformRequiresSaleOfData(platform);
    if (requiresSaleOfData && consentResult.saleOfDataAllowed === false) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `sale_of_data required but not allowed (saleOfData=${consentResult.saleOfDataAllowed})`
      );
      skippedPlatforms.push(platform);
      continue;
    }
    if (isMarketing && !consentResult.hasMarketingConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consentResult.hasMarketingConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }
    if (isAnalytics && !consentResult.hasAnalyticsConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consentResult.hasAnalyticsConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }
    platformsToRecord.push({
      platform,
      configId: config.id,
      platformId: config.platformId || undefined,
    });
  }
  return { platformsToRecord, skippedPlatforms };
}

export function logConsentFilterMetrics(
  shopDomain: string,
  orderId: string,
  recordedPlatforms: Array<{ platform: string; configId?: string; platformId?: string }>,
  skippedPlatforms: string[],
  consentResult: ConsentCheckResult
): void {
  if (skippedPlatforms.length > 0 || recordedPlatforms.length > 0) {
    const platformNames = recordedPlatforms.map(p => p.platform);
    metrics.consentFilter({
      shopDomain,
      orderId,
      recordedPlatforms: platformNames,
      skippedPlatforms,
      marketingConsent: consentResult.hasMarketingConsent,
      analyticsConsent: consentResult.hasAnalyticsConsent,
    });
  }
}
