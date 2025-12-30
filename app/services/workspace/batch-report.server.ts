
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { canManageMultipleShops, getShopGroupDetails } from "../multi-shop.server";
import { generateWorkspaceMigrationReport, type WorkspaceMigrationReport } from "../workspace-report.server";
import { getBatchAuditStatus, type BatchAuditResult } from "../batch-audit.server";
import type { EnhancedBatchApplyResult } from "./batch-template-apply.server";

export interface BatchReportOptions {
  groupId: string;
  requesterId: string;
  reportTypes?: Array<"audit" | "migration" | "verification" | "template_apply">;
  includeDetails?: boolean;
  whiteLabel?: {
    companyName?: string;
    logoUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
  };
}

export interface ShopReportData {
  shopId: string;
  shopDomain: string;
  auditReport?: {
    riskScore?: number;
    identifiedPlatforms?: string[];
    highRiskCount?: number;
    scanDate?: Date;
  };
  migrationStatus?: {
    status: "not_started" | "in_progress" | "completed" | "failed";
    completedItems: number;
    totalItems: number;
    highPriorityItems: number;
    estimatedTimeMinutes: number;
  };
  verificationStatus?: {
    lastRunAt?: Date;
    successRate?: number;
    totalTests?: number;
    passedTests?: number;
  };
  templateApplyResult?: {
    platformsApplied?: string[];
    appliedAt?: Date;
  };
}

export interface BatchReportData {
  groupId: string;
  groupName: string;
  generatedAt: Date;
  shops: ShopReportData[];
  summary: {
    totalShops: number;
    shopsWithAudit: number;
    shopsWithMigration: number;
    shopsWithVerification: number;
    avgRiskScore: number;
    totalHighPriorityItems: number;
    totalEstimatedTime: number;
    completedShops: number;
    inProgressShops: number;
    notStartedShops: number;
  };
  whiteLabel?: {
    companyName?: string;
    logoUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
  };
}

/**
 * 生成多店铺迁移验收聚合报告数据
 */
export async function generateBatchReportData(
  options: BatchReportOptions
): Promise<BatchReportData | { error: string }> {
  const {
    groupId,
    requesterId,
    reportTypes = ["audit", "migration", "verification"],
    includeDetails = true,
    whiteLabel,
  } = options;

  const canManage = await canManageMultipleShops(requesterId);
  if (!canManage) {
    return { error: "当前套餐不支持批量报告，请升级到 Agency 版" };
  }

  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) {
    return { error: "分组不存在或无权访问" };
  }

  const shopReports: ShopReportData[] = [];

  for (const member of groupDetails.members) {
    const shopId = member.shopId;
    const shopDomain = member.shopDomain;
    const shopData: ShopReportData = {
      shopId,
      shopDomain,
    };

    // 获取 Audit 报告数据
    if (reportTypes.includes("audit")) {
      const latestScan = await prisma.scanReport.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: {
          riskScore: true,
          identifiedPlatforms: true,
          createdAt: true,
        },
      });

      if (latestScan) {
        const highRiskAssets = await prisma.auditAsset.count({
          where: {
            shopId,
            riskLevel: "high",
          },
        });

        shopData.auditReport = {
          riskScore: latestScan.riskScore,
          identifiedPlatforms: latestScan.identifiedPlatforms as string[] | undefined,
          highRiskCount: highRiskAssets,
          scanDate: latestScan.createdAt,
        };
      }
    }

    // 获取迁移状态数据
    if (reportTypes.includes("migration")) {
      const { getMigrationChecklist } = await import("../migration-checklist.server");
      const { getMigrationProgress } = await import("../migration-priority.server");

      try {
        const checklist = await getMigrationChecklist(shopId, false);
        const progress = await getMigrationProgress(shopId);

        let migrationStatus: ShopReportData["migrationStatus"]["status"] = "not_started";
        if (progress.completed === progress.total && progress.total > 0) {
          migrationStatus = "completed";
        } else if (progress.inProgress > 0 || progress.completed > 0) {
          migrationStatus = "in_progress";
        }

        shopData.migrationStatus = {
          status: migrationStatus,
          completedItems: progress.completed,
          totalItems: checklist.totalItems,
          highPriorityItems: checklist.highPriorityItems,
          estimatedTimeMinutes: checklist.estimatedTotalTime,
        };
      } catch (error) {
        logger.error(`Failed to get migration status for shop ${shopId}`, { error });
      }
    }

    // 获取验证状态数据
    if (reportTypes.includes("verification")) {
      const latestVerification = await prisma.verificationRun.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          summary: true,
        },
      });

      if (latestVerification && latestVerification.summary) {
        const summary = latestVerification.summary as {
          totalTests?: number;
          passedTests?: number;
        };

        shopData.verificationStatus = {
          lastRunAt: latestVerification.createdAt,
          totalTests: summary.totalTests,
          passedTests: summary.passedTests,
          successRate:
            summary.totalTests && summary.totalTests > 0
              ? (summary.passedTests || 0) / summary.totalTests
              : undefined,
        };
      }
    }

    shopReports.push(shopData);
  }

  // 计算汇总数据
  const shopsWithAudit = shopReports.filter((s) => s.auditReport).length;
  const shopsWithMigration = shopReports.filter((s) => s.migrationStatus).length;
  const shopsWithVerification = shopReports.filter((s) => s.verificationStatus).length;

  const riskScores = shopReports
    .map((s) => s.auditReport?.riskScore)
    .filter((score): score is number => score !== undefined);

  const avgRiskScore = riskScores.length > 0
    ? riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length
    : 0;

  const totalHighPriorityItems = shopReports.reduce(
    (sum, s) => sum + (s.migrationStatus?.highPriorityItems || 0),
    0
  );

  const totalEstimatedTime = shopReports.reduce(
    (sum, s) => sum + (s.migrationStatus?.estimatedTimeMinutes || 0),
    0
  );

  const completedShops = shopReports.filter(
    (s) => s.migrationStatus?.status === "completed"
  ).length;
  const inProgressShops = shopReports.filter(
    (s) => s.migrationStatus?.status === "in_progress"
  ).length;
  const notStartedShops = shopReports.filter(
    (s) => s.migrationStatus?.status === "not_started"
  ).length;

  return {
    groupId,
    groupName: groupDetails.name,
    generatedAt: new Date(),
    shops: shopReports,
    summary: {
      totalShops: shopReports.length,
      shopsWithAudit,
      shopsWithMigration,
      shopsWithVerification,
      avgRiskScore: Math.round(avgRiskScore * 10) / 10,
      totalHighPriorityItems,
      totalEstimatedTime,
      completedShops,
      inProgressShops,
      notStartedShops,
    },
    whiteLabel,
  };
}

