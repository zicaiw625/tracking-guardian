

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface BatchPixelOptions {
  shopIds: string[];
  workspaceId: string;
  templateId: string;
  requestedBy: string;
}

export interface BatchPixelResult {
  jobId: string;
  totalShops: number;
  startedAt: Date;
  status: "pending" | "running" | "completed" | "failed";
  results: Array<{
    shopId: string;
    shopDomain: string;
    status: "success" | "failed" | "skipped";
    pixelConfigId?: string;
    error?: string;
  }>;
}

export async function batchApplyPixelTemplate(
  options: BatchPixelOptions,
  template: {
    platforms: Array<{
      platform: string;
      platformId?: string;
      credentials?: Record<string, unknown>;
      eventMappings?: Record<string, string>;
    }>;
  },
  adminApis: Map<string, AdminApiContext>
): Promise<BatchPixelResult> {
  const jobId = `batch-pixel-${Date.now()}`;

  logger.info("Starting batch pixel apply", {
    jobId,
    workspaceId: options.workspaceId,
    shopCount: options.shopIds.length,
    templateId: options.templateId,
  });

  const processPromises = options.shopIds.map(async (shopId): Promise<BatchPixelResult["results"][number]> => {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      if (!shop) {
        return {
          shopId,
          shopDomain: "unknown",
          status: "skipped",
          error: "Shop not found",
        };
      }

      const configIds: string[] = [];

      for (const platformConfig of template.platforms) {
        const existing = await prisma.pixelConfig.findUnique({
          where: {
            shopId_platform: {
              shopId,
              platform: platformConfig.platform,
            },
          },
        });

        if (existing) {
          const eventMappings = platformConfig.eventMappings && typeof platformConfig.eventMappings === "object"
            ? platformConfig.eventMappings
            : existing.eventMappings;

          const updated = await prisma.pixelConfig.update({
            where: { id: existing.id },
            data: {
              platformId: platformConfig.platformId || existing.platformId,
              eventMappings: eventMappings,
              configVersion: existing.configVersion + 1,
              previousConfig: existing.clientConfig,
              updatedAt: new Date(),
            },
          });
          configIds.push(updated.id);
        } else {
          const eventMappings = platformConfig.eventMappings && typeof platformConfig.eventMappings === "object"
            ? platformConfig.eventMappings
            : null;

          const created = await prisma.pixelConfig.create({
            data: {
              shopId,
              platform: platformConfig.platform,
              platformId: platformConfig.platformId || null,
              eventMappings: eventMappings,
              clientSideEnabled: true,
              serverSideEnabled: false,
              environment: "test",
              isActive: true,
            },
          });
          configIds.push(created.id);
        }
      }

      return {
        shopId,
        shopDomain: shop.shopDomain,
        status: "success",
        pixelConfigId: configIds.length > 0 ? configIds[0] : undefined,
      };
    } catch (error) {
      logger.error("Failed to apply pixel template in batch", {
        shopId,
        error,
      });

      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopDomain: true },
      });

      return {
        shopId,
        shopDomain: shop?.shopDomain || "unknown",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  const settledResults = await Promise.allSettled(processPromises);
  const results: BatchPixelResult["results"] = settledResults.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      return {
        shopId: "unknown",
        shopDomain: "unknown",
        status: "failed" as const,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      };
    }
  });

  return {
    jobId,
    totalShops: options.shopIds.length,
    startedAt: new Date(),
    status: "completed",
    results,
  };
}

