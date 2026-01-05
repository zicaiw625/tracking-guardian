
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "../multi-shop.server";
import { batchApplyPixelTemplate, type BatchApplyOptions, type BatchApplyResult , PixelTemplateConfig } from "../batch-pixel-apply.server";
import { isPixelTemplateConfigArray, type PixelTemplateConfig as TypeGuardPixelTemplateConfig } from "../../utils/type-guards";

export interface BatchTemplateApplyOptions {
  templateId: string;
  groupId: string;
  requesterId: string;
  targetShopIds?: string[];
  overwriteExisting?: boolean;
  skipIfExists?: boolean;
  maxRetries?: number;
  concurrency?: number;
}

export interface ConfigComparison {
  platform: string;
  before: {
    exists: boolean;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
    eventMappings?: Record<string, string>;
  };
  after: {
    exists: boolean;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
    eventMappings?: Record<string, string>;
  };
  differences: Array<{
    field: string;
    before: unknown;
    after: unknown;
  }>;
  action: "created" | "updated" | "skipped" | "no_change";
}

export interface ShopApplyResult {
  shopId: string;
  shopDomain: string;
  status: "success" | "failed" | "skipped";
  message: string;
  platformsApplied?: string[];
  comparisons?: ConfigComparison[];
  errorType?: "validation" | "database" | "permission" | "unknown";
}

export interface EnhancedBatchApplyResult {
  templateId: string;
  templateName: string;
  groupId: string;
  groupName: string;
  totalShops: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: ShopApplyResult[];
  summary: {
    totalPlatformsApplied: number;
    platformsBreakdown: Record<string, number>;
    changesBreakdown: {
      created: number;
      updated: number;
      skipped: number;
      noChange: number;
    };
    errorBreakdown: Record<string, number> | undefined;
  };
  startedAt: Date;
  completedAt: Date;
  duration: number;
}

function compareConfigs(
  platform: string,
  beforeConfig: {
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
    eventMappings: Record<string, string> | null;
  } | null,
  afterConfig: {
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
    eventMappings: Record<string, string> | null;
  } | null
): ConfigComparison {
  const before = beforeConfig
    ? {
        exists: true,
        clientSideEnabled: beforeConfig.clientSideEnabled,
        serverSideEnabled: beforeConfig.serverSideEnabled,
        eventMappings: beforeConfig.eventMappings || {},
      }
    : {
        exists: false,
      };

  const after = afterConfig
    ? {
        exists: true,
        clientSideEnabled: afterConfig.clientSideEnabled,
        serverSideEnabled: afterConfig.serverSideEnabled,
        eventMappings: afterConfig.eventMappings || {},
      }
    : {
        exists: false,
      };

  const differences: Array<{ field: string; before: unknown; after: unknown }> = [];

  if (!beforeConfig) {
    if (afterConfig) {
      differences.push({
        field: "exists",
        before: false,
        after: true,
      });
      return {
        platform,
        before,
        after,
        differences,
        action: "created",
      };
    } else {
      return {
        platform,
        before,
        after,
        differences: [],
        action: "no_change",
      };
    }
  }

  if (!afterConfig) {
    differences.push({
      field: "exists",
      before: true,
      after: false,
    });
    return {
      platform,
      before,
      after,
      differences,
      action: "updated",
    };
  }

  if (beforeConfig.clientSideEnabled !== afterConfig.clientSideEnabled) {
    differences.push({
      field: "clientSideEnabled",
      before: beforeConfig.clientSideEnabled,
      after: afterConfig.clientSideEnabled,
    });
  }

  if (beforeConfig.serverSideEnabled !== afterConfig.serverSideEnabled) {
    differences.push({
      field: "serverSideEnabled",
      before: beforeConfig.serverSideEnabled,
      after: afterConfig.serverSideEnabled,
    });
  }

  const beforeMappings = beforeConfig.eventMappings || {};
  const afterMappings = afterConfig.eventMappings || {};

  const allEventKeys = new Set([...Object.keys(beforeMappings), ...Object.keys(afterMappings)]);
  for (const key of allEventKeys) {
    if (beforeMappings[key] !== afterMappings[key]) {
      differences.push({
        field: `eventMappings.${key}`,
        before: beforeMappings[key] || null,
        after: afterMappings[key] || null,
      });
    }
  }

  if (differences.length === 0) {
    return {
      platform,
      before,
      after,
      differences: [],
      action: "no_change",
    };
  }

  return {
    platform,
    before,
    after,
    differences,
    action: "updated",
  };
}

