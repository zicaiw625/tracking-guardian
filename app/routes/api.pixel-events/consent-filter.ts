

import { isMarketingPlatform, isAnalyticsPlatform, PLATFORM_CONSENT_CONFIG } from "../../utils/platform-consent";
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

  saleOfDataAllowed: boolean;
}

export interface PlatformFilterResult {
  platformsToRecord: Array<{ platform: string; configId?: string; platformId?: string }>;
  skippedPlatforms: string[];
}

export function checkInitialConsent(consent: ConsentState | undefined): ConsentCheckResult {

  const hasMarketingConsent = consent?.marketing === true;
  const hasAnalyticsConsent = consent?.analytics === true;
  const hasAnyConsent = hasMarketingConsent || hasAnalyticsConsent;

  const saleOfDataAllowed = consent?.saleOfData === true;

  return {
    hasAnyConsent,
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
 * P0-3: 多目的地配置支持
 * 
 * 修复：返回配置对象而不是平台名称，以支持同一平台的多个配置（通过 platformId 区分）
 * 例如：同一店铺可以配置多个 GA4 property、多个 Meta Pixel 等
 * 
 * 每个配置都会被单独处理，确保所有目的地都能收到事件
 * 
 * 注意：此函数只处理 consent 过滤，不处理 clientSideEnabled/serverSideEnabled 过滤
 * 这些过滤应该在调用此函数之前或之后进行
 */
export function filterPlatformsByConsent(
  pixelConfigs: Array<{ 
    platform: string; 
    id?: string; 
    platformId?: string | null;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
  }>,
  consentResult: ConsentCheckResult
): PlatformFilterResult {
  const platformsToRecord: Array<{ platform: string; configId?: string; platformId?: string }> = [];
  const skippedPlatforms: string[] = [];

  for (const config of pixelConfigs) {
    const platform = config.platform;
    const requiresSaleOfData = platformRequiresSaleOfData(platform);

    if (requiresSaleOfData && !consentResult.saleOfDataAllowed) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `sale_of_data required but not allowed (saleOfData=${consentResult.saleOfDataAllowed}) [P0-2]`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    if (isMarketingPlatform(platform) && !consentResult.hasMarketingConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `marketing consent not granted (marketing=${consentResult.hasMarketingConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    if (isAnalyticsPlatform(platform) && !consentResult.hasAnalyticsConsent) {
      logger.debug(
        `Skipping ${platform} ConversionLog: ` +
          `analytics consent not granted (analytics=${consentResult.hasAnalyticsConsent})`
      );
      skippedPlatforms.push(platform);
      continue;
    }

    // P0-3: 返回配置对象而不是平台名称，以支持多目的地
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
    // 为了向后兼容 metrics，提取平台名称列表
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

