import prisma from "../db.server";
import type { ScriptTag, RiskItem } from "../types";
import { PLATFORM_INFO } from "./scanner/patterns";
import { logger } from "../utils/logger.server";

export interface ReportData {
  shopDomain: string;
  generatedAt: string;
  reportType: "scan" | "migration" | "reconciliation" | "audit";
}

export interface ScanReportData extends ReportData {
  reportType: "scan";
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  identifiedPlatforms: string[];
  scriptTags: ScriptTag[];
  riskItems: RiskItem[];
  migrationDeadlines: {
    plusDate: string;
    nonPlusDate: string;
    daysUntilPlus: number;
    daysUntilNonPlus: number;
  };
  recommendations: string[];
}

export interface MigrationReportData extends ReportData {
  reportType: "migration";
  migrationActions: Array<{
    title: string;
    platform?: string;
    priority: "high" | "medium" | "low";
    status: "pending" | "in_progress" | "completed";
    description: string;
  }>;
  completedCount: number;
  totalCount: number;
}

export interface ReconciliationReportData extends ReportData {
  reportType: "reconciliation";
  period: { startDate: string; endDate: string };
  platforms: Array<{
    name: string;
    webhookOrders: number;
    sentToPlatform: number;
    gap: number;
    gapPercentage: number;
  }>;
  overallMatchRate: number;
  gapAnalysis: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
}

