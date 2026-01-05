
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { generateVerificationReportPdf, htmlToPdf } from "./pdf-generator.server";
import { getMigrationChecklist } from "./migration-checklist.server";
import { getMigrationProgress } from "./migration-priority.server";

export interface ShopMigrationStatus {
  shopId: string;
  shopDomain: string;
  migrationStatus: "not_started" | "in_progress" | "completed" | "failed";
  totalItems: number;
  completedItems: number;
  highPriorityItems: number;
  estimatedTimeMinutes: number;
  lastScanAt: Date | null;
  lastVerificationAt: Date | null;
  issues: string[];
}

export interface WorkspaceMigrationReport {
  workspaceId: string;
  workspaceName: string;
  generatedAt: Date;
  shops: ShopMigrationStatus[];
  summary: {
    totalShops: number;
    completedShops: number;
    inProgressShops: number;
    notStartedShops: number;
    totalEstimatedTime: number;
    totalHighPriorityItems: number;
  };
}

export async function generateWorkspaceMigrationReport(
  groupId: string,
  ownerId: string
): Promise<WorkspaceMigrationReport | null> {
  const group = await prisma.shopGroup.findUnique({
    where: { id: groupId },
    include: {
      ShopGroupMember: {
        select: {
          shopId: true,
        },
      },
    },
  });

  if (!group || group.ownerId !== ownerId) {
    logger.warn(`Workspace group not found or access denied: ${groupId}`);
    return null;
  }

  const shopStatuses: ShopMigrationStatus[] = [];

  const members = "ShopGroupMember" in group ? (group as typeof group & { ShopGroupMember: Array<{ shopId: string; Shop?: { shopDomain: string } }> }).ShopGroupMember : [];
  for (const member of members) {
    const shopId = member.shopId;
    const shopDomain = member.Shop?.shopDomain || "unknown";

    try {
      const checklist = await getMigrationChecklist(shopId, false);
      const progress = await getMigrationProgress(shopId);

      const latestScan = await prisma.scanReport.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const latestVerification = await prisma.verificationRun.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const issues: string[] = [];
      if (checklist.highPriorityItems > 0) {
        issues.push(`${checklist.highPriorityItems} 个高风险项待处理`);
      }
      if (progress.completionRate < 50 && progress.total > 0) {
        issues.push(`迁移进度仅 ${Math.round(progress.completionRate)}%`);
      }
      if (!latestScan) {
        issues.push("尚未运行扫描");
      }
      if (!latestVerification) {
        issues.push("尚未运行验收测试");
      }

      let migrationStatus: ShopMigrationStatus["migrationStatus"] = "not_started";
      if (progress.completed === progress.total && progress.total > 0) {
        migrationStatus = "completed";
      } else if (progress.inProgress > 0 || progress.completed > 0) {
        migrationStatus = "in_progress";
      }

      shopStatuses.push({
        shopId,
        shopDomain,
        migrationStatus,
        totalItems: checklist.totalItems,
        completedItems: progress.completed,
        highPriorityItems: checklist.highPriorityItems,
        estimatedTimeMinutes: checklist.estimatedTotalTime,
        lastScanAt: latestScan?.createdAt || null,
        lastVerificationAt: latestVerification?.createdAt || null,
        issues,
      });
    } catch (error) {
      logger.error(`Failed to get migration status for shop ${shopId}`, { error });
      shopStatuses.push({
        shopId,
        shopDomain,
        migrationStatus: "failed",
        totalItems: 0,
        completedItems: 0,
        highPriorityItems: 0,
        estimatedTimeMinutes: 0,
        lastScanAt: null,
        lastVerificationAt: null,
        issues: ["获取状态失败"],
      });
    }
  }

  const completedShops = shopStatuses.filter((s) => s.migrationStatus === "completed").length;
  const inProgressShops = shopStatuses.filter((s) => s.migrationStatus === "in_progress").length;
  const notStartedShops = shopStatuses.filter((s) => s.migrationStatus === "not_started").length;

  const summary = {
    totalShops: shopStatuses.length,
    completedShops,
    inProgressShops,
    notStartedShops,
    totalEstimatedTime: shopStatuses.reduce((sum, s) => sum + s.estimatedTimeMinutes, 0),
    totalHighPriorityItems: shopStatuses.reduce((sum, s) => sum + s.highPriorityItems, 0),
  };

  return {
    workspaceId: groupId,
    workspaceName: group.name,
    generatedAt: new Date(),
    shops: shopStatuses,
    summary,
  };
}

