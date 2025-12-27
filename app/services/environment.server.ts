/**
 * 环境切换服务 - Environment Service
 * 对应设计方案 4.3 像素迁移中心 - Test/Live 环境切换
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export type PixelEnvironment = "test" | "live";

export interface EnvironmentConfig {
  shopId: string;
  platform: string;
  environment: PixelEnvironment;
  configVersion: number;
  rollbackAllowed: boolean;
}

export interface EnvironmentSwitchResult {
  success: boolean;
  previousEnvironment: PixelEnvironment;
  newEnvironment: PixelEnvironment;
  configVersion: number;
  rollbackAllowed: boolean;
  error?: string;
}

/**
 * 获取平台的当前环境配置
 */
export async function getEnvironmentConfig(
  shopId: string,
  platform: string
): Promise<EnvironmentConfig | null> {
  const config = await prisma.pixelConfig.findUnique({
    where: { shopId_platform: { shopId, platform } },
    select: {
      shopId: true,
      platform: true,
      environment: true,
      configVersion: true,
      rollbackAllowed: true,
    },
  });

  if (!config) return null;

  return {
    shopId: config.shopId,
    platform: config.platform,
    environment: config.environment as PixelEnvironment,
    configVersion: config.configVersion,
    rollbackAllowed: config.rollbackAllowed,
  };
}

/**
 * 切换平台环境 (Test <-> Live)
 */