async function getShopConfigsBefore(
  shopId: string,
  platforms: PixelTemplateConfig[]
): Promise<Map<string, { clientSideEnabled: boolean; serverSideEnabled: boolean; eventMappings: Record<string, string> | null }>> {
  const platformNames = platforms.map((p) => p.platform);
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      platform: { in: platformNames },
    },
    select: {
      platform: true,
      clientSideEnabled: true,
      serverSideEnabled: true,
      eventMappings: true,
    },
  });

  const configMap = new Map<string, { clientSideEnabled: boolean; serverSideEnabled: boolean; eventMappings: Record<string, string> | null }>();
  for (const config of configs) {
    configMap.set(config.platform, {
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
      eventMappings: config.eventMappings as Record<string, string> | null,
    });
  }
  return configMap;
}

async function getShopConfigsAfter(
  shopId: string,
  platforms: PixelTemplateConfig[]
): Promise<Map<string, { clientSideEnabled: boolean; serverSideEnabled: boolean; eventMappings: Record<string, string> | null }>> {
  const platformNames = platforms.map((p) => p.platform);
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      platform: { in: platformNames },
    },
    select: {
      platform: true,
      clientSideEnabled: true,
      serverSideEnabled: true,
      eventMappings: true,
    },
  });

  const configMap = new Map<string, { clientSideEnabled: boolean; serverSideEnabled: boolean; eventMappings: Record<string, string> | null }>();
  for (const config of configs) {
    configMap.set(config.platform, {
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
      eventMappings: config.eventMappings as Record<string, string> | null,
    });
  }
  return configMap;
}

