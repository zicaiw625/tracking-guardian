

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "./multi-shop.server";
import { scanShopTracking } from "./scanner.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface BatchAuditOptions {

  groupId: string;

  requesterId: string;

  concurrency?: number;

  skipRecentHours?: number;
}

export interface ShopAuditResult {
  shopId: string;
  shopDomain: string;
  status: "success" | "failed" | "skipped";
  scanReportId?: string;
  riskScore?: number;
  identifiedPlatforms?: string[];
  error?: string;
  duration?: number;
}

export interface BatchAuditSummary {
  avgRiskScore: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  platformBreakdown: Record<string, number>;
}

export interface BatchAuditResult {
  groupId: string;
  groupName: string;
  totalShops: number;
  completedShops: number;
  failedShops: number;
  skippedShops: number;
  results: ShopAuditResult[];
  summary: BatchAuditSummary;
  startedAt: Date;
  completedAt: Date;
  duration: number;
}

export interface BatchAuditJob {
  id: string;
  groupId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  result?: BatchAuditResult;
  createdAt: Date;
  updatedAt: Date;
}

const batchAuditJobs = new Map<string, BatchAuditJob>();

export async function startBatchAudit(
  options: BatchAuditOptions
): Promise<{ jobId: string } | { error: string }> {
  const { groupId, requesterId, concurrency = 3, skipRecentHours = 6 } = options;

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量 Audit，请升级到 Agency 版" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  const jobId = `batch-audit-${groupId}-${Date.now()}`;
  const job: BatchAuditJob = {
    id: jobId,
    groupId,
    status: "pending",
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  batchAuditJobs.set(jobId, job);

  executeBatchAuditAsync(jobId, groupDetails, { concurrency, skipRecentHours }).catch(
    (err) => {
      logger.error(`Batch audit job ${jobId} failed:`, err);
      const failedJob = batchAuditJobs.get(jobId);
      if (failedJob) {
        failedJob.status = "failed";
        failedJob.updatedAt = new Date();
      }
    }
  );

  logger.info(`Batch audit job started: ${jobId}`, {
    groupId,
    shopCount: groupDetails.memberCount,
  });

  return { jobId };
}

export function getBatchAuditStatus(jobId: string): BatchAuditJob | null {
  return batchAuditJobs.get(jobId) || null;
}

export async function runBatchAuditSync(
  options: BatchAuditOptions,
  adminContextGetter: (shopId: string) => Promise<AdminApiContext | null>
): Promise<BatchAuditResult | { error: string }> {
  const { groupId, requesterId, concurrency = 3, skipRecentHours = 6 } = options;

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量 Audit，请升级到 Agency 版" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  const startedAt = new Date();
  const results: ShopAuditResult[] = [];

  const shopIds = groupDetails.members.map((m) => m.shopId);
  const shops = await prisma.shop.findMany({
    where: { id: { in: shopIds } },
    select: { id: true, shopDomain: true },
  });

  const skipSince = new Date();
  skipSince.setHours(skipSince.getHours() - skipRecentHours);

  const recentScans = await prisma.scanReport.findMany({
    where: {
      shopId: { in: shopIds },
      createdAt: { gte: skipSince },
      status: "completed",
    },
    select: { shopId: true },
  });
  const recentlyScannedIds = new Set(recentScans.map((s) => s.shopId));

  const shopsToScan = shops.filter((s) => !recentlyScannedIds.has(s.id));
  const skippedShops = shops.filter((s) => recentlyScannedIds.has(s.id));

  for (const shop of skippedShops) {
    results.push({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      status: "skipped",
      error: `最近 ${skipRecentHours} 小时内已扫描`,
    });
  }

  for (let i = 0; i < shopsToScan.length; i += concurrency) {
    const batch = shopsToScan.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (shop) => {
        const startTime = Date.now();
        try {
          const adminContext = await adminContextGetter(shop.id);
          if (!adminContext) {
            return {
              shopId: shop.id,
              shopDomain: shop.shopDomain,
              status: "failed" as const,
              error: "无法获取店铺访问权限",
            };
          }

          const scanResult = await scanShopTracking(adminContext.admin, shop.id);

          return {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            status: "success" as const,
            scanReportId: scanResult.id,
            riskScore: scanResult.riskScore,
            identifiedPlatforms: scanResult.identifiedPlatforms,
            duration: Date.now() - startTime,
          };
        } catch (err) {
          logger.error(`Batch audit failed for shop ${shop.shopDomain}:`, err);
          return {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            status: "failed" as const,
            error: err instanceof Error ? err.message : "未知错误",
            duration: Date.now() - startTime,
          };
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {

        logger.error("Unexpected batch audit rejection:", result.reason);
      }
    }
  }

  const completedAt = new Date();

  const summary = calculateSummary(results);

  return {
    groupId,
    groupName: groupDetails.name,
    totalShops: shops.length,
    completedShops: results.filter((r) => r.status === "success").length,
    failedShops: results.filter((r) => r.status === "failed").length,
    skippedShops: results.filter((r) => r.status === "skipped").length,
    results,
    summary,
    startedAt,
    completedAt,
    duration: completedAt.getTime() - startedAt.getTime(),
  };
}

async function getOfflineSession(shopDomain: string): Promise<{
  accessToken: string;
  shop: string;
} | null> {
  try {

    const session = await prisma.session.findFirst({
      where: {
        shop: shopDomain,
        isOnline: false,
      },
      select: {
        accessToken: true,
        shop: true,
      },
    });

    if (session?.accessToken) {
      return {
        accessToken: session.accessToken,
        shop: session.shop,
      };
    }
    return null;
  } catch (error) {
    logger.error(`Failed to get offline session for ${shopDomain}:`, error);
    return null;
  }
}

async function createAdminClientForShop(shopDomain: string): Promise<{
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
} | null> {
  const session = await getOfflineSession(shopDomain);
  if (!session) {
    logger.warn(`No offline session found for shop: ${shopDomain}`);
    return null;
  }

  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-01";
  const shopifyApiUrl = `https:

  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      const response = await fetch(shopifyApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables,
        }),
      });
      return response;
    },
  };
}

async function executeBatchAuditAsync(
  jobId: string,
  groupDetails: { id: string; name: string; members: Array<{ shopId: string; shopDomain: string }> },
  options: { concurrency: number; skipRecentHours: number }
): Promise<void> {
  const job = batchAuditJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = new Date();

  const startedAt = new Date();
  const results: ShopAuditResult[] = [];
  const totalShops = groupDetails.members.length;

  logger.info(`Starting async batch audit for ${totalShops} shops`, { jobId });

  const skipSince = new Date();
  skipSince.setHours(skipSince.getHours() - options.skipRecentHours);

  const recentScans = await prisma.scanReport.findMany({
    where: {
      shopId: { in: groupDetails.members.map((m) => m.shopId) },
      createdAt: { gte: skipSince },
      status: "completed",
    },
    select: { shopId: true },
  });
  const recentlyScannedIds = new Set(recentScans.map((s) => s.shopId));

  for (let i = 0; i < groupDetails.members.length; i += options.concurrency) {
    const batch = groupDetails.members.slice(i, i + options.concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (member) => {
        const startTime = Date.now();

        if (recentlyScannedIds.has(member.shopId)) {
          return {
            shopId: member.shopId,
            shopDomain: member.shopDomain,
            status: "skipped" as const,
            error: `最近 ${options.skipRecentHours} 小时内已扫描`,
          };
        }

        try {

          const adminClient = await createAdminClientForShop(member.shopDomain);
          if (!adminClient) {
            return {
              shopId: member.shopId,
              shopDomain: member.shopDomain,
              status: "failed" as const,
              error: "无法获取店铺访问权限，请确保店铺已授权 offline 访问",
            };
          }

          const scanResult = await scanShopTracking(
            { graphql: adminClient.graphql } as Parameters<typeof scanShopTracking>[0],
            member.shopId
          );

          return {
            shopId: member.shopId,
            shopDomain: member.shopDomain,
            status: "success" as const,
            scanReportId: scanResult.id,
            riskScore: scanResult.riskScore,
            identifiedPlatforms: scanResult.identifiedPlatforms,
            duration: Date.now() - startTime,
          };
        } catch (err) {
          logger.error(`Async batch audit failed for shop ${member.shopDomain}:`, err);
          return {
            shopId: member.shopId,
            shopDomain: member.shopDomain,
            status: "failed" as const,
            error: err instanceof Error ? err.message : "未知错误",
            duration: Date.now() - startTime,
          };
        }
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        logger.error("Unexpected batch audit rejection:", result.reason);
      }
    }

    job.progress = Math.round((results.length / totalShops) * 100);
    job.updatedAt = new Date();
  }

  const completedAt = new Date();
  const summary = calculateSummary(results);

  job.status = "completed";
  job.progress = 100;
  job.result = {
    groupId: groupDetails.id,
    groupName: groupDetails.name,
    totalShops,
    completedShops: results.filter((r) => r.status === "success").length,
    failedShops: results.filter((r) => r.status === "failed").length,
    skippedShops: results.filter((r) => r.status === "skipped").length,
    results,
    summary,
    startedAt,
    completedAt,
    duration: completedAt.getTime() - startedAt.getTime(),
  };
  job.updatedAt = new Date();

  logger.info(`Async batch audit completed`, {
    jobId,
    totalShops,
    completed: job.result.completedShops,
    failed: job.result.failedShops,
    skipped: job.result.skippedShops,
    duration: job.result.duration,
  });
}

function calculateSummary(results: ShopAuditResult[]): BatchAuditSummary {
  const successResults = results.filter((r) => r.status === "success" && r.riskScore !== undefined);

  const avgRiskScore =
    successResults.length > 0
      ? successResults.reduce((sum, r) => sum + (r.riskScore || 0), 0) / successResults.length
      : 0;

  const highRiskCount = successResults.filter((r) => (r.riskScore || 0) > 60).length;
  const mediumRiskCount = successResults.filter(
    (r) => (r.riskScore || 0) > 30 && (r.riskScore || 0) <= 60
  ).length;
  const lowRiskCount = successResults.filter((r) => (r.riskScore || 0) <= 30).length;

  const platformBreakdown: Record<string, number> = {};
  for (const result of successResults) {
    for (const platform of result.identifiedPlatforms || []) {
      platformBreakdown[platform] = (platformBreakdown[platform] || 0) + 1;
    }
  }

  return {
    avgRiskScore: Math.round(avgRiskScore * 10) / 10,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    platformBreakdown,
  };
}

export function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [jobId, job] of batchAuditJobs.entries()) {
    if (now - job.createdAt.getTime() > maxAgeMs) {
      batchAuditJobs.delete(jobId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`Cleaned up ${cleaned} old batch audit jobs`);
  }

  return cleaned;
}

