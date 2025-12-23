/**
 * Pixel Config Repository
 *
 * Centralized data access layer for PixelConfig entities.
 * Provides type-safe operations for platform credential management.
 */

import prisma from "../../db.server";
import { SimpleCache } from "../../utils/cache";
import { Platform, type PlatformType } from "../../types/enums";
import type { PixelConfig, Prisma } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal fields for credential lookup.
 */
export interface PixelConfigCredentials {
  id: string;
  platform: string;
  platformId: string | null;
  credentialsEncrypted: string | null;
  credentials: Prisma.JsonValue;
  clientConfig: Prisma.JsonValue;
}

/**
 * Full pixel config with all fields.
 */
export interface PixelConfigFull extends PixelConfig {}

/**
 * Summary for displaying in UI.
 */
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

/**
 * Create/update input for pixel config.
 */
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

// =============================================================================
// Cache
// =============================================================================

// Cache for shop's pixel configs (short TTL, frequently updated)
const shopPixelConfigsCache = new SimpleCache<PixelConfigCredentials[]>({
  maxSize: 500,
  defaultTtlMs: 60 * 1000, // 1 minute
});

// =============================================================================
// Select Fields
// =============================================================================

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

// =============================================================================
// Repository Functions
// =============================================================================

/**
 * Get all active pixel configs for a shop (cached).
 */
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

/**
 * Get a specific pixel config by shop and platform.
 */
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

/**
 * Get pixel config by ID.
 */
export async function getPixelConfigById(
  configId: string
): Promise<PixelConfigFull | null> {
  return prisma.pixelConfig.findUnique({
    where: { id: configId },
  });
}

/**
 * Get summaries for all configs of a shop.
 */
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

/**
 * Create or update a pixel config (upsert).
 */
export async function upsertPixelConfig(
  shopId: string,
  input: PixelConfigInput
): Promise<PixelConfigFull> {
  const { platform, ...data } = input;

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
    },
    update: {
      platformId: data.platformId,
      credentialsEncrypted: data.credentialsEncrypted,
      clientConfig: data.clientConfig,
      clientSideEnabled: data.clientSideEnabled,
      serverSideEnabled: data.serverSideEnabled,
      eventMappings: data.eventMappings,
      isActive: data.isActive,
    },
  });

  // Invalidate cache
  invalidatePixelConfigCache(shopId);

  return config;
}

/**
 * Deactivate a pixel config.
 */
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

/**
 * Delete a pixel config.
 */
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

/**
 * Batch fetch pixel configs for multiple shops.
 */
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

  // Group by shopId
  const result = new Map<string, PixelConfigCredentials[]>();
  for (const shopId of uniqueIds) {
    result.set(shopId, []);
  }

  for (const config of configs) {
    const shopConfigs = result.get(config.id.split("_")[0]) || [];
    // We need to get shopId from the actual data, but it's not in CREDENTIALS_SELECT
    // Let's fix this by including shopId in the query
  }

  // Re-query with shopId
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

/**
 * Check if a shop has any active server-side configs.
 */
export async function hasServerSideConfigs(shopId: string): Promise<boolean> {
  const count = await prisma.pixelConfig.count({
    where: {
      shopId,
      isActive: true,
      serverSideEnabled: true,
    },
  });

  return count > 0;
}

/**
 * Get list of platforms configured for a shop.
 */
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

/**
 * Invalidate cache for a shop's pixel configs.
 */
export function invalidatePixelConfigCache(shopId: string): void {
  shopPixelConfigsCache.delete(`configs:${shopId}:all`);
  shopPixelConfigsCache.delete(`configs:${shopId}:server`);
}

/**
 * Clear all pixel config caches.
 */
export function clearPixelConfigCache(): void {
  shopPixelConfigsCache.clear();
}