export async function batchApplyTemplateWithComparison(
  options: BatchTemplateApplyOptions
): Promise<EnhancedBatchApplyResult | { error: string }> {
  const {
    templateId,
    groupId,
    requesterId,
    targetShopIds,
    overwriteExisting = false,
    skipIfExists = false,
    maxRetries = 2,
    concurrency = 3,
  } = options;

  const startedAt = new Date();

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量操作，请升级到 Agency 版" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  const template = await prisma.pixelTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      name: true,
      platforms: true,
    },
  });

  if (!template) {
    return { error: "模板不存在" };
  }

  const templatePlatforms: PixelTemplateConfig[] = Array.isArray(template.platforms) && isPixelTemplateConfigArray(template.platforms)
    ? (template.platforms as PixelTemplateConfig[])
    : [];

  let targetShops = groupDetails.members;
  if (targetShopIds && targetShopIds.length > 0) {
    const targetSet = new Set(targetShopIds);
    targetShops = targetShops.filter((m) => targetSet.has(m.shopId));
  }

  if (targetShops.length === 0) {
    return { error: "没有可应用的目标店铺" };
  }

  const results: ShopApplyResult[] = [];
  const shopIds = targetShops.map((m) => m.shopId);

  const beforeConfigsMap = new Map<string, Map<string, { clientSideEnabled: boolean; serverSideEnabled: boolean; eventMappings: Record<string, string> | null }>>();
  for (const shopId of shopIds) {
    const configs = await getShopConfigsBefore(shopId, templatePlatforms);
    beforeConfigsMap.set(shopId, configs);
  }

  const batchApplyResult = await batchApplyPixelTemplate({
    templateId,
    targetShopIds: shopIds,
    overwriteExisting,
    skipIfExists,
    maxRetries,
    concurrency,
  });

  for (const shopResult of batchApplyResult.results) {
    if (shopResult.status === "success") {
      const afterConfigs = await getShopConfigsAfter(shopResult.shopId, templatePlatforms);
      const beforeConfigs = beforeConfigsMap.get(shopResult.shopId) || new Map();

      const comparisons: ConfigComparison[] = [];
      for (const platformConfig of templatePlatforms) {
        const before = beforeConfigs.get(platformConfig.platform) || null;
        const after = afterConfigs.get(platformConfig.platform) || null;
        const comparison = compareConfigs(platformConfig.platform, before, after);

        if (before && !overwriteExisting && skipIfExists && !shopResult.platformsApplied?.includes(platformConfig.platform)) {
          comparison.action = "skipped";
        }

        comparisons.push(comparison);
      }

      results.push({
        shopId: shopResult.shopId,
        shopDomain: shopResult.shopDomain,
        status: shopResult.status,
        message: shopResult.message,
        platformsApplied: shopResult.platformsApplied,
        comparisons,
      });
    } else {
      results.push({
        shopId: shopResult.shopId,
        shopDomain: shopResult.shopDomain,
        status: shopResult.status,
        message: shopResult.message,
        errorType: shopResult.errorType,
      });
    }
  }

  const platformsBreakdown: Record<string, number> = {};
  const changesBreakdown = {
    created: 0,
    updated: 0,
    skipped: 0,
    noChange: 0,
  };
  const errorBreakdown: Record<string, number> = {};

  let totalPlatformsApplied = 0;

  for (const result of results) {
    if (result.status === "success" && result.platformsApplied) {
      totalPlatformsApplied += result.platformsApplied.length;
      for (const platform of result.platformsApplied) {
        platformsBreakdown[platform] = (platformsBreakdown[platform] || 0) + 1;
      }
    }

      if (result.comparisons) {
        for (const comparison of result.comparisons) {
          const actionKey = comparison.action === "no_change" ? "noChange" : comparison.action;
          changesBreakdown[actionKey as keyof typeof changesBreakdown]++;
        }
      }

    if (result.errorType) {
      errorBreakdown[result.errorType] = (errorBreakdown[result.errorType] || 0) + 1;
    }
  }

  const completedAt = new Date();

  logger.info("Enhanced batch template apply completed", {
    templateId,
    templateName: template.name,
    groupId,
    totalShops: targetShops.length,
    successCount: batchApplyResult.successCount,
    failedCount: batchApplyResult.failedCount,
    skippedCount: batchApplyResult.skippedCount,
    duration: completedAt.getTime() - startedAt.getTime(),
  });

  return {
    templateId: template.id,
    templateName: template.name,
    groupId,
    groupName: groupDetails.name,
    totalShops: targetShops.length,
    successCount: batchApplyResult.successCount,
    failedCount: batchApplyResult.failedCount,
    skippedCount: batchApplyResult.skippedCount,
    results,
    summary: {
      totalPlatformsApplied,
      platformsBreakdown,
      changesBreakdown,
      errorBreakdown: Object.keys(errorBreakdown).length > 0 ? errorBreakdown : ({} as Record<string, number>),
    },
    startedAt,
    completedAt,
    duration: completedAt.getTime() - startedAt.getTime(),
  };
}