/**
 * 生成PDF格式的聚合报告
 */
export async function generateBatchReportPdf(
  options: BatchReportOptions
): Promise<{ buffer: Buffer; filename: string; contentType: string } | { error: string }> {
  const reportData = await generateBatchReportData(options);

  if ("error" in reportData) {
    return reportData;
  }

  try {
    const html = generateReportHtml(reportData, options);
    
    // 使用与workspace-report.server.ts相同的方式生成PDF
    const pdfGenerator = await import("../pdf-generator.server");
    const pdfBuffer = await pdfGenerator.htmlToPdf(html, {
      format: "A4",
      margin: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    if (!pdfBuffer) {
      return { error: "PDF生成失败" };
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `batch-migration-report-${reportData.groupName.replace(/\s+/g, "_")}-${timestamp}.pdf`;

    return {
      buffer: pdfBuffer,
      filename,
      contentType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate batch PDF report", { error, groupId: options.groupId });
    return { error: error instanceof Error ? error.message : "PDF生成失败" };
  }
}

/**
 * 生成报告HTML内容
 */
function generateReportHtml(
  reportData: BatchReportData,
  options: BatchReportOptions
): string {
  const companyName = options.whiteLabel?.companyName || "Tracking Guardian";
  const logoUrl = options.whiteLabel?.logoUrl;
  const includeDetails = options.includeDetails ?? true;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>多店铺迁移验收报告 - ${reportData.groupName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    .header {
      border-bottom: 2px solid #e1e3e5;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #202223;
    }
    .logo {
      max-height: 60px;
      max-width: 200px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: #f6f6f7;
      padding: 20px;
      border-radius: 8px;
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #6d7175;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #202223;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 12px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e1e3e5;
    }
    th {
      background: #f6f6f7;
      font-weight: 600;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-completed { background: #d4edda; color: #155724; }
    .status-in_progress { background: #fff3cd; color: #856404; }
    .status-not_started { background: #e2e3e5; color: #202223; }
    .status-failed { background: #f5c6cb; color: #721c24; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e1e3e5;
      text-align: center;
      color: #6d7175;
      font-size: 12px;
    }
    .section {
      margin-top: 30px;
      page-break-inside: avoid;
    }
    .shop-section {
      margin-top: 20px;
      padding: 15px;
      background: #f9f9fa;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-content">
      <div>
        <h1>多店铺迁移验收报告</h1>
        <p>分组: ${reportData.groupName}</p>
        <p>生成时间: ${reportData.generatedAt.toLocaleString("zh-CN")}</p>
      </div>
      ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo">` : ""}
    </div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <h3>总店铺数</h3>
      <div class="value">${reportData.summary.totalShops}</div>
    </div>
    <div class="summary-card">
      <h3>已完成</h3>
      <div class="value">${reportData.summary.completedShops}</div>
    </div>
    <div class="summary-card">
      <h3>进行中</h3>
      <div class="value">${reportData.summary.inProgressShops}</div>
    </div>
    <div class="summary-card">
      <h3>未开始</h3>
      <div class="value">${reportData.summary.notStartedShops}</div>
    </div>
    <div class="summary-card">
      <h3>平均风险分数</h3>
      <div class="value">${reportData.summary.avgRiskScore.toFixed(1)}</div>
    </div>
    <div class="summary-card">
      <h3>高风险项总数</h3>
      <div class="value">${reportData.summary.totalHighPriorityItems}</div>
    </div>
  </div>

  <div class="section">
    <h2>店铺迁移状态汇总</h2>
    <table>
      <thead>
        <tr>
          <th>店铺域名</th>
          <th>迁移状态</th>
          <th>进度</th>
          <th>风险分数</th>
          <th>高风险项</th>
          <th>预计时间</th>
          ${includeDetails ? "<th>最后扫描</th><th>最后验收</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${reportData.shops.map((shop) => {
          const progressPercent = shop.migrationStatus && shop.migrationStatus.totalItems > 0
            ? Math.round((shop.migrationStatus.completedItems / shop.migrationStatus.totalItems) * 100)
            : 0;
          const status = shop.migrationStatus?.status || "not_started";
          const statusClass = `status-${status}`;
          const statusLabels: Record<string, string> = {
            completed: "已完成",
            in_progress: "进行中",
            not_started: "未开始",
            failed: "失败",
          };

          return `
          <tr>
            <td>${shop.shopDomain}</td>
            <td><span class="status-badge ${statusClass}">${statusLabels[status]}</span></td>
            <td>${shop.migrationStatus ? `${shop.migrationStatus.completedItems}/${shop.migrationStatus.totalItems} (${progressPercent}%)` : "N/A"}</td>
            <td>${shop.auditReport?.riskScore?.toFixed(1) || "N/A"}</td>
            <td>${shop.migrationStatus?.highPriorityItems || 0}</td>
            <td>${shop.migrationStatus ? `${Math.ceil(shop.migrationStatus.estimatedTimeMinutes / 60)} 小时` : "N/A"}</td>
            ${includeDetails 
              ? `<td>${shop.auditReport?.scanDate ? shop.auditReport.scanDate.toLocaleString("zh-CN") : "从未"}</td>
                 <td>${shop.verificationStatus?.lastRunAt ? shop.verificationStatus.lastRunAt.toLocaleString("zh-CN") : "从未"}</td>`
              : ""}
          </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  </div>

  ${includeDetails && reportData.shops.some(s => s.auditReport || s.verificationStatus) ? `
  <div class="section">
    <h2>店铺详细信息</h2>
    ${reportData.shops.map((shop) => `
      <div class="shop-section">
        <h3>${shop.shopDomain}</h3>
        ${shop.auditReport ? `
          <h4>扫描结果</h4>
          <ul>
            <li>风险分数: ${shop.auditReport.riskScore}</li>
            <li>识别平台: ${shop.auditReport.identifiedPlatforms?.join(", ") || "无"}</li>
            <li>高风险项: ${shop.auditReport.highRiskCount || 0}</li>
            <li>扫描时间: ${shop.auditReport.scanDate?.toLocaleString("zh-CN") || "N/A"}</li>
          </ul>
        ` : ""}
        ${shop.verificationStatus ? `
          <h4>验收结果</h4>
          <ul>
            <li>成功率: ${shop.verificationStatus.successRate ? (shop.verificationStatus.successRate * 100).toFixed(1) + "%" : "N/A"}</li>
            <li>通过测试: ${shop.verificationStatus.passedTests || 0}/${shop.verificationStatus.totalTests || 0}</li>
            <li>最后运行: ${shop.verificationStatus.lastRunAt?.toLocaleString("zh-CN") || "从未"}</li>
          </ul>
        ` : ""}
      </div>
    `).join("")}
  </div>
  ` : ""}

  <div class="footer">
    <p>本报告由 ${companyName} 自动生成</p>
    ${options.whiteLabel?.contactEmail ? `<p>联系方式: ${options.whiteLabel.contactEmail}</p>` : ""}
    <p>报告时间: ${reportData.generatedAt.toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>
  `.trim();
}

