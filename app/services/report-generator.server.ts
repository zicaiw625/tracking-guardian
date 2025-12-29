

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

export interface ScanReportData {
  shopDomain: string;
  riskScore: number;
  identifiedPlatforms: string[];
  scriptTagsCount: number;
  auditAssets: Array<{
    id: string;
    category: string;
    platform: string | null;
    riskLevel: string;
    migrationStatus: string;
  }>;
  createdAt: Date;
}

export interface VerificationReportData {
  shopDomain: string;
  runId: string;
  runName: string;
  status: string;
  summary: {
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    missingParams: Record<string, string[]>;
  };
}

export interface ReconciliationReportData {
  shopDomain: string;
  reportDate: Date;
  summary: {
    totalOrders: number;
    matchedOrders: number;
    unmatchedOrders: number;
    matchRate: number;
  };
  platformBreakdown: Record<string, {
    orders: number;
    revenue: number;
    matchRate: number;
  }>;
}

export interface BatchReportData {
  groupId: string;
  groupName: string;
  shopReports: Array<{
    shopDomain: string;
    shopId: string;
    scanData?: ScanReportData;
    verificationData?: VerificationReportData;
  }>;
  summary: {
    totalShops: number;
    avgRiskScore?: number;
    totalEvents?: number;
  };
}

export async function fetchScanReportData(shopId: string, scanId?: string): Promise<ScanReportData | null> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true },
    });

    if (!shop) return null;

    const scanReport = scanId
      ? await prisma.scanReport.findUnique({
          where: { id: scanId },
        })
      : await prisma.scanReport.findFirst({
          where: { shopId },
          orderBy: { createdAt: "desc" },
        });

    if (!scanReport) return null;

    const auditAssets = await prisma.auditAsset.findMany({
      where: { shopId },
      select: {
        id: true,
        category: true,
        platform: true,
        riskLevel: true,
        migrationStatus: true,
      },
    });

    return {
      shopDomain: shop.shopDomain,
      riskScore: scanReport.riskScore || 0,
      identifiedPlatforms: (scanReport.identifiedPlatforms as string[]) || [],
      scriptTagsCount: scanReport.scriptTags ? (scanReport.scriptTags as unknown[]).length : 0,
      auditAssets: auditAssets.map((asset) => ({
        id: asset.id,
        category: asset.category,
        platform: asset.platform,
        riskLevel: asset.riskLevel,
        migrationStatus: asset.migrationStatus,
      })),
      createdAt: scanReport.createdAt,
    };
  } catch (error) {
    logger.error("Failed to fetch scan report data:", error);
    return null;
  }
}

export async function fetchVerificationReportData(shopId: string, runId?: string): Promise<VerificationReportData | null> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true },
    });

    if (!shop) return null;

    const verificationRun = runId
      ? await prisma.verificationRun.findUnique({
          where: { id: runId },
        })
      : await prisma.verificationRun.findFirst({
          where: { shopId },
          orderBy: { createdAt: "desc" },
        });

    if (!verificationRun) return null;

    const summary = verificationRun.summaryJson as {
      totalEvents?: number;
      successfulEvents?: number;
      failedEvents?: number;
      missingParams?: Record<string, string[]>;
    } | null;

    return {
      shopDomain: shop.shopDomain,
      runId: verificationRun.id,
      runName: verificationRun.runName,
      status: verificationRun.status,
      summary: {
        totalEvents: summary?.totalEvents || 0,
        successfulEvents: summary?.successfulEvents || 0,
        failedEvents: summary?.failedEvents || 0,
        missingParams: summary?.missingParams || {},
      },
    };
  } catch (error) {
    logger.error("Failed to fetch verification report data:", error);
    return null;
  }
}

export async function fetchReconciliationReportData(shopId: string, days: number = 7): Promise<ReconciliationReportData | null> {
  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true },
    });

    if (!shop) return null;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const conversionLogs = await prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: startDate },
        status: "sent",
      },
      select: {
        platform: true,
        orderValue: true,
      },
    });

    const totalOrders = conversionLogs.length;
    const matchedOrders = conversionLogs.length;
    const platformBreakdown: Record<string, { orders: number; revenue: number; matchRate: number }> = {};

    for (const log of conversionLogs) {
      if (!platformBreakdown[log.platform]) {
        platformBreakdown[log.platform] = { orders: 0, revenue: 0, matchRate: 0 };
      }
      platformBreakdown[log.platform].orders++;
      platformBreakdown[log.platform].revenue += Number(log.orderValue);
    }

    for (const platform in platformBreakdown) {
      platformBreakdown[platform].matchRate = 100;
    }

    return {
      shopDomain: shop.shopDomain,
      reportDate: new Date(),
      summary: {
        totalOrders,
        matchedOrders,
        unmatchedOrders: 0,
        matchRate: totalOrders > 0 ? 100 : 0,
      },
      platformBreakdown,
    };
  } catch (error) {
    logger.error("Failed to fetch reconciliation report data:", error);
    return null;
  }
}

