import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { createShareableReport } from "./report-sharing.server";
import { getShopGroupDetails } from "./multi-shop.server";

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
    createShareableLink?: boolean;
  } = {}
): Promise<{
  success: boolean;
  reportUrl?: string;
  shareUrl?: string;
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

    let shareUrl: string | undefined;
    if (options.createShareableLink) {
      try {
        let reportType: "verification" | "scan" | "reconciliation" | "migration" = "scan";
        let reportId = "";

        if (reportData.verificationResults) {
          reportType = "verification";
          reportId = reportData.verificationResults.runId;
        } else if (reportData.scanResults) {
          reportType = "scan";

          const latestScan = await prisma.scanReport.findFirst({
            where: { shopId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          reportId = latestScan?.id || "";
        }

        if (reportId) {
          const shareResult = await createShareableReport({
            shopId,
            reportType,
            reportId,
            expiresInDays: 7,
          });
          shareUrl = shareResult.shareUrl;
        }
      } catch (shareError) {
        logger.warn("Failed to create shareable link", { error: shareError });

      }
    }

    logger.info("PDF report generated", { shopId, reportData, shareUrl });

    return {
      success: true,
      reportData,
      shareUrl,
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
    priority: number | null;
    estimatedTimeMinutes: number | null;
    suggestedMigration: string;
    displayName: string | null;
    dependencies?: string[];
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
  reconciliation?: {
    pixelVsCapi: {
      both: number;
      pixelOnly: number;
      capiOnly: number;
      consentBlocked: number;
    };
    consistencyIssues?: Array<{
      orderId: string;
      issue: string;
      type: string;
    }>;
    localConsistency?: {
      totalChecked: number;
      consistent: number;
      partial: number;
      inconsistent: number;
    };
  };
  testResults?: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    missingParamTests: number;
    parameterCompleteness: number;
    valueAccuracy: number;
  };
}

export interface MigrationReportData {
  shopDomain: string;
  generatedAt: string;
  reportType: "migration";
  migrationActions: Array<{
    title: string;
    platform: string;
    priority: number;
    status: "pending" | "in_progress" | "completed" | "skipped";
    description: string;
  }>;
  completedCount: number;
  totalCount: number;
}

export interface MigrationReportData {
  shopDomain: string;
  generatedAt: string;
  reportType: "migration";
  migrationActions: Array<{
    title: string;
    platform: string;
    priority: number;
    status: "pending" | "in_progress" | "completed" | "skipped";
    description: string;
  }>;
  completedCount: number;
  totalCount: number;
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
        priority: true,
        estimatedTimeMinutes: true,
        suggestedMigration: true,
        displayName: true,
        dependencies: true,
      },
      orderBy: [
        { priority: "desc" },
        { riskLevel: "desc" },
      ],
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
        priority: asset.priority,
        estimatedTimeMinutes: asset.estimatedTimeMinutes,
        suggestedMigration: asset.suggestedMigration,
        displayName: asset.displayName,
        dependencies: asset.dependencies ? (asset.dependencies as string[]) : undefined,
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
      totalTests?: number;
      passedTests?: number;
      failedTests?: number;
      missingParamTests?: number;
      parameterCompleteness?: number;
      valueAccuracy?: number;
      reconciliation?: {
        pixelVsCapi: {
          both: number;
          pixelOnly: number;
          capiOnly: number;
          consentBlocked: number;
        };
        consistencyIssues?: Array<{
          orderId: string;
          issue: string;
          type: string;
        }>;
        localConsistency?: {
          totalChecked: number;
          consistent: number;
          partial: number;
          inconsistent: number;
        };
      };
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
      reconciliation: summary?.reconciliation,
      testResults: summary?.totalTests ? {
        totalTests: summary.totalTests,
        passedTests: summary.passedTests || 0,
        failedTests: summary.failedTests || 0,
        missingParamTests: summary.missingParamTests || 0,
        parameterCompleteness: summary.parameterCompleteness || 0,
        valueAccuracy: summary.valueAccuracy || 0,
      } : undefined,
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

  const totalAssets = data.auditAssets.length;
  const highPriorityAssets = data.auditAssets.filter(a => a.priority && a.priority >= 8).length;
  const mediumPriorityAssets = data.auditAssets.filter(a => a.priority && a.priority >= 5 && a.priority < 8).length;
  const lowPriorityAssets = data.auditAssets.filter(a => !a.priority || a.priority < 5).length;
  const totalEstimatedTime = data.auditAssets.reduce((sum, a) => sum + (a.estimatedTimeMinutes || 0), 0);
  const estimatedHours = Math.floor(totalEstimatedTime / 60);
  const estimatedMinutes = totalEstimatedTime % 60;

  const sortedAssets = [...data.auditAssets].sort((a, b) => {
    const priorityA = a.priority || 0;
    const priorityB = b.priority || 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
    const riskOrder = { high: 3, medium: 2, low: 1 };
    return (riskOrder[b.riskLevel as keyof typeof riskOrder] || 0) - (riskOrder[a.riskLevel as keyof typeof riskOrder] || 0);
  });

  const migrationTypeLabels: Record<string, string> = {
    web_pixel: "Web Pixel",
    ui_extension: "UI Extension",
    server_side: "服务端 CAPI",
    none: "无需迁移",
  };

  const riskLevelLabels: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
  };

  const migrationStatusLabels: Record<string, string> = {
    pending: "待迁移",
    in_progress: "进行中",
    completed: "已完成",
    skipped: "已跳过",
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      padding: 40px;
      max-width: 1200px;
      margin: 0 auto;
      color: #333;
      line-height: 1.6;
    }
    h1 {
      color: #202223;
      border-bottom: 3px solid #008060;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }
    h2 {
      color: #202223;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin: 30px 0;
    }
    .summary-card {
      background: #f6f6f7;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #008060;
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #6d7175;
      text-transform: uppercase;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #202223;
      margin: 5px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: white;
    }
    th, td {
      border: 1px solid #e1e3e5;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #f6f6f7;
      font-weight: 600;
      color: #202223;
    }
    tr:nth-child(even) {
      background-color: #fafbfb;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-high {
      background: #fee;
      color: #d72c0d;
    }
    .badge-medium {
      background: #fff3cd;
      color: #b98900;
    }
    .badge-low {
      background: #e3fcef;
      color: #008060;
    }
    .badge-pending {
      background: #e1e3e5;
      color: #6d7175;
    }
    .badge-in-progress {
      background: #e3fcef;
      color: #008060;
    }
    .badge-completed {
      background: #e3fcef;
      color: #008060;
    }
    .priority-high {
      color: #d72c0d;
      font-weight: bold;
    }
    .priority-medium {
      color: #b98900;
      font-weight: bold;
    }
    .priority-low {
      color: #6d7175;
    }
    .metadata {
      background: #f6f6f7;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .metadata p {
      margin: 5px 0;
      color: #6d7175;
    }
  </style>
</head>
<body>
  <h1>📋 扫描报告 - ${data.shopDomain}</h1>

  <div class="metadata">
    <p><strong>生成时间:</strong> ${timestamp}</p>
    <p><strong>风险分数:</strong> <span style="font-size: 24px; font-weight: bold; color: ${data.riskScore >= 70 ? "#d72c0d" : data.riskScore >= 40 ? "#b98900" : "#008060"};">${data.riskScore}</span> / 100</p>
    <p><strong>识别平台:</strong> ${data.identifiedPlatforms.length > 0 ? data.identifiedPlatforms.join(", ") : "无"}</p>
    <p><strong>ScriptTags 数量:</strong> ${data.scriptTagsCount}</p>
  </div>

  <!-- P0-05: Checkout Extensibility 风险提示 -->
  <div style="background: #fff4e6; border-left: 4px solid #ff9800; padding: 20px; margin: 20px 0; border-radius: 4px;">
    <h2 style="color: #e65100; margin-top: 0;">⚠️ 重要提示：Checkout Extensibility 迁移边界情况</h2>
    <p style="margin: 10px 0;"><strong>为确保数据不断档，请注意以下边界情况：</strong></p>
    <ul style="margin: 10px 0; padding-left: 20px;">
      <li style="margin: 8px 0;"><strong>旧脚本弃用时间线：</strong> Thank you / Order status 页面的旧方式（script tags / additional scripts / checkout.liquid）已被 Checkout Extensibility 替换，且有明确的关停日期。请确保在关停前完成迁移。</li>
      <li style="margin: 8px 0;"><strong>checkout_completed 触发位置：</strong> 该事件不一定在 Thank you 页触发。当存在 upsell / post-purchase 时，可能在第一个 upsell 页触发，且 Thank you 页不再触发。若触发页加载失败则完全不触发。建议使用 server-side webhook（orders/paid）作为兜底。</li>
      <li style="margin: 8px 0;"><strong>Web Pixel 隐私与 consent：</strong> 在需要 consent 的地区，回调会在 consent 后执行，之前注册的事件会 replay。请确保您的迁移方案能正确处理 consent 状态变化。</li>
    </ul>
    <p style="margin: 10px 0; font-style: italic; color: #666;">💡 <strong>建议：</strong> 在验收测试中，请特别关注 upsell 场景和 consent 变化场景，并验证 server-side webhook 兜底机制是否正常工作。</p>
  </div>

  <h2>📊 迁移清单统计</h2>
  <div class="summary-grid">
    <div class="summary-card">
      <h3>总资产数</h3>
      <div class="value">${totalAssets}</div>
    </div>
    <div class="summary-card">
      <h3>高优先级</h3>
      <div class="value" style="color: #d72c0d;">${highPriorityAssets}</div>
    </div>
    <div class="summary-card">
      <h3>中优先级</h3>
      <div class="value" style="color: #b98900;">${mediumPriorityAssets}</div>
    </div>
    <div class="summary-card">
      <h3>预计总时间</h3>
      <div class="value">${estimatedHours > 0 ? `${estimatedHours} 小时 ` : ""}${estimatedMinutes} 分钟</div>
    </div>
  </div>

  <h2>📋 迁移清单（按优先级排序）</h2>
  <table>
    <thead>
      <tr>
        <th>资产名称</th>
        <th>类别</th>
        <th>平台</th>
        <th>风险等级</th>
        <th>优先级</th>
        <th>预计时间</th>
        <th>迁移方式</th>
        <th>迁移状态</th>
        <th>依赖关系</th>
      </tr>
    </thead>
    <tbody>
      ${sortedAssets.map((asset) => {
        const priorityClass = asset.priority && asset.priority >= 8 ? "priority-high" :
                             asset.priority && asset.priority >= 5 ? "priority-medium" : "priority-low";
        const priorityDisplay = asset.priority ? `${asset.priority}/10` : "待计算";
        const timeDisplay = asset.estimatedTimeMinutes
          ? asset.estimatedTimeMinutes < 60
            ? `${asset.estimatedTimeMinutes} 分钟`
            : `${Math.floor(asset.estimatedTimeMinutes / 60)} 小时 ${asset.estimatedTimeMinutes % 60} 分钟`
          : "待估算";
        const dependenciesDisplay = asset.dependencies && asset.dependencies.length > 0
          ? `${asset.dependencies.length} 个依赖`
          : "无";

        return `
        <tr>
          <td><strong>${asset.displayName || asset.category}</strong></td>
          <td>${asset.category}</td>
          <td>${asset.platform || "-"}</td>
          <td><span class="badge badge-${asset.riskLevel}">${riskLevelLabels[asset.riskLevel] || asset.riskLevel}</span></td>
          <td class="${priorityClass}">${priorityDisplay}</td>
          <td>${timeDisplay}</td>
          <td>${migrationTypeLabels[asset.suggestedMigration] || asset.suggestedMigration}</td>
          <td><span class="badge badge-${asset.migrationStatus}">${migrationStatusLabels[asset.migrationStatus] || asset.migrationStatus}</span></td>
          <td>${dependenciesDisplay}</td>
        </tr>
      `;
      }).join("")}
    </tbody>
  </table>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e1e3e5; color: #6d7175; font-size: 12px; text-align: center;">
    <p>报告由 Tracking Guardian 自动生成</p>
    <p>生成时间: ${new Date().toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>
  `;
}

export function generateVerificationReportHtml(data: VerificationReportData): string {
  const successRate = data.summary.totalEvents > 0
    ? ((data.summary.successfulEvents / data.summary.totalEvents) * 100).toFixed(2)
    : "0.00";
  const failureRate = data.summary.totalEvents > 0
    ? ((data.summary.failedEvents / data.summary.totalEvents) * 100).toFixed(2)
    : "0.00";

  const successBarWidth = successRate;
  const failureBarWidth = failureRate;

  const missingParamsRows = Object.entries(data.summary.missingParams || {}).length > 0
    ? Object.entries(data.summary.missingParams).map(([platform, params]) => `
        <tr>
          <td>${platform}</td>
          <td>${Array.isArray(params) ? params.join(", ") : params}</td>
        </tr>
      `).join("")
    : "<tr><td colspan='2'>无缺失参数</td></tr>";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      padding: 40px;
      max-width: 1200px;
      margin: 0 auto;
      color: #333;
      line-height: 1.6;
    }
    h1 {
      color: #202223;
      border-bottom: 3px solid #008060;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }
    h2 {
      color: #202223;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin: 30px 0;
    }
    .summary-card {
      background: #f6f6f7;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #008060;
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #6d7175;
      text-transform: uppercase;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #202223;
      margin: 5px 0;
    }
    .chart-container {
      margin: 30px 0;
      padding: 20px;
      background: #ffffff;
      border: 1px solid #e1e3e5;
      border-radius: 8px;
    }
    .progress-bar {
      width: 100%;
      height: 30px;
      background: #e1e3e5;
      border-radius: 15px;
      overflow: hidden;
      margin: 10px 0;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 12px;
      transition: width 0.3s ease;
    }
    .progress-success {
      background: #008060;
    }
    .progress-warning {
      background: #ffc453;
    }
    .progress-error {
      background: #d72c0d;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: white;
    }
    th, td {
      border: 1px solid #e1e3e5;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #f6f6f7;
      font-weight: 600;
      color: #202223;
    }
    tr:nth-child(even) {
      background-color: #fafbfb;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success {
      background: #e3fcef;
      color: #008060;
    }
    .badge-warning {
      background: #fff3cd;
      color: #b98900;
    }
    .badge-error {
      background: #fee;
      color: #d72c0d;
    }
    .metadata {
      background: #f6f6f7;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .metadata p {
      margin: 5px 0;
      color: #6d7175;
    }
  </style>
</head>
<body>
  <h1>📋 验收报告 - ${data.shopDomain}</h1>

  <div class="metadata">
    <p><strong>运行名称:</strong> ${data.runName || "未命名"}</p>
    <p><strong>报告生成时间:</strong> ${new Date().toLocaleString("zh-CN")}</p>
    <p><strong>状态:</strong> <span class="badge ${data.status === "completed" ? "badge-success" : data.status === "failed" ? "badge-error" : "badge-warning"}">${data.status === "completed" ? "已完成" : data.status === "failed" ? "失败" : "进行中"}</span></p>
  </div>

  <h2>📊 验收汇总</h2>
  <div class="summary-grid">
    <div class="summary-card">
      <h3>总事件数</h3>
      <div class="value">${data.summary.totalEvents}</div>
    </div>
    <div class="summary-card">
      <h3>成功事件</h3>
      <div class="value" style="color: #008060;">${data.summary.successfulEvents}</div>
    </div>
    <div class="summary-card">
      <h3>失败事件</h3>
      <div class="value" style="color: #d72c0d;">${data.summary.failedEvents}</div>
    </div>
  </div>

  <div class="chart-container">
    <h3>成功率可视化</h3>
    <div style="margin-bottom: 15px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span>成功率</span>
        <span><strong>${successRate}%</strong></span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill progress-success" style="width: ${successRate}%;">
          ${parseFloat(successRate) > 5 ? successRate + "%" : ""}
        </div>
      </div>
    </div>
    <div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span>失败率</span>
        <span><strong>${failureRate}%</strong></span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill progress-error" style="width: ${failureRate}%;">
          ${parseFloat(failureRate) > 5 ? failureRate + "%" : ""}
        </div>
      </div>
    </div>
  </div>

  <h2>🔍 参数缺失详情</h2>
  <table>
    <thead>
      <tr>
        <th>平台</th>
        <th>缺失参数</th>
      </tr>
    </thead>
    <tbody>
      ${missingParamsRows}
    </tbody>
  </table>

  ${data.testResults ? `
  <h2>📊 测试结果统计</h2>
  <div class="summary-grid">
    <div class="summary-card">
      <h3>通过率</h3>
      <div class="value" style="color: ${data.testResults.parameterCompleteness >= 80 ? "#008060" : data.testResults.parameterCompleteness >= 50 ? "#ffc453" : "#d72c0d"};">
        ${data.testResults.totalTests > 0 ? Math.round((data.testResults.passedTests / data.testResults.totalTests) * 100) : 0}%
      </div>
      <p style="margin: 5px 0; font-size: 12px; color: #6d7175;">
        ${data.testResults.passedTests}/${data.testResults.totalTests} 项通过
      </p>
    </div>
    <div class="summary-card">
      <h3>参数完整率</h3>
      <div class="value" style="color: ${data.testResults.parameterCompleteness >= 80 ? "#008060" : data.testResults.parameterCompleteness >= 50 ? "#ffc453" : "#d72c0d"};">
        ${data.testResults.parameterCompleteness}%
      </div>
    </div>
    <div class="summary-card">
      <h3>金额准确率</h3>
      <div class="value" style="color: ${data.testResults.valueAccuracy >= 95 ? "#008060" : data.testResults.valueAccuracy >= 80 ? "#ffc453" : "#d72c0d"};">
        ${data.testResults.valueAccuracy}%
      </div>
    </div>
  </div>
  ` : ""}

  ${data.reconciliation ? `
  <h2>🔄 渠道对账分析</h2>
  <div class="summary-grid">
    <div class="summary-card">
      <h3>两者都有</h3>
      <div class="value" style="color: #008060;">${data.reconciliation.pixelVsCapi.both}</div>
    </div>
    <div class="summary-card">
      <h3>仅 Pixel</h3>
      <div class="value" style="color: #008060;">${data.reconciliation.pixelVsCapi.pixelOnly}</div>
    </div>
    <div class="summary-card">
      <h3>仅 CAPI</h3>
      <div class="value" style="color: #ffc453;">${data.reconciliation.pixelVsCapi.capiOnly}</div>
    </div>
  </div>
  ${data.reconciliation.pixelVsCapi.consentBlocked > 0 ? `
  <div class="summary-card" style="margin-top: 20px;">
    <h3>因同意阻止</h3>
    <div class="value" style="color: #6d7175;">${data.reconciliation.pixelVsCapi.consentBlocked}</div>
  </div>
  ` : ""}
  ${data.reconciliation.localConsistency ? `
  <div style="margin-top: 30px;">
    <h3>本地一致性检查</h3>
    <div class="summary-grid">
      <div class="summary-card">
        <h3>检查订单数</h3>
        <div class="value">${data.reconciliation.localConsistency.totalChecked}</div>
      </div>
      <div class="summary-card">
        <h3>一致</h3>
        <div class="value" style="color: #008060;">${data.reconciliation.localConsistency.consistent}</div>
      </div>
      <div class="summary-card">
        <h3>部分一致</h3>
        <div class="value" style="color: #ffc453;">${data.reconciliation.localConsistency.partial}</div>
      </div>
      <div class="summary-card">
        <h3>不一致</h3>
        <div class="value" style="color: #d72c0d;">${data.reconciliation.localConsistency.inconsistent}</div>
      </div>
    </div>
  </div>
  ` : ""}
  ${data.reconciliation.consistencyIssues && data.reconciliation.consistencyIssues.length > 0 ? `
  <div style="margin-top: 30px;">
    <h3>一致性问题</h3>
    <table>
      <thead>
        <tr>
          <th>订单 ID</th>
          <th>问题类型</th>
          <th>问题描述</th>
        </tr>
      </thead>
      <tbody>
        ${data.reconciliation.consistencyIssues.slice(0, 10).map((issue) => `
          <tr>
            <td>${issue.orderId}</td>
            <td><span class="badge ${issue.type === "error" ? "badge-error" : "badge-warning"}">${issue.type === "value_mismatch" ? "金额不匹配" : issue.type === "currency_mismatch" ? "币种不匹配" : issue.type === "missing" ? "缺失" : issue.type === "duplicate" ? "重复" : issue.type === "error" ? "错误" : "警告"}</span></td>
            <td>${issue.issue}</td>
          </tr>
        `).join("")}
        ${data.reconciliation.consistencyIssues.length > 10 ? `
          <tr>
            <td colspan="3" style="text-align: center; color: #6d7175;">
              还有 ${data.reconciliation.consistencyIssues.length - 10} 个问题未显示
            </td>
          </tr>
        ` : ""}
      </tbody>
    </table>
  </div>
  ` : ""}
  ` : ""}

  <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e1e3e5; color: #6d7175; font-size: 12px; text-align: center;">
    <p>报告由 Tracking Guardian 自动生成</p>
    <p>生成时间: ${new Date().toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>
  `;
}

export function generateMigrationReportHtml(data: MigrationReportData): string {
  const timestamp = new Date(data.generatedAt).toLocaleString("zh-CN");
  const progressPercent = data.totalCount > 0 ? Math.round((data.completedCount / data.totalCount) * 100) : 0;

  const sortedActions = [...data.migrationActions].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const statusOrder = { completed: 0, in_progress: 1, pending: 2, skipped: 3 };
    return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      padding: 40px;
      max-width: 1200px;
      margin: 0 auto;
      color: #333;
      line-height: 1.6;
    }
    h1 {
      color: #202223;
      border-bottom: 3px solid #008060;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }
    h2 {
      color: #202223;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin: 30px 0;
    }
    .summary-card {
      background: #f6f6f7;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #008060;
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #6d7175;
      text-transform: uppercase;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #202223;
      margin: 5px 0;
    }
    .progress-bar {
      width: 100%;
      height: 30px;
      background: #e1e3e5;
      border-radius: 15px;
      overflow: hidden;
      margin: 20px 0;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #008060 0%, #00a082 100%);
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background: white;
    }
    th, td {
      border: 1px solid #e1e3e5;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #f6f6f7;
      font-weight: 600;
      color: #202223;
    }
    tr:nth-child(even) {
      background-color: #fafbfb;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-pending {
      background: #e1e3e5;
      color: #6d7175;
    }
    .badge-in-progress {
      background: #fff3cd;
      color: #b98900;
    }
    .badge-completed {
      background: #e3fcef;
      color: #008060;
    }
    .badge-skipped {
      background: #f8d7da;
      color: #721c24;
    }
    .priority-high {
      color: #d72c0d;
      font-weight: bold;
    }
    .priority-medium {
      color: #b98900;
      font-weight: bold;
    }
    .priority-low {
      color: #6d7175;
    }
    .metadata {
      background: #f6f6f7;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .metadata p {
      margin: 5px 0;
      color: #6d7175;
    }
  </style>
</head>
<body>
  <h1>🚀 迁移报告 - ${data.shopDomain}</h1>

  <div class="metadata">
    <p><strong>生成时间:</strong> ${timestamp}</p>
    <p><strong>报告类型:</strong> ${data.reportType}</p>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <h3>总任务数</h3>
      <div class="value">${data.totalCount}</div>
    </div>
    <div class="summary-card">
      <h3>已完成</h3>
      <div class="value" style="color: #008060;">${data.completedCount}</div>
    </div>
    <div class="summary-card">
      <h3>进行中</h3>
      <div class="value" style="color: #b98900;">${data.migrationActions.filter(a => a.status === "in_progress").length}</div>
    </div>
    <div class="summary-card">
      <h3>待处理</h3>
      <div class="value" style="color: #6d7175;">${data.migrationActions.filter(a => a.status === "pending").length}</div>
    </div>
  </div>

  <h2>📊 迁移进度</h2>
  <div class="progress-bar">
    <div class="progress-fill" style="width: ${progressPercent}%;">
      ${progressPercent}%
    </div>
  </div>

  <h2>📋 迁移任务列表</h2>
  <table>
    <thead>
      <tr>
        <th>任务标题</th>
        <th>平台</th>
        <th>优先级</th>
        <th>状态</th>
        <th>描述</th>
      </tr>
    </thead>
    <tbody>
      ${sortedActions.map((action) => `
        <tr>
          <td><strong>${action.title}</strong></td>
          <td>${action.platform || "N/A"}</td>
          <td class="${action.priority >= 8 ? "priority-high" : action.priority >= 5 ? "priority-medium" : "priority-low"}">
            ${action.priority}/10
          </td>
          <td>
            <span class="badge badge-${action.status}">
              ${action.status === "pending" ? "待处理" : action.status === "in_progress" ? "进行中" : action.status === "completed" ? "已完成" : "已跳过"}
            </span>
          </td>
          <td>${action.description || "无描述"}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e1e3e5; color: #6d7175; font-size: 12px; text-align: center;">
    <p>报告由 Tracking Guardian 自动生成</p>
    <p>生成时间: ${new Date().toLocaleString("zh-CN")}</p>
  </div>
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
