

import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "./multi-shop.server";
import { scanShopTracking } from "./scanner.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { Prisma } from "@prisma/client";
import { toInputJsonValue } from "../utils/prisma-json";

export interface BatchAuditOptions {

  groupId: string;

  requesterId: string;

  concurrency?: number;

  skipRecentHours?: number;

  maxRetries?: number;
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
  attempts?: number;
  errorType?: "permission" | "network" | "timeout" | "unknown";
}

export interface BatchAuditSummary {
  avgRiskScore: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  platformBreakdown: Record<string, number>;

  totalAssetsFound?: number;
  avgAssetsPerShop?: number;
  shopsWithHighRisk?: number;
  shopsWithMediumRisk?: number;
  shopsWithLowRisk?: number;
  migrationReadyCount?: number;
  topRiskCategories?: Array<{ category: string; count: number }>;
  errorBreakdown?: Record<string, number>;
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

  progressDetails?: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    current: string[];
    completedShops: string[];
    failedShops: string[];
  };

  errorSummary?: {
    byType: Record<string, number>;
    recentErrors: Array<{ shopDomain: string; error: string; errorType: string }>;
  };
}

const batchAuditJobs = new Map<string, BatchAuditJob>();

export async function startBatchAudit(
  options: BatchAuditOptions & { maxRetries?: number }
): Promise<{ jobId: string } | { error: string }> {
  const { groupId, requesterId, concurrency = 3, skipRecentHours = 6, maxRetries = 2 } = options;

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
    progressDetails: {
      total: groupDetails.memberCount,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: [],
      completedShops: [],
      failedShops: [],
    },
    errorSummary: {
      byType: {},
      recentErrors: [],
    },
  };
  batchAuditJobs.set(jobId, job);

  executeBatchAuditAsync(jobId, groupDetails, { concurrency, skipRecentHours, maxRetries }).catch(
    (err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Batch audit job failed", err instanceof Error ? err : new Error(String(err)), {
        jobId,
        errorMessage,
        groupDetails: {
          shopCount: groupDetails.memberCount,
          shopIds: groupDetails.members.map(m => m.shopId),
        },
      });
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

          const scanResult = await scanShopTracking(adminContext, shop.id);

          const scanReport = await prisma.scanReport.create({
            data: {
              id: randomUUID(),
              shopId: shop.id,
              scriptTags: toInputJsonValue(scanResult.scriptTags),
              checkoutConfig: scanResult.checkoutConfig ? toInputJsonValue(scanResult.checkoutConfig) : Prisma.JsonNull,
              riskItems: toInputJsonValue(scanResult.riskItems),
              riskScore: scanResult.riskScore,
              identifiedPlatforms: toInputJsonValue(scanResult.identifiedPlatforms),
              status: "completed",
              completedAt: new Date(),
            },
          });

          return {
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            status: "success" as const,
            scanReportId: scanReport.id,
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

  const summary = await calculateSummary(results);

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
  const shopifyApiUrl = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

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

function classifyError(error: unknown): "permission" | "network" | "timeout" | "unknown" {
  if (!(error instanceof Error)) return "unknown";

  const message = error.message.toLowerCase();
  if (message.includes("permission") || message.includes("access") || message.includes("unauthorized") || message.includes("401") || message.includes("403")) {
    return "permission";
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("504") || message.includes("503")) {
    return "timeout";
  }
  if (message.includes("network") || message.includes("connection") || message.includes("econnrefused") || message.includes("enotfound")) {
    return "network";
  }
  return "unknown";
}

async function scanShopWithRetry(
  member: { shopId: string; shopDomain: string },
  maxRetries: number = 2,
  retryDelayMs: number = 1000
): Promise<ShopAuditResult> {
  const startTime = Date.now();
  let lastError: unknown = null;
  let errorType: "permission" | "network" | "timeout" | "unknown" = "unknown";

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const adminClient = await createAdminClientForShop(member.shopDomain);
      if (!adminClient) {
        return {
          shopId: member.shopId,
          shopDomain: member.shopDomain,
          status: "failed",
          error: "无法获取店铺访问权限，请确保店铺已授权 offline 访问",
          attempts: attempt,
          errorType: "permission",
          duration: Date.now() - startTime,
        };
      }

      const scanResult = await scanShopTracking(
        { graphql: adminClient.graphql } as Parameters<typeof scanShopTracking>[0],
        member.shopId
      );

      const scanReport = await prisma.scanReport.create({
        data: {
          id: randomUUID(),
          shopId: member.shopId,
          scriptTags: toInputJsonValue(scanResult.scriptTags),
          checkoutConfig: scanResult.checkoutConfig ? toInputJsonValue(scanResult.checkoutConfig) : Prisma.JsonNull,
          riskItems: toInputJsonValue(scanResult.riskItems),
          riskScore: scanResult.riskScore,
          identifiedPlatforms: toInputJsonValue(scanResult.identifiedPlatforms),
          status: "completed",
          completedAt: new Date(),
        },
      });

      return {
        shopId: member.shopId,
        shopDomain: member.shopDomain,
        status: "success",
        scanReportId: scanReport.id,
        riskScore: scanResult.riskScore,
        identifiedPlatforms: scanResult.identifiedPlatforms,
        duration: Date.now() - startTime,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      errorType = classifyError(err);

      logger.warn(`Batch audit attempt ${attempt}/${maxRetries + 1} failed for shop ${member.shopDomain}:`, {
        error: err instanceof Error ? err.message : "Unknown error",
        errorType,
        attempt,
      });

      if (attempt <= maxRetries) {
        const delay = retryDelayMs * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return {
    shopId: member.shopId,
    shopDomain: member.shopDomain,
    status: "failed",
    error: lastError instanceof Error ? lastError.message : "未知错误",
    attempts: maxRetries + 1,
    errorType,
    duration: Date.now() - startTime,
  };
}

async function executeBatchAuditAsync(
  jobId: string,
  groupDetails: { id: string; name: string; members: Array<{ shopId: string; shopDomain: string }> },
  options: { concurrency: number; skipRecentHours: number; maxRetries?: number }
): Promise<void> {
  const job = batchAuditJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.updatedAt = new Date();

  const startedAt = new Date();
  const results: ShopAuditResult[] = [];
  const totalShops = groupDetails.members.length;
  const maxRetries = options.maxRetries ?? 2;

  logger.info(`Starting async batch audit for ${totalShops} shops`, { jobId, maxRetries });

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

  if (job.progressDetails) {
    const firstBatch = groupDetails.members.slice(0, options.concurrency);
    job.progressDetails.current = firstBatch.map((m) => m.shopId);
  }

  for (let i = 0; i < groupDetails.members.length; i += options.concurrency) {
    const batch = groupDetails.members.slice(i, i + options.concurrency);

    if (job.progressDetails) {
      job.progressDetails.current = batch.map((m) => m.shopId);
    }
    job.updatedAt = new Date();

    const batchResults = await Promise.allSettled(
      batch.map(async (member) => {
        if (recentlyScannedIds.has(member.shopId)) {
          return {
            shopId: member.shopId,
            shopDomain: member.shopDomain,
            status: "skipped" as const,
            error: `最近 ${options.skipRecentHours} 小时内已扫描`,
            attempts: 0,
          };
        }

        return await scanShopWithRetry(member, maxRetries);
      })
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);

        if (job.progressDetails) {
          if (result.value.status === "success") {
            job.progressDetails.completed++;
            job.progressDetails.completedShops.push(result.value.shopId);
          } else if (result.value.status === "failed") {
            job.progressDetails.failed++;
            job.progressDetails.failedShops.push(result.value.shopId);

            if (job.errorSummary && result.value.errorType) {
              job.errorSummary.byType[result.value.errorType] =
                (job.errorSummary.byType[result.value.errorType] || 0) + 1;
              job.errorSummary.recentErrors.push({
                shopDomain: result.value.shopDomain,
                error: result.value.error || "未知错误",
                errorType: result.value.errorType,
              });

              if (job.errorSummary.recentErrors.length > 20) {
                job.errorSummary.recentErrors.shift();
              }
            }
          } else if (result.value.status === "skipped") {
            job.progressDetails.skipped++;
          }
        }

        if (result.value.status === "failed") {
          logger.error(`Batch audit failed for shop ${result.value.shopDomain} after ${result.value.attempts} attempts:`, {
            error: result.value.error,
            errorType: result.value.errorType,
          });
        }
      } else {
        logger.error("Unexpected batch audit rejection:", result.reason);
      }
    }

    job.progress = Math.round((results.length / totalShops) * 100);

    if (job.progressDetails) {
      job.progressDetails.current = [];
    }
    job.updatedAt = new Date();
  }

  const completedAt = new Date();
  const summary = await calculateSummary(results);

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

async function calculateSummary(results: ShopAuditResult[]): Promise<BatchAuditSummary> {
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

  const errorBreakdown: Record<string, number> = {};
  for (const result of results) {
    if (result.status === "failed" && result.errorType) {
      errorBreakdown[result.errorType] = (errorBreakdown[result.errorType] || 0) + 1;
    }
  }

  const shopsWithHighRisk = successResults.filter((r) => (r.riskScore || 0) > 60).length;
  const shopsWithMediumRisk = successResults.filter(
    (r) => (r.riskScore || 0) > 30 && (r.riskScore || 0) <= 60
  ).length;
  const shopsWithLowRisk = successResults.filter((r) => (r.riskScore || 0) <= 30).length;

  const migrationReadyCount = highRiskCount + mediumRiskCount;

  let totalAssetsFound = 0;
  const riskCategoryCounts: Record<string, number> = {};
  const shopIds = successResults.map((r) => r.shopId).filter(Boolean) as string[];

  if (shopIds.length > 0) {

    const assets = await prisma.auditAsset.findMany({
      where: {
        shopId: { in: shopIds },
      },
      select: {
        category: true,
        riskLevel: true,
        shopId: true,
      },
    });

    totalAssetsFound = assets.length;
    const assetsByShop = new Map<string, number>();
    for (const asset of assets) {
      assetsByShop.set(asset.shopId, (assetsByShop.get(asset.shopId) || 0) + 1);
      const categoryKey = `${asset.category}_${asset.riskLevel}`;
      riskCategoryCounts[categoryKey] = (riskCategoryCounts[categoryKey] || 0) + 1;
    }

    const avgAssetsPerShop =
      assetsByShop.size > 0
        ? Array.from(assetsByShop.values()).reduce((sum, count) => sum + count, 0) / assetsByShop.size
        : 0;

    const topRiskCategories = Object.entries(riskCategoryCounts)
      .map(([key, count]) => {
        const [category, riskLevel] = key.split("_");
        return { category, riskLevel, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        category: `${item.category} (${item.riskLevel})`,
        count: item.count,
      }));

    return {
      avgRiskScore: Math.round(avgRiskScore * 10) / 10,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      platformBreakdown,
      shopsWithHighRisk,
      shopsWithMediumRisk,
      shopsWithLowRisk,
      migrationReadyCount,
      totalAssetsFound,
      avgAssetsPerShop: Math.round(avgAssetsPerShop * 10) / 10,
      topRiskCategories: topRiskCategories.length > 0 ? topRiskCategories : undefined,
      errorBreakdown: Object.keys(errorBreakdown).length > 0 ? errorBreakdown : undefined,
    };
  }

  return {
    avgRiskScore: Math.round(avgRiskScore * 10) / 10,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    platformBreakdown,
    shopsWithHighRisk,
    shopsWithMediumRisk,
    shopsWithLowRisk,
    migrationReadyCount,
    errorBreakdown: Object.keys(errorBreakdown).length > 0 ? errorBreakdown : undefined,
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

export function getBatchAuditHistory(limit: number = 20): BatchAuditJob[] {
  return Array.from(batchAuditJobs.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export function getBatchAuditHistoryByGroup(groupId: string, limit: number = 10): BatchAuditJob[] {
  return Array.from(batchAuditJobs.values())
    .filter((job) => job.groupId === groupId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export function getBatchAuditStatistics(): {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  totalShopsScanned: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  avgSuccessRate: number;
} {
  const jobs = Array.from(batchAuditJobs.values());
  const completedJobs = jobs.filter((j) => j.status === "completed" && j.result);

  let totalShopsScanned = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  completedJobs.forEach((job) => {
    if (job.result) {
      totalShopsScanned += job.result.totalShops;
      totalSuccess += job.result.completedShops;
      totalFailed += job.result.failedShops;
      totalSkipped += job.result.skippedShops;
    }
  });

  const avgSuccessRate =
    totalShopsScanned > 0 ? (totalSuccess / totalShopsScanned) * 100 : 0;

  return {
    totalJobs: jobs.length,
    completedJobs: jobs.filter((j) => j.status === "completed").length,
    failedJobs: jobs.filter((j) => j.status === "failed").length,
    runningJobs: jobs.filter((j) => j.status === "running").length,
    totalShopsScanned,
    totalSuccess,
    totalFailed,
    totalSkipped,
    avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
  };
}

