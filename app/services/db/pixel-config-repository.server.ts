

import prisma from "../../db.server";
import { SimpleCache } from "../../utils/cache";
import { type PlatformType } from "../../types/enums";
import type { PixelConfig, Prisma } from "@prisma/client";

export interface PixelConfigCredentials {
  id: string;
  platform: string;
  platformId: string | null;
  credentialsEncrypted: string | null;
  credentials: Prisma.JsonValue;
  clientConfig: Prisma.JsonValue;
}

export type PixelConfigFull = PixelConfig;

export interface PixelConfigSummary {
  id: string;
  platform: string;
  platformId: string | null;
  isActive: boolean;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  migrationStatus: string;
  updatedAt: Date;
}

export interface PixelConfigInput {
  platform: PlatformType;
  platformId?: string | null;
  credentialsEncrypted?: string | null;
  clientConfig?: Prisma.InputJsonValue;
  clientSideEnabled?: boolean;
  serverSideEnabled?: boolean;
  eventMappings?: Prisma.InputJsonValue;
  isActive?: boolean;
}

const shopPixelConfigsCache = new SimpleCache<PixelConfigCredentials[]>({
  maxSize: 500,
  defaultTtlMs: 60 * 1000,
});

const CREDENTIALS_SELECT = {
  id: true,
  platform: true,
  platformId: true,
  credentialsEncrypted: true,
  credentials: true,
  clientConfig: true,
} as const;

const SUMMARY_SELECT = {
  id: true,
  platform: true,
  platformId: true,
  isActive: true,
  clientSideEnabled: true,
  serverSideEnabled: true,
  migrationStatus: true,
  updatedAt: true,
} as const;

