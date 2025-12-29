

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { createAuditLogEntry } from "./db/audit-repository.server";

export type PixelEnvironment = "test" | "live";

export interface PixelConfigSnapshot {
  platformId: string | null;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  eventMappings: Record<string, unknown> | null;
  clientConfig: Record<string, unknown> | null;
  environment: PixelEnvironment;
  credentialsEncrypted: string | null;
}

export interface RollbackResult {
  success: boolean;
  message: string;
  previousVersion?: number;
  currentVersion?: number;
}

export interface EnvironmentSwitchResult {
  success: boolean;
  message: string;
  previousEnvironment?: PixelEnvironment;
  newEnvironment?: PixelEnvironment;
}

export async function saveConfigSnapshot(
  shopId: string,
  platform: string
): Promise<boolean> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: { shopId_platform: { shopId, platform } },
    });

    if (!config) {
      logger.warn("No config to snapshot", { shopId, platform });
      return false;
    }

    const snapshot: PixelConfigSnapshot = {
      platformId: config.platformId,
      clientSideEnabled: config.clientSideEnabled,
      serverSideEnabled: config.serverSideEnabled,
      eventMappings: config.eventMappings as Record<string, unknown> | null,
      clientConfig: config.clientConfig as Record<string, unknown> | null,
      environment: config.environment as PixelEnvironment,
      credentialsEncrypted: config.credentialsEncrypted,
    };

    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        previousConfig: snapshot as object,
        configVersion: { increment: 1 },
        rollbackAllowed: true,
      },
    });

    logger.info("Config snapshot saved", {
      shopId,
      platform,
      version: config.configVersion + 1
    });
    return true;
  } catch (error) {
    logger.error("Failed to save config snapshot", { shopId, platform, error });
    return false;
  }
}

export async function rollbackConfig(
  shopId: string,
  platform: string
): Promise<RollbackResult> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: { shopId_platform: { shopId, platform } },
    });

    if (!config) {
      return {
        success: false,
        message: "配置不存在",
      };
    }

    if (!config.rollbackAllowed || !config.previousConfig) {
      return {
        success: false,
        message: "没有可回滚的版本",
      };
    }

    const snapshot = config.previousConfig as PixelConfigSnapshot;
    const previousVersion = config.configVersion;

    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        platformId: snapshot.platformId,
        clientSideEnabled: snapshot.clientSideEnabled,
        serverSideEnabled: snapshot.serverSideEnabled,
        eventMappings: snapshot.eventMappings as object,
        clientConfig: snapshot.clientConfig as object,
        environment: snapshot.environment,
        credentialsEncrypted: snapshot.credentialsEncrypted,

        previousConfig: null,
        rollbackAllowed: false,
        configVersion: { increment: 1 },
      },
    });

    await createAuditLogEntry(shopId, {
      actorType: "user",
      action: "pixel_config_updated",
      resourceType: "pixel_config",
      resourceId: config.id,
      metadata: {
        operation: "rollback",
        platform,
        previousVersion,
        newVersion: config.configVersion + 1,
      },
    });

    logger.info("Config rolled back", {
      shopId,
      platform,
      fromVersion: previousVersion,
      toVersion: config.configVersion + 1,
    });

    return {
      success: true,
      message: `已回滚到版本 ${config.configVersion + 1}`,
      previousVersion,
      currentVersion: config.configVersion + 1,
    };
  } catch (error) {
    logger.error("Failed to rollback config", { shopId, platform, error });
    return {
      success: false,
      message: "回滚失败，请稍后重试",
    };
  }
}

export async function switchEnvironment(
  shopId: string,
  platform: string,
  newEnvironment: PixelEnvironment
): Promise<EnvironmentSwitchResult> {
  try {
    const config = await prisma.pixelConfig.findUnique({
      where: { shopId_platform: { shopId, platform } },
    });

    if (!config) {
      return {
        success: false,
        message: "配置不存在",
      };
    }

    const previousEnvironment = config.environment as PixelEnvironment;

    if (previousEnvironment === newEnvironment) {
      return {
        success: true,
        message: `已在 ${newEnvironment} 环境`,
        previousEnvironment,
        newEnvironment,
      };
    }

    await saveConfigSnapshot(shopId, platform);

    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        environment: newEnvironment,
      },
    });

    await createAuditLogEntry(shopId, {
      actorType: "user",
      action: "pixel_config_updated",
      resourceType: "pixel_config",
      resourceId: config.id,
      metadata: {
        operation: "environment_switch",
        platform,
        previousEnvironment,
        newEnvironment,
      },
    });

    logger.info("Environment switched", {
      shopId,
      platform,
      from: previousEnvironment,
      to: newEnvironment
    });

    return {
      success: true,
      message: `已切换到 ${newEnvironment === "live" ? "生产" : "测试"} 环境`,
      previousEnvironment,
      newEnvironment,
    };
  } catch (error) {
    logger.error("Failed to switch environment", { shopId, platform, error });
    return {
      success: false,
      message: "切换失败，请稍后重试",
    };
  }
}