export async function exportWorkspaceReportAsPdf(
  groupId: string,
  ownerId: string,
  options?: {
    includeDetails?: boolean;
    whiteLabel?: {
      companyName?: string;
      logoUrl?: string;
    };
  }
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  const report = await generateWorkspaceMigrationReport(groupId, ownerId);
  if (!report) {
    return null;
  }

  try {
    const html = generateReportHtml(report, options);
    const pdfResult = await htmlToPdf(html, {
      format: "A4",
      margin: { top: "20", right: "20", bottom: "20", left: "20" },
    });

    if (!pdfResult) {
      return null;
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `migration-report-${report.workspaceName.replace(/\s+/g, "_")}-${timestamp}.pdf`;

    return {
      buffer: Buffer.from(pdfResult.buffer as unknown as ArrayBuffer),
      filename,
      contentType: "application/pdf",
    };
  } catch (error) {
    logger.error("Failed to generate workspace PDF report", { error, groupId });
    return null;
  }
}

function generateReportHtml(
  report: WorkspaceMigrationReport,
  options?: {
    includeDetails?: boolean;
    whiteLabel?: {
      companyName?: string;
      logoUrl?: string;
    };
  }
): string {
  const companyName = options?.whiteLabel?.companyName || "Tracking Guardian";
  const includeDetails = options?.includeDetails ?? true;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>迁移验收报告 - ${report.workspaceName}</title>
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
    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #202223;
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
    }
    th, td {
      padding: 12px;
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
      font-size: 12px;
      font-weight: 500;
    }
    .status-completed { background: #d4edda; color: #155724; }
    .status-in_progress { background: #fff3cd; color: #856404; }
    .status-not_started { background: #f8d7da; color: #721c24; }
    .status-failed { background: #f5c6cb; color: #721c24; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e1e3e5;
      text-align: center;
      color: #6d7175;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>迁移验收报告 - ${report.workspaceName}</h1>
    <p>生成时间: ${report.generatedAt.toLocaleString("zh-CN")}</p>
    <p>报告机构: ${companyName}</p>
  </div>

  <div class="summary">
    <div class="summary-card">
      <h3>总店铺数</h3>
      <div class="value">${report.summary.totalShops}</div>
    </div>
    <div class="summary-card">
      <h3>已完成</h3>
      <div class="value">${report.summary.completedShops}</div>
    </div>
    <div class="summary-card">
      <h3>进行中</h3>
      <div class="value">${report.summary.inProgressShops}</div>
    </div>
    <div class="summary-card">
      <h3>未开始</h3>
      <div class="value">${report.summary.notStartedShops}</div>
    </div>
    <div class="summary-card">
      <h3>预计总时间</h3>
      <div class="value">${Math.ceil(report.summary.totalEstimatedTime / 60)} 小时</div>
    </div>
    <div class="summary-card">
      <h3>高风险项</h3>
      <div class="value">${report.summary.totalHighPriorityItems}</div>
    </div>
  </div>

  <h2>店铺迁移状态详情</h2>
  <table>
    <thead>
      <tr>
        <th>店铺域名</th>
        <th>状态</th>
        <th>进度</th>
        <th>高风险项</th>
        <th>预计时间</th>
        <th>最后扫描</th>
        <th>最后验收</th>
        ${includeDetails ? "<th>问题</th>" : ""}
      </tr>
    </thead>
    <tbody>
      ${report.shops.map((shop) => {
        const progressPercent = shop.totalItems > 0
          ? Math.round((shop.completedItems / shop.totalItems) * 100)
          : 0;
        const statusClass = `status-${shop.migrationStatus}`;
        const statusLabels: Record<string, string> = {
          completed: "已完成",
          in_progress: "进行中",
          not_started: "未开始",
          failed: "失败",
        };

        return `
        <tr>
          <td>${shop.shopDomain}</td>
          <td><span class="status-badge ${statusClass}">${statusLabels[shop.migrationStatus]}</span></td>
          <td>${shop.completedItems}/${shop.totalItems} (${progressPercent}%)</td>
          <td>${shop.highPriorityItems}</td>
          <td>${Math.ceil(shop.estimatedTimeMinutes / 60)} 小时</td>
          <td>${shop.lastScanAt ? shop.lastScanAt.toLocaleString("zh-CN") : "从未"}</td>
          <td>${shop.lastVerificationAt ? shop.lastVerificationAt.toLocaleString("zh-CN") : "从未"}</td>
          ${includeDetails ? `<td>${shop.issues.join("; ") || "无"}</td>` : ""}
        </tr>
        `;
      }).join("")}
    </tbody>
  </table>

  <div class="footer">
    <p>本报告由 ${companyName} 自动生成</p>
    <p>报告时间: ${report.generatedAt.toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>
  `.trim();
}

