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

export async function saveConfigSnapshot(
  shopId: string,
  platform: Platform,
  environment: "test" | "live" = "live"
): Promise<{ success: boolean; version?: number; error?: string }> {
  try {
    const config = await prisma.pixelConfig.findFirst({
      where: {
        shopId,
        platform,
        environment,
        platformId: null,
      },
    });

    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    const currentConfig = {
      platformId: config.platformId,
      credentialsEncrypted: config.credentialsEncrypted,
      eventMappings: config.eventMappings as Record<string, string> | null,
      environment: config.environment,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
    };

    const newVersion = config.configVersion + 1;

    await prisma.pixelConfig.update({
      where: { id: config.id },
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

export async function getConfigVersionHistory(
  shopId: string,
  platform: Platform,
  environment: "test" | "live" = "live"
): Promise<ConfigVersionHistory | null> {
  try {
    const config = await prisma.pixelConfig.findFirst({
      where: {
        shopId,
        platform,
        environment,
        platformId: null,
      },
    });

    if (!config) {
      return null;
    }

    const versions: ConfigVersion[] = [];

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
        savedAt: config.updatedAt,
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

export async function rollbackConfig(
  shopId: string,
  platform: Platform,
  environment: "test" | "live" = "live"
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await prisma.pixelConfig.findFirst({
      where: {
        shopId,
        platform,
        environment,
        platformId: null,
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

    const currentConfig = {
      platformId: config.platformId,
      credentialsEncrypted: config.credentialsEncrypted,
      eventMappings: config.eventMappings,
      environment: config.environment,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
    };

    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        platformId: previous.platformId || null,
        credentialsEncrypted: previous.credentialsEncrypted || null,
        eventMappings: previous.eventMappings as object || null,
        environment: previous.environment || "test",
        clientSideEnabled: previous.clientSideEnabled ?? true,
        serverSideEnabled: previous.serverSideEnabled ?? false,
        previousConfig: currentConfig as object,
        configVersion: config.configVersion + 1,
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