export async function getShopPixelConfigs(
  shopId: string,
  options: { serverSideOnly?: boolean; skipCache?: boolean } = {}
): Promise<PixelConfigCredentials[]> {
  const { serverSideOnly = false, skipCache = false } = options;
  const cacheKey = `configs:${shopId}:${serverSideOnly ? "server" : "all"}`;

  if (!skipCache) {
    const cached = shopPixelConfigsCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const where: Prisma.PixelConfigWhereInput = {
    shopId,
    isActive: true,
  };

  if (serverSideOnly) {
    where.serverSideEnabled = true;
  }

  const configs = await prisma.pixelConfig.findMany({
    where,
    select: CREDENTIALS_SELECT,
  });

  shopPixelConfigsCache.set(cacheKey, configs);
  return configs;
}

export async function getPixelConfigByPlatform(
  shopId: string,
  platform: PlatformType
): Promise<PixelConfigFull | null> {
  return prisma.pixelConfig.findFirst({
    where: {
      shopId,
      platform,
    },
  });
}

export async function getPixelConfigById(
  configId: string
): Promise<PixelConfigFull | null> {
  return prisma.pixelConfig.findUnique({
    where: { id: configId },
  });
}

export async function getPixelConfigSummaries(
  shopId: string
): Promise<PixelConfigSummary[]> {
  const configs = await prisma.pixelConfig.findMany({
    where: { shopId },
    select: SUMMARY_SELECT,
    orderBy: { platform: "asc" },
  });

  return configs;
}

export async function upsertPixelConfig(
  shopId: string,
  input: PixelConfigInput,
  options?: { saveSnapshot?: boolean }
): Promise<PixelConfigFull> {
  const { platform, ...data } = input;
  const { saveSnapshot = true } = options || {};

  if (data.serverSideEnabled === true && !data.credentialsEncrypted) {
    throw new Error(
      "启用服务端追踪时必须提供 credentialsEncrypted。如果只需要客户端追踪，请设置 serverSideEnabled: false。"
    );
  }

  const existingConfig = await prisma.pixelConfig.findUnique({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
  });

  if (existingConfig && saveSnapshot) {
    const { saveConfigSnapshot } = await import("../pixel-rollback.server");
    await saveConfigSnapshot(shopId, platform).catch((error) => {

      console.warn("Failed to save config snapshot", { shopId, platform, error });
    });
  }

  const config = await prisma.pixelConfig.upsert({
    where: {
      shopId_platform: {
        shopId,
        platform,
      },
    },
    create: {
      shopId,
      platform,
      platformId: data.platformId ?? null,
      credentialsEncrypted: data.credentialsEncrypted ?? null,
      clientConfig: data.clientConfig ?? undefined,
      clientSideEnabled: data.clientSideEnabled ?? true,
      serverSideEnabled: data.serverSideEnabled ?? false,
      eventMappings: data.eventMappings ?? undefined,
      isActive: data.isActive ?? true,
      configVersion: 1,
      environment: "test",
    },

    update: {
      platformId: data.platformId ?? undefined,
      credentialsEncrypted: data.credentialsEncrypted ?? undefined,
      clientConfig: data.clientConfig ?? undefined,
      clientSideEnabled: data.clientSideEnabled ?? undefined,
      serverSideEnabled: data.serverSideEnabled ?? undefined,
      eventMappings: data.eventMappings ?? undefined,
      isActive: data.isActive ?? undefined,

    },
  });

  invalidatePixelConfigCache(shopId);

  return config;
}

export async function deactivatePixelConfig(
  shopId: string,
  platform: PlatformType
): Promise<boolean> {
  try {
    await prisma.pixelConfig.updateMany({
      where: {
        shopId,
        platform,
      },
      data: {
        isActive: false,
      },
    });

    invalidatePixelConfigCache(shopId);
    return true;
  } catch {
    return false;
  }
}

export async function deletePixelConfig(
  shopId: string,
  platform: PlatformType
): Promise<boolean> {
  try {
    await prisma.pixelConfig.deleteMany({
      where: {
        shopId,
        platform,
      },
    });

    invalidatePixelConfigCache(shopId);
    return true;
  } catch {
    return false;
  }
}

export async function batchGetPixelConfigs(
  shopIds: string[],
  serverSideOnly: boolean = false
): Promise<Map<string, PixelConfigCredentials[]>> {
  if (shopIds.length === 0) return new Map();

  const uniqueIds = [...new Set(shopIds)];

  const where: Prisma.PixelConfigWhereInput = {
    shopId: { in: uniqueIds },
    isActive: true,
  };

  if (serverSideOnly) {
    where.serverSideEnabled = true;
  }

  const configs = await prisma.pixelConfig.findMany({
    where,
    select: CREDENTIALS_SELECT,
  });

  const result = new Map<string, PixelConfigCredentials[]>();
  for (const shopId of uniqueIds) {
    result.set(shopId, []);
  }

  for (const config of configs) {

  }

  const configsWithShop = await prisma.pixelConfig.findMany({
    where,
    select: {
      ...CREDENTIALS_SELECT,
      shopId: true,
    },
  });

  for (const config of configsWithShop) {
    const shopConfigs = result.get(config.shopId);
    if (shopConfigs) {
      shopConfigs.push(config);
    }
  }

  return result;
}

export async function hasServerSideConfigs(shopId: string): Promise<boolean> {
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
      serverSideEnabled: true,
      credentialsEncrypted: { not: null },
    },
    select: { credentialsEncrypted: true },
  });

  return configs.some(
    (config) =>
      config.credentialsEncrypted &&
      config.credentialsEncrypted.trim().length > 0
  );
}

export async function getConfiguredPlatforms(
  shopId: string
): Promise<PlatformType[]> {
  const configs = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
    },
    select: { platform: true },
  });

  return configs.map((c) => c.platform as PlatformType);
}

export function invalidatePixelConfigCache(shopId: string): void {
  shopPixelConfigsCache.delete(`configs:${shopId}:all`);
  shopPixelConfigsCache.delete(`configs:${shopId}:server`);
}

export function clearPixelConfigCache(): void {
  shopPixelConfigsCache.clear();
}