export async function compareShopConfigs(
  shopIds: string[],
  platform?: string
): Promise<{
  shops: Array<{
    shopId: string;
    shopDomain: string;
    platforms: string[];
  }>;
  platformComparison?: Record<
    string,
    {
      consistent: boolean;
      shopsWithConfig: number;
      shopsWithoutConfig: number;
      differences: Array<{
        shopId: string;
        shopDomain: string;
        differences: string[];
      }>;
    }
  >;
}> {
  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: {
      id: true,
      shopDomain: true,
      pixelConfigs: {
        where: platform ? { platform } : undefined,
        select: {
          platform: true,
          clientSideEnabled: true,
          serverSideEnabled: true,
          eventMappings: true,
        },
      },
    },
  });

  const shopData = shops.map((shop: { id: string; shopDomain: string; pixelConfigs: Array<{ platform: string }> }) => ({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    platforms: shop.pixelConfigs.map((c: { platform: string }) => c.platform),
    configs: shop.pixelConfigs,
  }));

  const allPlatforms = new Set<string>();
  for (const shop of shopData) {
    for (const platformName of shop.platforms) {
      allPlatforms.add(platformName);
    }
  }

  const platformComparison: Record<
    string,
    {
      consistent: boolean;
      shopsWithConfig: number;
      shopsWithoutConfig: number;
      differences: Array<{
        shopId: string;
        shopDomain: string;
        differences: string[];
      }>;
    }
  > = {};

  for (const platformName of allPlatforms) {
    const shopsWithPlatform = shopData.filter((s: { platforms: string[] }) => s.platforms.includes(platformName));
    const shopsWithoutPlatform = shopData.filter((s: { platforms: string[] }) => !s.platforms.includes(platformName));

    const configs = shopsWithPlatform.map((s: { shopId: string; shopDomain: string; configs: Array<{ platform: string; clientSideEnabled?: boolean; serverSideEnabled?: boolean; eventMappings?: unknown }> }) => {
      const config = s.configs.find((c) => c.platform === platformName);
      return {
        shopId: s.shopId,
        shopDomain: s.shopDomain,
        config: config
          ? {
              clientSideEnabled: config.clientSideEnabled ?? false,
              serverSideEnabled: config.serverSideEnabled ?? false,
              eventMappings: config.eventMappings,
            }
          : null,
      };
    });

    let consistent = true;
    const differences: Array<{ shopId: string; shopDomain: string; differences: string[] }> = [];

    if (configs.length > 1) {
      const baseConfig = configs[0].config;
      if (baseConfig) {
        for (let i = 1; i < configs.length; i++) {
          const currentConfig = configs[i].config;
          if (!currentConfig) {
            consistent = false;
            differences.push({
              shopId: configs[i].shopId,
              shopDomain: configs[i].shopDomain,
              differences: ["配置不存在"],
            });
            continue;
          }

          const diffList: string[] = [];
          if (baseConfig.clientSideEnabled !== currentConfig.clientSideEnabled) {
            diffList.push("clientSideEnabled");
          }
          if (baseConfig.serverSideEnabled !== currentConfig.serverSideEnabled) {
            diffList.push("serverSideEnabled");
          }

          const baseMappings = (baseConfig.eventMappings as Record<string, string> | null) || {};
          const currentMappings = (currentConfig.eventMappings as Record<string, string> | null) || {};
          const allKeys = new Set([...Object.keys(baseMappings), ...Object.keys(currentMappings)]);
          for (const key of allKeys) {
            if (baseMappings[key] !== currentMappings[key]) {
              diffList.push(`eventMappings.${key}`);
            }
          }

          if (diffList.length > 0) {
            consistent = false;
            differences.push({
              shopId: configs[i].shopId,
              shopDomain: configs[i].shopDomain,
              differences: diffList,
            });
          }
        }
      }
    }

    platformComparison[platformName] = {
      consistent,
      shopsWithConfig: shopsWithPlatform.length,
      shopsWithoutConfig: shopsWithoutPlatform.length,
      differences,
    };
  }

  return {
    shops: shopData.map((s: { shopId: string; shopDomain: string; platforms: string[] }) => ({
      shopId: s.shopId,
      shopDomain: s.shopDomain,
      platforms: s.platforms,
    })),
    platformComparison: Object.keys(platformComparison).length > 0 ? platformComparison : undefined,
  };
}

