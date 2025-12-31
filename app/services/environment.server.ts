

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

  if (previousEnvironment === targetEnvironment) {
    return {
      success: true,
      previousEnvironment,
      newEnvironment: targetEnvironment,
      configVersion: config.configVersion,
      rollbackAllowed: true,
    };
  }

  if (targetEnvironment === "live") {
    const validationErrors: string[] = [];

    if (config.serverSideEnabled) {
      if (!config.credentialsEncrypted || config.credentialsEncrypted.trim().length === 0) {
        validationErrors.push("切换到生产环境需要配置服务端凭证");
      }
    }

    if (config.clientConfig) {
      const clientConfig = config.clientConfig as Record<string, unknown>;
      if (platform === "google" && !clientConfig.measurementId) {
        validationErrors.push("Google Analytics 需要配置 Measurement ID");
      }
      if (platform === "meta" && !clientConfig.pixelId) {
        validationErrors.push("Meta Pixel 需要配置 Pixel ID");
      }
      if (platform === "tiktok" && !clientConfig.pixelId) {
        validationErrors.push("TikTok Pixel 需要配置 Pixel ID");
      }
    }

    if (validationErrors.length > 0) {
      return {
        success: false,
        previousEnvironment,
        newEnvironment: targetEnvironment,
        configVersion: config.configVersion,
        rollbackAllowed: false,
        error: validationErrors.join("；"),
      };
    }

    logger.info("Switching to live environment", {
      shopId,
      platform,
      configVersion: config.configVersion,
      hasServerSide: !!config.serverSideEnabled,
      hasCredentials: !!config.credentialsEncrypted,
    });
  } else if (targetEnvironment === "test") {

    logger.warn("Switching to test environment", {
      shopId,
      platform,
      previousEnvironment,
      note: "Test mode should only be used for development and testing",
    });
  }

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
        previousConfig: null,
        rollbackAllowed: false,
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

export async function isTestMode(shopId: string, platform: string): Promise<boolean> {
  const config = await getEnvironmentConfig(shopId, platform);
  return config?.environment === "test";
}

export function getPlatformEndpoint(
  platform: string,
  environment: PixelEnvironment
): { baseUrl: string; testMode: boolean } {

  const endpoints: Record<string, { test: string; live: string }> = {
    meta: {
      test: "https://graph.facebook.com",
      live: "https://graph.facebook.com",
    },
    google: {
      test: "https://www.google-analytics.com",
      live: "https://www.google-analytics.com",
    },
    tiktok: {
      test: "https://business-api.tiktok.com",
      live: "https://business-api.tiktok.com",
    },
    pinterest: {
      test: "https://api.pinterest.com",
      live: "https://api.pinterest.com",
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
