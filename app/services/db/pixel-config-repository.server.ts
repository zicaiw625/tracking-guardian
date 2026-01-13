import { randomUUID } from "crypto";
import prisma from "../../db.server";
import { SimpleCache } from "../../utils/cache";
import { type PlatformType } from "../../types/enums";
import type { PixelConfig, Prisma } from "@prisma/client";
import { saveConfigSnapshot } from "../pixel-rollback.server";
import { logger } from "../../utils/logger.server";

export interface PixelConfigCredentials {
  id: string;
  platform: string;
  platformId: string | null;
  credentialsEncrypted: string | null;
  credentials_legacy: Prisma.JsonValue | null;
  clientConfig: Prisma.JsonValue;
  environment: string | null;
  eventMappings: Prisma.JsonValue | null;
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
  environment?: string;
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
  credentials_legacy: true,
  clientConfig: true,
  environment: true,
  eventMappings: true,
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
  options: { serverSideOnly?: boolean; skipCache?: boolean; environment?: "test" | "live" } = {}
): Promise<PixelConfigCredentials[]> {
  const { serverSideOnly = false, skipCache = false, environment } = options;
  const cacheKey = `configs:${shopId}:${serverSideOnly ? "server" : "all"}:${environment || "live"}`;
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
  if (environment) {
    where.environment = environment;
  } else {
    where.environment = "live";
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
  const v1SupportedPlatforms = ["google", "meta", "tiktok"];
  if (!v1SupportedPlatforms.includes(input.platform)) {
    throw new Error(
      `平台 ${input.platform} 在 v1.0 版本中不支持。v1.0 仅支持: ${v1SupportedPlatforms.join(", ")}。` +
      `其他平台（如 Snapchat、Twitter、Pinterest）将在 v1.1+ 版本中提供支持。`
    );
  }
  const { checkV1FeatureBoundary } = await import("../../utils/version-gate");
  if (input.serverSideEnabled) {
    const gateResult = checkV1FeatureBoundary("server_side");
    if (!gateResult.allowed) {
      throw new Error(gateResult.reason || "此功能在当前版本中不可用");
    }
    const { requireEntitlementOrThrow } = await import("../billing/entitlement.server");
    await requireEntitlementOrThrow(shopId, "pixel_destinations");
  }
  if (input.clientConfig && typeof input.clientConfig === 'object' && 'mode' in input.clientConfig) {
    const mode = (input.clientConfig as { mode?: string }).mode;
    if (mode === 'full_funnel') {
      await requireEntitlementOrThrow(shopId, "full_funnel");
    }
  }
  const { platform, ...data } = input;
  const { saveSnapshot = true } = options || {};
  if (data.serverSideEnabled === true && !data.credentialsEncrypted) {
    throw new Error(
      "启用服务端追踪时必须提供 credentialsEncrypted。如果只需要客户端追踪，请设置 serverSideEnabled: false。"
    );
  }
  const environment = input.environment || "test";
  const platformId = data.platformId ?? null;
  const existingConfig = platformId
    ? await prisma.pixelConfig.findUnique({
        where: {
          shopId_platform_environment_platformId: {
            shopId,
            platform,
            environment,
            platformId,
          },
        },
      })
    : await prisma.pixelConfig.findFirst({
        where: {
          shopId,
          platform,
          environment,
          platformId: null,
        },
      });
  if (existingConfig && saveSnapshot) {
    await saveConfigSnapshot(shopId, platform, environment as "test" | "live").catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to save config snapshot", {
        shopId,
        platform,
        errorMessage,
      });
    });
  }
  const config = platformId
    ? await prisma.pixelConfig.upsert({
        where: {
          shopId_platform_environment_platformId: {
            shopId,
            platform,
            environment,
            platformId,
          },
        },
        create: {
          id: randomUUID(),
          shopId,
          platform,
          platformId,
          credentialsEncrypted: data.credentialsEncrypted ?? null,
          clientConfig: data.clientConfig ?? undefined,
          clientSideEnabled: data.clientSideEnabled ?? true,
          serverSideEnabled: data.serverSideEnabled ?? false,
          eventMappings: data.eventMappings ?? undefined,
          isActive: data.isActive ?? true,
          configVersion: 1,
          environment,
          updatedAt: new Date(),
        } as unknown as Prisma.PixelConfigCreateInput,
        update: {
          platformId: data.platformId ?? undefined,
          credentialsEncrypted: data.credentialsEncrypted ?? undefined,
          clientConfig: data.clientConfig ?? undefined,
          clientSideEnabled: data.clientSideEnabled ?? undefined,
          serverSideEnabled: data.serverSideEnabled ?? false,
          eventMappings: data.eventMappings ?? undefined,
          isActive: data.isActive ?? undefined,
        },
      })
    : (async () => {
        const existing = await prisma.pixelConfig.findFirst({
          where: {
            shopId,
            platform,
            environment,
            platformId: null,
          },
        });
        if (existing) {
          return await prisma.pixelConfig.update({
            where: { id: existing.id },
            data: {
              credentialsEncrypted: data.credentialsEncrypted ?? null,
              clientConfig: data.clientConfig ?? undefined,
              clientSideEnabled: data.clientSideEnabled ?? false,
              serverSideEnabled: data.serverSideEnabled ?? false,
              eventMappings: data.eventMappings ?? undefined,
              isActive: data.isActive ?? true,
              ...(("migrationStatus" in data && data.migrationStatus) ? { migrationStatus: data.migrationStatus as string } : {}),
              updatedAt: new Date(),
            },
          });
        } else {
          return await prisma.pixelConfig.create({
            data: {
              id: randomUUID(),
              shopId,
              platform,
              platformId: null,
              environment,
              credentialsEncrypted: data.credentialsEncrypted ?? null,
              clientConfig: data.clientConfig ?? undefined,
              clientSideEnabled: data.clientSideEnabled ?? false,
              serverSideEnabled: data.serverSideEnabled ?? false,
              eventMappings: data.eventMappings ?? undefined,
              isActive: data.isActive ?? true,
              migrationStatus: ("migrationStatus" in data && data.migrationStatus) ? (data.migrationStatus as string) : "not_started",
              updatedAt: new Date(),
            } as unknown as Prisma.PixelConfigCreateInput,
          });
        }
      })();
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
  shopPixelConfigsCache.delete(`configs:${shopId}:all:live`);
  shopPixelConfigsCache.delete(`configs:${shopId}:all:test`);
  shopPixelConfigsCache.delete(`configs:${shopId}:server:live`);
  shopPixelConfigsCache.delete(`configs:${shopId}:server:test`);
}

export function clearPixelConfigCache(): void {
  shopPixelConfigsCache.clear();
}
