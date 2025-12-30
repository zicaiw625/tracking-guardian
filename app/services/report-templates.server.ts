
import { logger } from "../utils/logger.server";
import type { BatchReportData } from "./workspace/batch-report.server";

/**
 * 报告模板类型
 */
export type ReportTemplateType = "executive" | "technical" | "comprehensive" | "custom";

/**
 * 报告模板配置
 */
export interface ReportTemplate {
  id: string;
  name: string;
  type: ReportTemplateType;
  description: string;
  sections: string[]; // 包含的报告部分
  includeCharts: boolean;
  includeDetails: boolean;
  whiteLabel?: {
    companyName?: string;
    logoUrl?: string;
    contactEmail?: string;
    contactPhone?: string;
  };
}

/**
 * 预定义报告模板
 */
export const REPORT_TEMPLATES: Record<string, ReportTemplate> = {
  executive: {
    id: "executive",
    name: "执行摘要报告",
    type: "executive",
    description: "面向管理层的简洁报告，突出关键指标和总体进度",
    sections: ["summary", "status_overview", "key_metrics"],
    includeCharts: true,
    includeDetails: false,
  },
  technical: {
    id: "technical",
    name: "技术详细报告",
    type: "technical",
    description: "面向技术团队的详细报告，包含所有技术细节和配置信息",
    sections: ["summary", "status_overview", "shop_details", "audit_details", "verification_details", "migration_details"],
    includeCharts: false,
    includeDetails: true,
  },
  comprehensive: {
    id: "comprehensive",
    name: "综合完整报告",
    type: "comprehensive",
    description: "包含所有信息的完整报告，适合存档和全面审查",
    sections: ["summary", "status_overview", "shop_details", "audit_details", "verification_details", "migration_details", "recommendations"],
    includeCharts: true,
    includeDetails: true,
  },
};

/**
 * 根据模板生成报告 HTML
 */
export function generateReportFromTemplate(
  reportData: BatchReportData,
  template: ReportTemplate
): string {
  const companyName = template.whiteLabel?.companyName || reportData.whiteLabel?.companyName || "Tracking Guardian";
  const logoUrl = template.whiteLabel?.logoUrl || reportData.whiteLabel?.logoUrl;
  const includeDetails = template.includeDetails;

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${template.name} - ${reportData.groupName}</title>
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
    .key-metrics {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-top: 20px;
    }
    .metric-card {
      background: #ffffff;
      border: 1px solid #e1e3e5;
      padding: 15px;
      border-radius: 8px;
    }
    .metric-label {
      font-size: 12px;
      color: #6d7175;
      margin-bottom: 5px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #202223;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-content">
      <div>
        <h1>${template.name}</h1>
        <p>分组: ${reportData.groupName}</p>
        <p>生成时间: ${reportData.generatedAt.toLocaleString("zh-CN")}</p>
      </div>
      ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" class="logo">` : ""}
    </div>
  </div>
  `;

  // 摘要部分
  if (template.sections.includes("summary")) {
    html += `
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
    `;
  }

  // 关键指标部分（执行摘要模板）
  if (template.sections.includes("key_metrics") && template.type === "executive") {
    html += `
  <div class="section">
    <h2>关键指标</h2>
    <div class="key-metrics">
      <div class="metric-card">
        <div class="metric-label">完成率</div>
        <div class="metric-value">
          ${reportData.summary.totalShops > 0
            ? Math.round((reportData.summary.completedShops / reportData.summary.totalShops) * 100)
            : 0}%
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">预计总时间</div>
        <div class="metric-value">${Math.ceil(reportData.summary.totalEstimatedTime / 60)} 小时</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">平均风险分数</div>
        <div class="metric-value">${reportData.summary.avgRiskScore.toFixed(1)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">高风险项</div>
        <div class="metric-value">${reportData.summary.totalHighPriorityItems}</div>
      </div>
    </div>
  </div>
    `;
  }

  // 状态概览部分
  if (template.sections.includes("status_overview")) {
    html += `
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
    `;
  }

  // 店铺详情部分
  if (template.sections.includes("shop_details") && includeDetails) {
    html += `
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
    `;
  }

  // 建议部分
  if (template.sections.includes("recommendations")) {
    const recommendations: string[] = [];
    
    if (reportData.summary.totalHighPriorityItems > 0) {
      recommendations.push(`发现 ${reportData.summary.totalHighPriorityItems} 个高风险项，建议优先处理`);
    }
    
    if (reportData.summary.notStartedShops > 0) {
      recommendations.push(`${reportData.summary.notStartedShops} 个店铺尚未开始迁移，建议尽快启动`);
    }
    
    if (reportData.summary.avgRiskScore > 60) {
      recommendations.push(`平均风险分数较高（${reportData.summary.avgRiskScore.toFixed(1)}），建议加强监控和迁移进度`);
    }

    if (recommendations.length > 0) {
      html += `
  <div class="section">
    <h2>建议与行动项</h2>
    <ul>
      ${recommendations.map((rec) => `<li>${rec}</li>`).join("")}
    </ul>
  </div>
      `;
    }
  }

  html += `
  <div class="footer">
    <p>本报告由 ${companyName} 自动生成</p>
    ${template.whiteLabel?.contactEmail || reportData.whiteLabel?.contactEmail 
      ? `<p>联系方式: ${template.whiteLabel?.contactEmail || reportData.whiteLabel?.contactEmail}</p>` 
      : ""}
    <p>报告时间: ${reportData.generatedAt.toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>
  `;

  return html.trim();
}

/**
 * 获取可用的报告模板列表
 */
export function getAvailableTemplates(): ReportTemplate[] {
  return Object.values(REPORT_TEMPLATES);
}

/**
 * 根据 ID 获取报告模板
 */
export function getTemplateById(templateId: string): ReportTemplate | null {
  return REPORT_TEMPLATES[templateId] || null;
}

/**
 * 创建自定义报告模板
 */
export function createCustomTemplate(
  name: string,
  options: {
    sections?: string[];
    includeCharts?: boolean;
    includeDetails?: boolean;
    whiteLabel?: ReportTemplate["whiteLabel"];
  }
): ReportTemplate {
  return {
    id: `custom-${Date.now()}`,
    name,
    type: "custom",
    description: "自定义报告模板",
    sections: options.sections || ["summary", "status_overview"],
    includeCharts: options.includeCharts ?? false,
    includeDetails: options.includeDetails ?? true,
    whiteLabel: options.whiteLabel,
  };
}