export async function getConfigVersionInfo(
  shopId: string,
  platform: string
): Promise<{
  currentVersion: number;
  hasRollback: boolean;
  environment: PixelEnvironment;
  lastUpdated: Date;
} | null> {
  const config = await prisma.pixelConfig.findUnique({
    where: { shopId_platform: { shopId, platform } },
    select: {
      configVersion: true,
      rollbackAllowed: true,
      previousConfig: true,
      environment: true,
      updatedAt: true,
    },
  });

  if (!config) return null;

  return {
    currentVersion: config.configVersion,
    hasRollback: config.rollbackAllowed && config.previousConfig !== null,
    environment: config.environment as PixelEnvironment,
    lastUpdated: config.updatedAt,
  };
}

export async function getAllConfigVersions(
  shopId: string
): Promise<Array<{
  platform: string;
  currentVersion: number;
  hasRollback: boolean;
  environment: PixelEnvironment;
  isActive: boolean;
}>> {
  const configs = await prisma.pixelConfig.findMany({
    where: { shopId },
    select: {
      platform: true,
      configVersion: true,
      rollbackAllowed: true,
      previousConfig: true,
      environment: true,
      isActive: true,
    },
  });

  return configs.map(c => ({
    platform: c.platform,
    currentVersion: c.configVersion,
    hasRollback: c.rollbackAllowed && c.previousConfig !== null,
    environment: c.environment as PixelEnvironment,
    isActive: c.isActive,
  }));
}

export async function getConfigComparison(
  shopId: string,
  platform: string
): Promise<{
  current: PixelConfigSnapshot & { version: number; updatedAt: Date };
  previous: PixelConfigSnapshot | null;
  differences: Array<{
    field: string;
    current: unknown;
    previous: unknown;
    changed: boolean;
  }>;
} | null> {
  const config = await prisma.pixelConfig.findUnique({
    where: { shopId_platform: { shopId, platform } },
    select: {
      platformId: true,
      clientSideEnabled: true,
      serverSideEnabled: true,
      eventMappings: true,
      clientConfig: true,
      environment: true,
      credentialsEncrypted: true,
      previousConfig: true,
      configVersion: true,
      updatedAt: true,
    },
  });

  if (!config) return null;

  const current: PixelConfigSnapshot & { version: number; updatedAt: Date } = {
    platformId: config.platformId,
    clientSideEnabled: config.clientSideEnabled,
    serverSideEnabled: config.serverSideEnabled,
    eventMappings: config.eventMappings as Record<string, unknown> | null,
    clientConfig: config.clientConfig as Record<string, unknown> | null,
    environment: config.environment as PixelEnvironment,
    credentialsEncrypted: config.credentialsEncrypted,
    version: config.configVersion,
    updatedAt: config.updatedAt,
  };

  const previous = config.previousConfig as PixelConfigSnapshot | null;

  const differences: Array<{
    field: string;
    current: unknown;
    previous: unknown;
    changed: boolean;
  }> = [];

  if (previous) {
    const fields: Array<keyof PixelConfigSnapshot> = [
      "platformId",
      "clientSideEnabled",
      "serverSideEnabled",
      "eventMappings",
      "clientConfig",
      "environment",
    ];

    for (const field of fields) {
      const currentValue = current[field];
      const previousValue = previous[field];
      const changed = JSON.stringify(currentValue) !== JSON.stringify(previousValue);

      differences.push({
        field,
        current: currentValue,
        previous: previousValue,
        changed,
      });
    }

    differences.push({
      field: "credentialsEncrypted",
      current: current.credentialsEncrypted ? "***已设置***" : null,
      previous: previous.credentialsEncrypted ? "***已设置***" : null,
      changed: !!current.credentialsEncrypted !== !!previous.credentialsEncrypted,
    });
  }

  return {
    current,
    previous,
    differences,
  };
}

export async function getConfigVersionHistory(
  shopId: string,
  platform: string,
  limit: number = 10
): Promise<Array<{
  version: number;
  timestamp: Date;
  operation: string;
  changes: Record<string, unknown>;
}>> {
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      shopId,
      resourceType: "pixel_config",
      action: {
        in: ["pixel_config_updated", "pixel_config_changed"],
      },
      metadata: {
        path: ["platform"],
        equals: platform,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      createdAt: true,
      metadata: true,
      action: true,
    },
  });

  return auditLogs.map((log, index) => {
    const metadata = log.metadata as Record<string, unknown>;
    return {
      version: (metadata.newVersion as number) || (metadata.currentVersion as number) || (limit - index),
      timestamp: log.createdAt,
      operation: metadata.operation as string || log.action,
      changes: metadata as Record<string, unknown>,
    };
  });
}