const CSS_STYLES = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
    padding: 40px;
    max-width: 900px;
    margin: 0 auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #5c6ac4;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .logo { font-size: 24px; font-weight: bold; color: #5c6ac4; }
  .meta { text-align: right; color: #666; font-size: 14px; }
  h1 { font-size: 28px; margin-bottom: 20px; color: #1a1a1a; }
  h2 { font-size: 20px; margin: 30px 0 15px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
  h3 { font-size: 16px; margin: 20px 0 10px; color: #444; }
  .score-box {
    display: inline-block;
    padding: 20px 40px;
    border-radius: 12px;
    text-align: center;
    margin: 20px 0;
  }
  .score-high { background: #fce4e4; color: #c0392b; }
  .score-medium { background: #fef5e7; color: #d68910; }
  .score-low { background: #e8f8f5; color: #1e8449; }
  .score-value { font-size: 48px; font-weight: bold; }
  .score-label { font-size: 14px; margin-top: 5px; }
  .badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
  }
  .badge-high { background: #fce4e4; color: #c0392b; }
  .badge-medium { background: #fef5e7; color: #d68910; }
  .badge-low { background: #e8f8f5; color: #1e8449; }
  .badge-info { background: #ebf5fb; color: #2e86c1; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 15px 0;
    font-size: 14px;
  }
  th, td {
    padding: 12px;
    text-align: left;
    border-bottom: 1px solid #eee;
  }
  th { background: #f8f9fa; font-weight: 600; color: #333; }
  tr:hover { background: #fafafa; }
  .risk-item {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 15px;
    margin: 10px 0;
  }
  .risk-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .risk-item-title { font-weight: 600; }
  .risk-item-desc { color: #666; font-size: 14px; }
  .checklist { list-style: none; padding: 0; }
  .checklist li {
    padding: 10px 0 10px 35px;
    position: relative;
    border-bottom: 1px solid #f0f0f0;
  }
  .checklist li:before {
    content: "☐";
    position: absolute;
    left: 5px;
    color: #999;
  }
  .checklist li.completed:before {
    content: "✓";
    color: #1e8449;
  }
  .recommendation {
    background: #f8f9fa;
    border-left: 4px solid #5c6ac4;
    padding: 15px;
    margin: 10px 0;
  }
  .deadline-warning {
    background: #fff3e0;
    border: 1px solid #ffb74d;
    border-radius: 8px;
    padding: 15px;
    margin: 20px 0;
  }
  .footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    color: #666;
    font-size: 12px;
    text-align: center;
  }
  @media print {
    body { padding: 20px; }
    .no-print { display: none; }
    .page-break { page-break-before: always; }
  }
</style>
`;

export function generateScanReportHtml(data: ScanReportData): string {
  const scoreClass = data.riskScore > 60 ? "high" : data.riskScore > 30 ? "medium" : "low";
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>追踪脚本扫描报告 - ${data.shopDomain}</title>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">🛡️ Tracking Guardian</div>
    <div class="meta">
      <div>店铺: ${data.shopDomain}</div>
      <div>生成时间: ${data.generatedAt}</div>
    </div>
  </div>
  <h1>追踪脚本扫描报告</h1>
  <div class="score-box score-${scoreClass}">
    <div class="score-value">${data.riskScore}</div>
    <div class="score-label">风险评分 / 100</div>
  </div>
  <div class="deadline-warning">
    <strong>⚠️ 迁移截止提醒</strong>
    <p>Shopify Plus 商家: ${data.migrationDeadlines.plusDate} (剩余 ${data.migrationDeadlines.daysUntilPlus} 天)</p>
    <p>非 Plus 商家: ${data.migrationDeadlines.nonPlusDate} (剩余 ${data.migrationDeadlines.daysUntilNonPlus} 天)</p>
  </div>
  <h2>📊 检测概览</h2>
  <table>
    <tr>
      <th>检测项</th>
      <th>数量</th>
      <th>状态</th>
    </tr>
    <tr>
      <td>ScriptTags</td>
      <td>${data.scriptTags.length}</td>
      <td>${data.scriptTags.length > 0 ? '<span class="badge badge-high">需迁移</span>' : '<span class="badge badge-low">无风险</span>'}</td>
    </tr>
    <tr>
      <td>检测到的平台</td>
      <td>${data.identifiedPlatforms.length}</td>
      <td><span class="badge badge-info">${data.identifiedPlatforms.join(", ") || "无"}</span></td>
    </tr>
    <tr>
      <td>风险项</td>
      <td>${data.riskItems.length}</td>
      <td>${data.riskItems.length > 0 ? '<span class="badge badge-medium">需关注</span>' : '<span class="badge badge-low">良好</span>'}</td>
    </tr>
  </table>
  ${data.identifiedPlatforms.length > 0 ? `
  <h2>🎯 检测到的追踪平台</h2>
  <table>
    <tr>
      <th>平台</th>
      <th>支持状态</th>
      <th>建议</th>
    </tr>
    ${data.identifiedPlatforms.map(platform => {
      const info = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
      return `
        <tr>
          <td>${info.name}</td>
          <td><span class="badge badge-${info.supportLevel === 'supported' ? 'low' : info.supportLevel === 'partial' ? 'medium' : 'info'}">${
            info.supportLevel === 'supported' ? '完全支持' :
            info.supportLevel === 'partial' ? '部分支持' : '需替代方案'
          }</span></td>
          <td>${info.recommendation}</td>
        </tr>
      `;
    }).join('')}
  </table>
  ` : ''}
  ${data.riskItems.length > 0 ? `
  <h2>⚠️ 风险详情</h2>
  ${data.riskItems.map(item => `
    <div class="risk-item">
      <div class="risk-item-header">
        <span class="risk-item-title">${item.name}</span>
        <span class="badge badge-${item.severity}">${item.severity === 'high' ? '高风险' : item.severity === 'medium' ? '中风险' : '低风险'}</span>
      </div>
      <div class="risk-item-desc">${item.description}</div>
      ${item.details ? `<div class="risk-item-desc" style="margin-top: 8px; font-size: 12px;">${item.details}</div>` : ''}
    </div>
  `).join('')}
  ` : ''}
  <h2>📋 迁移建议</h2>
  ${data.recommendations.map(rec => `
    <div class="recommendation">${rec}</div>
  `).join('')}
  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>如需帮助，请联系技术支持</p>
  </div>
</body>
</html>
`;
}

export function generateMigrationReportHtml(data: MigrationReportData): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>迁移清单报告 - ${data.shopDomain}</title>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">🛡️ Tracking Guardian</div>
    <div class="meta">
      <div>店铺: ${data.shopDomain}</div>
      <div>生成时间: ${data.generatedAt}</div>
    </div>
  </div>
  <h1>迁移清单报告</h1>
  <div class="score-box score-${data.completedCount === data.totalCount ? 'low' : 'medium'}">
    <div class="score-value">${data.completedCount}/${data.totalCount}</div>
    <div class="score-label">已完成 / 总计</div>
  </div>
  <h2>📋 迁移任务清单</h2>
  <ul class="checklist">
    ${data.migrationActions.map(action => `
      <li class="${action.status === 'completed' ? 'completed' : ''}">
        <strong>${action.title}</strong>
        ${action.platform ? `<span class="badge badge-info">${action.platform}</span>` : ''}
        <span class="badge badge-${action.priority}">${
          action.priority === 'high' ? '高优先级' :
          action.priority === 'medium' ? '中优先级' : '低优先级'
        }</span>
        <div style="color: #666; font-size: 14px; margin-top: 5px;">${action.description}</div>
      </li>
    `).join('')}
  </ul>
  <h2>📝 通用迁移步骤</h2>
  <ol style="padding-left: 20px;">
    <li>登录 Tracking Guardian 应用</li>
    <li>前往「迁移」页面，点击「启用 App Pixel」</li>
    <li>在「设置」页面配置各平台 CAPI 凭证</li>
    <li>完成测试订单，验证追踪正常</li>
    <li>手动删除旧的 ScriptTag（参考扫描页面指南）</li>
  </ol>
  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>如需帮助，请联系技术支持</p>
  </div>
</body>
</html>
`;
}

export function generateReconciliationReportHtml(data: ReconciliationReportData): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>对账报告 - ${data.shopDomain}</title>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">🛡️ Tracking Guardian</div>
    <div class="meta">
      <div>店铺: ${data.shopDomain}</div>
      <div>生成时间: ${data.generatedAt}</div>
    </div>
  </div>
  <h1>送达对账报告</h1>
  <p style="color: #666;">统计周期: ${data.period.startDate} 至 ${data.period.endDate}</p>
  <div class="score-box score-${data.overallMatchRate >= 95 ? 'low' : data.overallMatchRate >= 80 ? 'medium' : 'high'}">
    <div class="score-value">${data.overallMatchRate.toFixed(1)}%</div>
    <div class="score-label">总体送达匹配率</div>
  </div>
  <h2>📊 平台送达详情</h2>
  <table>
    <tr>
      <th>平台</th>
      <th>Webhook 订单</th>
      <th>成功发送</th>
      <th>缺口</th>
      <th>缺口率</th>
    </tr>
    ${data.platforms.map(platform => `
      <tr>
        <td>${platform.name}</td>
        <td>${platform.webhookOrders}</td>
        <td>${platform.sentToPlatform}</td>
        <td>${platform.gap}</td>
        <td><span class="badge badge-${platform.gapPercentage <= 5 ? 'low' : platform.gapPercentage <= 15 ? 'medium' : 'high'}">${platform.gapPercentage.toFixed(1)}%</span></td>
      </tr>
    `).join('')}
  </table>
  ${data.gapAnalysis.length > 0 ? `
  <h2>📉 缺口原因分析</h2>
  <table>
    <tr>
      <th>原因</th>
      <th>数量</th>
      <th>占比</th>
    </tr>
    ${data.gapAnalysis.map(gap => `
      <tr>
        <td>${gap.reason}</td>
        <td>${gap.count}</td>
        <td>${gap.percentage.toFixed(1)}%</td>
      </tr>
    `).join('')}
  </table>
  ` : ''}
  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>如需帮助，请联系技术支持</p>
  </div>
</body>
</html>
`;
}

export async function fetchScanReportData(shopId: string): Promise<ScanReportData | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });
  if (!shop) return null;
  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
  if (!latestScan) return null;
  const now = new Date();
  const plusDeadline = new Date("2025-08-28");
  const nonPlusDeadline = new Date("2026-08-26");
  const scriptTags = (latestScan.scriptTags as ScriptTag[] | null) || [];
  const identifiedPlatforms = (latestScan.identifiedPlatforms as string[]) || [];
  const riskItems = (latestScan.riskItems as RiskItem[] | null) || [];
  const riskScore = latestScan.riskScore || 0;

  const recommendations: string[] = [];
  if (scriptTags.length > 0) {
    recommendations.push(`检测到 ${scriptTags.length} 个 ScriptTag，建议迁移到 Web Pixel`);
  }
  identifiedPlatforms.forEach(platform => {
    const info = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
    if (info.supportLevel === "supported") {
      recommendations.push(`${info.name}: 可通过 Tracking Guardian 配置服务端追踪`);
    } else if (info.officialApp) {
      recommendations.push(`${info.name}: 建议使用官方应用`);
    }
  });
  if (riskScore > 60) {
    recommendations.push("⚠️ 高风险：强烈建议立即开始迁移");
  } else if (riskScore > 30) {
    recommendations.push("⚡ 中风险：建议尽快规划迁移");
  } else {
    recommendations.push("✅ 低风险：追踪配置状态良好");
  }
  return {
    shopDomain: shop.shopDomain,
    generatedAt: now.toISOString(),
    reportType: "scan",
    riskScore,
    riskLevel: riskScore > 60 ? "high" : riskScore > 30 ? "medium" : "low",
    identifiedPlatforms,
    scriptTags,
    riskItems,
    migrationDeadlines: {
      plusDate: "2025-08-28",
      nonPlusDate: "2026-08-26",
      daysUntilPlus: Math.max(0, Math.ceil((plusDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
      daysUntilNonPlus: Math.max(0, Math.ceil((nonPlusDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
    },
    recommendations,
  };
}

export async function fetchReconciliationReportData(
  shopId: string,
  days: number = 7
): Promise<ReconciliationReportData | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true },
  });
  if (!shop) return null;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const reports = await prisma.reconciliationReport.findMany({
    where: {
      shopId,
      reportDate: { gte: startDate, lte: endDate },
    },
    orderBy: { reportDate: "desc" },
  });
  if (reports.length === 0) return null;

  const platformStats = new Map<string, {
    webhookOrders: number;
    sentToPlatform: number;
    gap: number;
  }>();
  reports.forEach(report => {
    const existing = platformStats.get(report.platform) || {
      webhookOrders: 0,
      sentToPlatform: 0,
      gap: 0,
    };
    existing.webhookOrders += report.shopifyOrders;
    existing.sentToPlatform += report.platformConversions;
    existing.gap += report.shopifyOrders - report.platformConversions;
    platformStats.set(report.platform, existing);
  });
  const platforms = Array.from(platformStats.entries()).map(([name, stats]) => ({
    name,
    webhookOrders: stats.webhookOrders,
    sentToPlatform: stats.sentToPlatform,
    gap: Math.max(0, stats.gap),
    gapPercentage: stats.webhookOrders > 0
      ? ((stats.gap / stats.webhookOrders) * 100)
      : 0,
  }));
  const totalWebhook = platforms.reduce((sum, p) => sum + p.webhookOrders, 0);
  const totalSent = platforms.reduce((sum, p) => sum + p.sentToPlatform, 0);
  const overallMatchRate = totalWebhook > 0 ? (totalSent / totalWebhook) * 100 : 100;
  return {
    shopDomain: shop.shopDomain,
    generatedAt: new Date().toISOString(),
    reportType: "reconciliation",
    period: {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    },
    platforms,
    overallMatchRate,
    gapAnalysis: [],
  };
}