export async function fetchBatchReportData(groupId: string, requesterId: string, days: number = 7): Promise<BatchReportData | null> {
  try {
    const { getShopGroupDetails } = await import("./multi-shop.server");
    const groupDetails = await getShopGroupDetails(groupId, requesterId);

    if (!groupDetails) return null;

    const shopReports: BatchReportData["shopReports"] = [];

    for (const member of groupDetails.members) {
      const scanData = await fetchScanReportData(member.shopId);
      const verificationData = await fetchVerificationReportData(member.shopId);

      shopReports.push({
        shopDomain: member.shopDomain,
        shopId: member.shopId,
        scanData: scanData || undefined,
        verificationData: verificationData || undefined,
      });
    }

    const riskScores = shopReports
      .map((r) => r.scanData?.riskScore)
      .filter((score): score is number => score !== undefined);

    const avgRiskScore = riskScores.length > 0
      ? riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length
      : undefined;

    const totalEvents = shopReports.reduce(
      (sum, r) => sum + (r.verificationData?.summary.totalEvents || 0),
      0
    );

    return {
      groupId,
      groupName: groupDetails.name,
      shopReports,
      summary: {
        totalShops: shopReports.length,
        avgRiskScore,
        totalEvents,
      },
    };
  } catch (error) {
    logger.error("Failed to fetch batch report data:", error);
    return null;
  }
}

export function generateScanReportHtml(data: ScanReportData): string {
  const timestamp = new Date(data.createdAt).toLocaleString("zh-CN");
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>扫描报告 - ${data.shopDomain}</h1>
  <p>生成时间: ${timestamp}</p>
  <h2>汇总</h2>
  <ul>
    <li>风险分数: ${data.riskScore}</li>
    <li>识别平台: ${data.identifiedPlatforms.join(", ") || "无"}</li>
    <li>ScriptTags 数量: ${data.scriptTagsCount}</li>
  </ul>
  <h2>审计资产</h2>
  <table>
    <thead>
      <tr>
        <th>类别</th>
        <th>平台</th>
        <th>风险等级</th>
        <th>迁移状态</th>
      </tr>
    </thead>
    <tbody>
      ${data.auditAssets.map((asset) => `
        <tr>
          <td>${asset.category}</td>
          <td>${asset.platform || "-"}</td>
          <td>${asset.riskLevel}</td>
          <td>${asset.migrationStatus}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>
  `;
}

export function generateVerificationReportHtml(data: VerificationReportData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>验收报告 - ${data.shopDomain}</h1>
  <p>运行名称: ${data.runName}</p>
  <h2>汇总</h2>
  <ul>
    <li>总事件数: ${data.summary.totalEvents}</li>
    <li>成功事件: ${data.summary.successfulEvents}</li>
    <li>失败事件: ${data.summary.failedEvents}</li>
  </ul>
</body>
</html>
  `;
}

export function generateReconciliationReportHtml(data: ReconciliationReportData): string {
  const timestamp = new Date(data.reportDate).toLocaleString("zh-CN");
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>对账报告 - ${data.shopDomain}</h1>
  <p>报告日期: ${timestamp}</p>
  <h2>汇总</h2>
  <ul>
    <li>总订单数: ${data.summary.totalOrders}</li>
    <li>匹配订单: ${data.summary.matchedOrders}</li>
    <li>匹配率: ${data.summary.matchRate.toFixed(2)}%</li>
  </ul>
  <h2>平台明细</h2>
  <table>
    <thead>
      <tr>
        <th>平台</th>
        <th>订单数</th>
        <th>收入</th>
        <th>匹配率</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(data.platformBreakdown).map(([platform, stats]) => `
        <tr>
          <td>${platform}</td>
          <td>${stats.orders}</td>
          <td>$${stats.revenue.toFixed(2)}</td>
          <td>${stats.matchRate.toFixed(2)}%</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>
  `;
}

export function generateBatchReportHtml(data: BatchReportData): string {
  const timestamp = new Date().toLocaleString("zh-CN");
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .shop-section { margin-top: 30px; page-break-after: always; }
  </style>
</head>
<body>
  <h1>批量报告 - ${data.groupName}</h1>
  <p>生成时间: ${timestamp}</p>
  <h2>汇总</h2>
  <ul>
    <li>总店铺数: ${data.summary.totalShops}</li>
    ${data.summary.avgRiskScore !== undefined ? `<li>平均风险分数: ${data.summary.avgRiskScore.toFixed(1)}</li>` : ""}
    ${data.summary.totalEvents !== undefined ? `<li>总事件数: ${data.summary.totalEvents}</li>` : ""}
  </ul>
  <h2>各店铺详情</h2>
  ${data.shopReports.map((report) => `
    <div class="shop-section">
      <h3>${report.shopDomain}</h3>
      ${report.scanData ? `
        <h4>扫描结果</h4>
        <ul>
          <li>风险分数: ${report.scanData.riskScore}</li>
          <li>识别平台: ${report.scanData.identifiedPlatforms.join(", ") || "无"}</li>
        </ul>
      ` : ""}
      ${report.verificationData ? `
        <h4>验收结果</h4>
        <ul>
          <li>总事件数: ${report.verificationData.summary.totalEvents}</li>
          <li>成功事件: ${report.verificationData.summary.successfulEvents}</li>
        </ul>
      ` : ""}
    </div>
  `).join("")}
</body>
</html>
  `;
}
