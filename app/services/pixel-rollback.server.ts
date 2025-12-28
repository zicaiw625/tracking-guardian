/**
 * 像素配置回滚服务
 * 对应设计方案 4.3 Pixels - 配置版本与回滚
 * 
 * 功能:
 * - 保存配置快照
 * - 一键回滚到上个版本
 * - 环境切换 (Test/Live)
 */

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { createAuditLogEntry } from "./db/audit-repository.server";

// ============================================================
// 类型定义
// ============================================================

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

// ============================================================
// 配置快照管理
// ============================================================

/**
 * 在更新配置前保存快照
 */
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

/**
 * 回滚到上一个版本
 */
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

    // 执行回滚
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
        // 回滚后清除快照，防止连续回滚
        previousConfig: null,
        rollbackAllowed: false,
        configVersion: { increment: 1 },
      },
    });

    // 记录审计日志
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

// ============================================================
// 环境切换
// ============================================================

/**
 * 切换环境 (Test/Live)
 */
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

    // 切换前保存快照
    await saveConfigSnapshot(shopId, platform);

    // 执行切换
    await prisma.pixelConfig.update({
      where: { id: config.id },
      data: {
        environment: newEnvironment,
      },
    });

    // 记录审计日志
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

/**
 * 获取配置的版本历史信息
 */
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

/**
 * 批量获取所有平台的版本信息
 */
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

