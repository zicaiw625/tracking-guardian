import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger.server";
import { createAuditLogEntry } from "./db/audit-repository.server";
import { toInputJsonValue } from "../utils/prisma-json";

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

async function findDeterministicConfig(params: {
  shopId: string;
  platform: string;
  environment: PixelEnvironment;
  platformId?: string | null;
  select?: Prisma.PixelConfigSelect;
}) {
  const { shopId, platform, environment, platformId, select } = params;
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      platform,
      environment,
      ...(platformId !== undefined ? { platformId } : {}),
    },
    orderBy: [
      { isActive: "desc" },
      { updatedAt: "desc" },
      { id: "asc" },
    ],
    ...(select ? { select } : {}),
    take: 2,
  });

  if (configs.length > 1 && platformId === undefined) {
    logger.warn("Multiple pixel configs matched; using deterministic selection", {
      shopId,
      platform,
      environment,
      candidates: configs.map((c) => ("id" in c ? c.id : "unknown")),
    });
  }

  return configs[0] ?? null;
}

export async function saveConfigSnapshot(
  shopId: string,
  platform: string,
  environment: PixelEnvironment = "live"
): Promise<boolean> {
  try {
    const config = await findDeterministicConfig({ shopId, platform, environment });
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
  platform: string,
  environment: PixelEnvironment = "live"
): Promise<RollbackResult> {
  try {
    const config = await findDeterministicConfig({ shopId, platform, environment });
    if (!config) {
      return {
        success: false,
        message: "Configuration not found",
      };
    }
    if (!config.rollbackAllowed || !config.previousConfig) {
      return {
        success: false,
        message: "No rollback version available",
      };
    }
    const snapshot = config.previousConfig as unknown as PixelConfigSnapshot;
    const previousVersion = config.configVersion;
    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        platformId: snapshot.platformId,
        clientSideEnabled: snapshot.clientSideEnabled,
        serverSideEnabled: snapshot.serverSideEnabled,
        eventMappings: snapshot.eventMappings as Prisma.InputJsonValue,
        clientConfig: snapshot.clientConfig as Prisma.InputJsonValue,
        environment: snapshot.environment,
        credentialsEncrypted: snapshot.credentialsEncrypted,
        previousConfig: Prisma.JsonNull,
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
      message: `Rolled back to version ${config.configVersion + 1}`,
      previousVersion,
      currentVersion: config.configVersion + 1,
    };
  } catch (error) {
    logger.error("Failed to rollback config", { shopId, platform, error });
    return {
      success: false,
      message: "Rollback failed, please try again later",
    };
  }
}

export async function switchEnvironment(
  shopId: string,
  platform: string,
  newEnvironment: PixelEnvironment,
  currentEnvironment?: PixelEnvironment
): Promise<EnvironmentSwitchResult> {
  try {
    let actualCurrentEnvironment = currentEnvironment;
    if (!actualCurrentEnvironment) {
      const activeConfig = await prisma.pixelConfig.findFirst({
        where: {
          shopId,
          platform,
          isActive: true,
        },
        select: {
          environment: true,
        },
      });
      actualCurrentEnvironment = (activeConfig?.environment as PixelEnvironment) || "test";
    }
    const config = await findDeterministicConfig({
      shopId,
      platform,
      environment: actualCurrentEnvironment,
    });
    if (!config) {
      return {
        success: false,
        message: "Configuration not found",
      };
    }
    const previousEnvironment = config.environment as PixelEnvironment;
    if (previousEnvironment === newEnvironment) {
      return {
        success: true,
        message: `Already in ${newEnvironment} environment`,
        previousEnvironment,
        newEnvironment,
      };
    }
    await prisma.$transaction(async (tx) => {
      const snapshot: PixelConfigSnapshot = {
        platformId: config.platformId,
        clientSideEnabled: config.clientSideEnabled,
        serverSideEnabled: config.serverSideEnabled,
        eventMappings: config.eventMappings as Record<string, unknown> | null,
        clientConfig: config.clientConfig as Record<string, unknown> | null,
        environment: config.environment as PixelEnvironment,
        credentialsEncrypted: config.credentialsEncrypted,
      };

      await tx.pixelConfig.update({
        where: { id: config.id },
        data: {
          previousConfig: snapshot as object,
          configVersion: { increment: 1 },
          rollbackAllowed: true,
        },
      });

      const targetConfig = await tx.pixelConfig.findFirst({
        where: {
          shopId,
          platform,
          environment: newEnvironment,
          platformId: config.platformId,
        },
      });

      if (targetConfig) {
        await tx.pixelConfig.update({
          where: { id: targetConfig.id },
          data: {
            platformId: config.platformId,
            credentialsEncrypted: config.credentialsEncrypted,
            serverSideEnabled: config.serverSideEnabled,
            clientSideEnabled: config.clientSideEnabled,
            eventMappings: toInputJsonValue(config.eventMappings),
            clientConfig: toInputJsonValue(config.clientConfig),
            isActive: config.isActive,
          },
        });
        await tx.pixelConfig.update({
          where: { id: config.id },
          data: {
            isActive: false,
          },
        });
      } else {
        await tx.pixelConfig.update({
          where: { id: config.id },
          data: {
            environment: newEnvironment,
          },
        });
      }
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
      message: `Switched to ${newEnvironment === "live" ? "production" : "test"} environment`,
      previousEnvironment,
      newEnvironment,
    };
  } catch (error) {
    logger.error("Failed to switch environment", { shopId, platform, error });
    return {
      success: false,
      message: "Switch failed, please try again later",
    };
  }
}

export async function getConfigVersionInfo(
  shopId: string,
  platform: string,
  environment: PixelEnvironment = "live"
): Promise<{
  currentVersion: number;
  hasRollback: boolean;
  environment: PixelEnvironment;
  lastUpdated: Date;
} | null> {
  const config = await findDeterministicConfig({
    shopId,
    platform,
    environment,
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

function redactCredentials<T extends object>(obj: T | null): T | null {
  if (!obj) return obj;
  const copy = { ...obj } as Record<string, unknown>;
  if ("credentialsEncrypted" in copy) copy.credentialsEncrypted = copy.credentialsEncrypted ? "***configured***" : null;
  if ("credentials_legacy" in copy) copy.credentials_legacy = copy.credentials_legacy ? "***configured***" : null;
  return copy as T;
}

export async function getConfigComparison(
  shopId: string,
  platform: string,
  environment: PixelEnvironment = "live"
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
  const config = await findDeterministicConfig({
    shopId,
    platform,
    environment,
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
    credentialsEncrypted: config.credentialsEncrypted ? "***configured***" : null,
    version: config.configVersion,
    updatedAt: config.updatedAt,
  };
  const previous = redactCredentials(config.previousConfig as PixelConfigSnapshot | null);
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
      current: current.credentialsEncrypted ? "***configured***" : null,
      previous: previous.credentialsEncrypted ? "***configured***" : null,
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
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      platform,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      configVersion: true,
      updatedAt: true,
      previousConfig: true,
    },
  });
  return configs.map((config, _index) => {
    const previousConfig = config.previousConfig as Record<string, unknown> | null;
    const redactedConfig = redactCredentials(previousConfig);
    return {
      version: config.configVersion,
      timestamp: config.updatedAt,
      operation: "pixel_config_updated",
      changes: redactedConfig || {},
    };
  });
}