export async function switchEnvironment(
  shopId: string,
  platform: string,
  targetEnvironment: PixelEnvironment
): Promise<EnvironmentSwitchResult> {
  const config = await prisma.pixelConfig.findUnique({
    where: { shopId_platform: { shopId, platform } },
    select: {
      id: true,
      environment: true,
      configVersion: true,
      clientConfig: true,
      credentialsEncrypted: true,
    },
  });

  if (!config) {
    return {
      success: false,
      previousEnvironment: "live",
      newEnvironment: targetEnvironment,
      configVersion: 0,
      rollbackAllowed: false,
      error: "Platform configuration not found",
    };
  }

  const previousEnvironment = config.environment as PixelEnvironment;

  // 如果环境相同，无需切换
  if (previousEnvironment === targetEnvironment) {
    return {
      success: true,
      previousEnvironment,
      newEnvironment: targetEnvironment,
      configVersion: config.configVersion,
      rollbackAllowed: true,
    };
  }

  // 保存当前配置快照用于回滚
  const previousConfig = {
    environment: previousEnvironment,
    clientConfig: config.clientConfig,
    credentialsEncrypted: config.credentialsEncrypted,
    savedAt: new Date().toISOString(),
  };

  try {
    const updated = await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        environment: targetEnvironment,
        configVersion: config.configVersion + 1,
        previousConfig: previousConfig,
        rollbackAllowed: true,
        updatedAt: new Date(),
      },
      select: {
        environment: true,
        configVersion: true,
        rollbackAllowed: true,
      },
    });

    logger.info(`Environment switched`, {
      shopId,
      platform,
      from: previousEnvironment,
      to: targetEnvironment,
      newVersion: updated.configVersion,
    });

    return {
      success: true,
      previousEnvironment,
      newEnvironment: updated.environment as PixelEnvironment,
      configVersion: updated.configVersion,
      rollbackAllowed: updated.rollbackAllowed,
    };
  } catch (error) {
    logger.error(`Failed to switch environment`, {
      shopId,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      previousEnvironment,
      newEnvironment: targetEnvironment,
      configVersion: config.configVersion,
      rollbackAllowed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 回滚到上一个环境配置
 */
export async function rollbackEnvironment(
  shopId: string,
  platform: string
): Promise<EnvironmentSwitchResult> {
  const config = await prisma.pixelConfig.findUnique({
    where: { shopId_platform: { shopId, platform } },
    select: {
      id: true,
      environment: true,
      configVersion: true,
      previousConfig: true,
      rollbackAllowed: true,
    },
  });

  if (!config) {
    return {
      success: false,
      previousEnvironment: "live",
      newEnvironment: "live",
      configVersion: 0,
      rollbackAllowed: false,
      error: "Platform configuration not found",
    };
  }

  if (!config.rollbackAllowed || !config.previousConfig) {
    return {
      success: false,
      previousEnvironment: config.environment as PixelEnvironment,
      newEnvironment: config.environment as PixelEnvironment,
      configVersion: config.configVersion,
      rollbackAllowed: false,
      error: "Rollback not available - no previous configuration saved",
    };
  }

  const previousConfig = config.previousConfig as {
    environment: PixelEnvironment;
    clientConfig?: unknown;
    credentialsEncrypted?: string;
  };

  const currentEnvironment = config.environment as PixelEnvironment;

  try {
    const updated = await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        environment: previousConfig.environment,
        configVersion: config.configVersion + 1,
        previousConfig: null, // 清除回滚数据
        rollbackAllowed: false, // 不允许连续回滚
        updatedAt: new Date(),
      },
      select: {
        environment: true,
        configVersion: true,
        rollbackAllowed: true,
      },
    });

    logger.info(`Environment rolled back`, {
      shopId,
      platform,
      from: currentEnvironment,
      to: previousConfig.environment,
      newVersion: updated.configVersion,
    });

    return {
      success: true,
      previousEnvironment: currentEnvironment,
      newEnvironment: updated.environment as PixelEnvironment,
      configVersion: updated.configVersion,
      rollbackAllowed: updated.rollbackAllowed,
    };
  } catch (error) {
    logger.error(`Failed to rollback environment`, {
      shopId,
      platform,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      previousEnvironment: currentEnvironment,
      newEnvironment: currentEnvironment,
      configVersion: config.configVersion,
      rollbackAllowed: config.rollbackAllowed,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 获取所有平台的环境配置
 */
export async function getAllEnvironmentConfigs(
  shopId: string
): Promise<EnvironmentConfig[]> {
  const configs = await prisma.pixelConfig.findMany({
    where: { shopId, isActive: true },
    select: {
      shopId: true,
      platform: true,
      environment: true,
      configVersion: true,
      rollbackAllowed: true,
    },
  });

  return configs.map((config) => ({
    shopId: config.shopId,
    platform: config.platform,
    environment: config.environment as PixelEnvironment,
    configVersion: config.configVersion,
    rollbackAllowed: config.rollbackAllowed,
  }));
}

/**
 * 批量切换所有平台环境
 */
export async function switchAllEnvironments(
  shopId: string,
  targetEnvironment: PixelEnvironment
): Promise<{
  success: boolean;
  results: Record<string, EnvironmentSwitchResult>;
}> {
  const configs = await prisma.pixelConfig.findMany({
    where: { shopId, isActive: true },
    select: { platform: true },
  });

  const results: Record<string, EnvironmentSwitchResult> = {};
  let allSuccess = true;

  for (const config of configs) {
    const result = await switchEnvironment(shopId, config.platform, targetEnvironment);
    results[config.platform] = result;
    if (!result.success) {
      allSuccess = false;
    }
  }

  return { success: allSuccess, results };
}

/**
 * 检查是否处于测试模式
 */
export async function isTestMode(shopId: string, platform: string): Promise<boolean> {
  const config = await getEnvironmentConfig(shopId, platform);
  return config?.environment === "test";
}

/**
 * 获取平台的 API 端点（根据环境返回不同端点）
 */
export function getPlatformEndpoint(
  platform: string,
  environment: PixelEnvironment
): { baseUrl: string; testMode: boolean } {
  // 各平台的测试/生产端点配置
  const endpoints: Record<string, { test: string; live: string }> = {
    meta: {
      test: "https://graph.facebook.com/v21.0",
      live: "https://graph.facebook.com/v21.0",
    },
    google: {
      test: "https://www.google-analytics.com/debug/mp/collect",
      live: "https://www.google-analytics.com/mp/collect",
    },
    tiktok: {
      test: "https://business-api.tiktok.com/open_api/v1.3/event/track",
      live: "https://business-api.tiktok.com/open_api/v1.3/event/track",
    },
    pinterest: {
      test: "https://api.pinterest.com/v5",
      live: "https://api.pinterest.com/v5",
    },
  };

  const platformEndpoints = endpoints[platform];
  if (!platformEndpoints) {
    throw new Error(`Unknown platform: ${platform}`);
  }

  return {
    baseUrl: environment === "test" ? platformEndpoints.test : platformEndpoints.live,
    testMode: environment === "test",
  };
}
