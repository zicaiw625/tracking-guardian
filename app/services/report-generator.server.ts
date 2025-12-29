

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface ReportData {
  shopId: string;
  shopDomain: string;
  scanResults?: {
    riskScore: number;
    identifiedPlatforms: string[];
    scriptTagsCount: number;
    auditAssets: Array<{
      id: string;
      category: string;
      platform: string | null;
      riskLevel: string;
      migrationStatus: string;
      priority: number | null;
      estimatedTimeMinutes: number | null;
    }>;
  };
  migrationProgress?: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    progressPercent: number;
  };
  verificationResults?: {
    runId: string;
    runName: string;
    status: string;
    summary: {
      totalEvents: number;
      successfulEvents: number;
      failedEvents: number;
      missingParams: Record<string, string[]>;
    };
  };
  pixelConfigs?: Array<{
    platform: string;
    environment: string;
    isActive: boolean;
  }>;
}

export async function generateReportData(
  shopId: string,
  includeScan: boolean = true,
  includeMigration: boolean = true,
  includeVerification: boolean = true
): Promise<ReportData> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopDomain: true,
    },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  const reportData: ReportData = {
    shopId: shop.id,
    shopDomain: shop.shopDomain,
  };

  if (includeScan) {
    const latestScan = await prisma.scanReport.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        riskScore: true,
        identifiedPlatforms: true,
        scriptTags: true,
      },
    });

    const auditAssets = await prisma.auditAsset.findMany({
      where: { shopId },
      select: {
        id: true,
        category: true,
        platform: true,
        riskLevel: true,
        migrationStatus: true,
        priority: true,
        estimatedTimeMinutes: true,
      },
    });

    reportData.scanResults = {
      riskScore: latestScan?.riskScore || 0,
      identifiedPlatforms: (latestScan?.identifiedPlatforms as string[]) || [],
      scriptTagsCount: latestScan?.scriptTags ? (latestScan.scriptTags as unknown[]).length : 0,
      auditAssets: auditAssets.map((asset) => ({
        id: asset.id,
        category: asset.category,
        platform: asset.platform,
        riskLevel: asset.riskLevel,
        migrationStatus: asset.migrationStatus,
        priority: asset.priority,
        estimatedTimeMinutes: asset.estimatedTimeMinutes,
      })),
    };
  }

  if (includeMigration) {
    const auditAssets = await prisma.auditAsset.findMany({
      where: { shopId },
      select: {
        migrationStatus: true,
      },
    });

    const total = auditAssets.length;
    const completed = auditAssets.filter((a) => a.migrationStatus === "completed").length;
    const inProgress = auditAssets.filter((a) => a.migrationStatus === "in_progress").length;
    const pending = auditAssets.filter((a) => a.migrationStatus === "pending").length;

    reportData.migrationProgress = {
      total,
      completed,
      inProgress,
      pending,
      progressPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  if (includeVerification) {
    const latestVerification = await prisma.verificationRun.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        runName: true,
        status: true,
        summaryJson: true,
      },
    });

    if (latestVerification) {
      const summary = latestVerification.summaryJson as {
        totalEvents?: number;
        successfulEvents?: number;
        failedEvents?: number;
        missingParams?: Record<string, string[]>;
      } | null;

      reportData.verificationResults = {
        runId: latestVerification.id,
        runName: latestVerification.runName,
        status: latestVerification.status,
        summary: {
          totalEvents: summary?.totalEvents || 0,
          successfulEvents: summary?.successfulEvents || 0,
          failedEvents: summary?.failedEvents || 0,
          missingParams: summary?.missingParams || {},
        },
      };
    }
  }

  const pixelConfigs = await prisma.pixelConfig.findMany({
    where: { shopId },
    select: {
      platform: true,
      environment: true,
      isActive: true,
    },
  });

  reportData.pixelConfigs = pixelConfigs.map((config) => ({
    platform: config.platform,
    environment: config.environment,
    isActive: config.isActive,
  }));

  return reportData;
}

export async function generatePDFReport(
  shopId: string,
  options: {
    includeScan?: boolean;
    includeMigration?: boolean;
    includeVerification?: boolean;
  } = {}
): Promise<{
  success: boolean;
  reportUrl?: string;
  reportData?: ReportData;
  error?: string;
}> {
  try {
    const reportData = await generateReportData(
      shopId,
      options.includeScan ?? true,
      options.includeMigration ?? true,
      options.includeVerification ?? true
    );

    logger.info("PDF report generated", { shopId, reportData });

    return {
      success: true,
      reportData,

    };
  } catch (error) {
    logger.error("Failed to generate PDF report", { shopId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function generateBatchReports(
  shopIds: string[],
  options: {
    includeScan?: boolean;
    includeMigration?: boolean;
    includeVerification?: boolean;
  } = {}
): Promise<Array<{ shopId: string; success: boolean; reportData?: ReportData; error?: string }>> {
  const results = [];

  for (const shopId of shopIds) {
    try {
      const reportData = await generateReportData(
        shopId,
        options.includeScan ?? true,
        options.includeMigration ?? true,
        options.includeVerification ?? true
      );

      results.push({
        shopId,
        success: true,
        reportData,
      });
    } catch (error) {
      results.push({
        shopId,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
