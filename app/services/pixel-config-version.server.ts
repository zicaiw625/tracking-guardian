import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { Platform } from "./migration.server";

export interface ConfigVersion {
  version: number;
  config: {
    platformId: string | null;
    credentialsEncrypted: string | null;
    eventMappings: Record<string, string> | null;
    environment: string;
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
  };
  savedAt: Date;
}

export interface ConfigVersionHistory {
  currentVersion: number;
  versions: ConfigVersion[];
  canRollback: boolean;
}

/**
 * 保存配置快照（在更新前自动调用）
 */
export async function saveConfigSnapshot(
  shopId: string,
  platform: Platform
): Promise<{ success: boolean; version?: number; error?: string }> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: {
        shopId_platform: {
          shopId,
          platform,
        },
      },
    });

    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    // 如果当前版本有 previousConfig，说明已经有快照
    // 否则，将当前配置保存为快照
    const currentConfig = {
      platformId: config.platformId,
      credentialsEncrypted: config.credentialsEncrypted,
      eventMappings: config.eventMappings as Record<string, string> | null,
      environment: config.environment,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
    };

    // 更新配置，将当前配置保存到 previousConfig，版本号+1
    const newVersion = config.configVersion + 1;

    await prisma.pixelConfig.update({
      where: {
        shopId_platform: {
          shopId,
          platform,
        },
      },
      data: {
        previousConfig: currentConfig as object,
        configVersion: newVersion,
        rollbackAllowed: true,
      },
    });

    logger.info("Config snapshot saved", { shopId, platform, version: newVersion });
    return { success: true, version: newVersion };
  } catch (error) {
    logger.error("Failed to save config snapshot", { shopId, platform, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "保存快照失败",
    };
  }
}

/**
 * 获取配置版本历史
 */
export async function getConfigVersionHistory(
  shopId: string,
  platform: Platform
): Promise<ConfigVersionHistory | null> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: {
        shopId_platform: {
          shopId,
          platform,
        },
      },
    });

    if (!config) {
      return null;
    }

    const versions: ConfigVersion[] = [];

    // 当前版本
    versions.push({
      version: config.configVersion,
      config: {
        platformId: config.platformId,
        credentialsEncrypted: config.credentialsEncrypted,
        eventMappings: config.eventMappings as Record<string, string> | null,
        environment: config.environment,
        clientSideEnabled: config.clientSideEnabled,
        serverSideEnabled: config.serverSideEnabled,
      },
      savedAt: config.updatedAt,
    });

    // 上一个版本（如果有）
    if (config.previousConfig) {
      const previous = config.previousConfig as {
        platformId?: string | null;
        credentialsEncrypted?: string | null;
        eventMappings?: Record<string, string> | null;
        environment?: string;
        clientSideEnabled?: boolean;
        serverSideEnabled?: boolean;
      };

      versions.push({
        version: config.configVersion - 1,
        config: {
          platformId: previous.platformId || null,
          credentialsEncrypted: previous.credentialsEncrypted || null,
          eventMappings: previous.eventMappings || null,
          environment: previous.environment || "test",
          clientSideEnabled: previous.clientSideEnabled ?? true,
          serverSideEnabled: previous.serverSideEnabled ?? false,
        },
        savedAt: config.updatedAt, // 使用当前更新时间作为参考
      });
    }

    return {
      currentVersion: config.configVersion,
      versions: versions.sort((a, b) => b.version - a.version),
      canRollback: config.rollbackAllowed && config.previousConfig !== null,
    };
  } catch (error) {
    logger.error("Failed to get config version history", { shopId, platform, error });
    return null;
  }
}

/**
 * 回滚到上一个版本
 */
export async function rollbackConfig(
  shopId: string,
  platform: Platform
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: {
        shopId_platform: {
          shopId,
          platform,
        },
      },
    });

    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    if (!config.rollbackAllowed || !config.previousConfig) {
      return { success: false, error: "无法回滚：没有可用的上一个版本" };
    }

    const previous = config.previousConfig as {
      platformId?: string | null;
      credentialsEncrypted?: string | null;
      eventMappings?: Record<string, string> | null;
      environment?: string;
      clientSideEnabled?: boolean;
      serverSideEnabled?: boolean;
    };

    // 保存当前配置为新的 previousConfig（以便可以再次回滚）
    const currentConfig = {
      platformId: config.platformId,
      credentialsEncrypted: config.credentialsEncrypted,
      eventMappings: config.eventMappings,
      environment: config.environment,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
    };

    // 回滚到上一个版本
    await prisma.pixelConfig.update({
      where: {
        shopId_platform: {
          shopId,
          platform,
        },
      },
      data: {
        platformId: previous.platformId || null,
        credentialsEncrypted: previous.credentialsEncrypted || null,
        eventMappings: previous.eventMappings as object || null,
        environment: previous.environment || "test",
        clientSideEnabled: previous.clientSideEnabled ?? true,
        serverSideEnabled: previous.serverSideEnabled ?? false,
        previousConfig: currentConfig as object,
        configVersion: config.configVersion + 1, // 版本号递增
        rollbackAllowed: true,
      },
    });

    logger.info("Config rolled back", { shopId, platform, newVersion: config.configVersion + 1 });
    return { success: true };
  } catch (error) {
    logger.error("Failed to rollback config", { shopId, platform, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "回滚失败",
    };
  }
}

