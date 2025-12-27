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

// ============================================================
// 验收报告 (Verification Report)
// 对应设计方案 4.5 Verification：事件对账与验收
// ============================================================

export interface VerificationReportData extends ReportData {
  reportType: "audit";
  shopPlan: string;
  runType: "quick" | "full";
  status: "completed" | "failed" | "partial";
  scores: {
    passRate: number;
    parameterCompleteness: number;
    valueAccuracy: number;
  };
  platforms: Array<{
    name: string;
    configured: boolean;
    eventsSent: number;
    eventsFailed: number;
    status: "success" | "partial" | "failed" | "not_configured";
  }>;
  events: Array<{
    eventType: string;
    platform: string;
    orderId?: string;
    status: "success" | "failed" | "missing_params";
    value?: number;
    currency?: string;
    errors?: string[];
  }>;
  recommendations: string[];
}

export function generateVerificationReportHtml(data: VerificationReportData): string {
  const overallStatus = data.scores.passRate >= 80 ? "success" : 
                       data.scores.passRate >= 50 ? "partial" : "failed";
  const statusClass = overallStatus === "success" ? "low" : 
                     overallStatus === "partial" ? "medium" : "high";
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>验收报告 - ${data.shopDomain}</title>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">🛡️ Tracking Guardian</div>
    <div class="meta">
      <div>店铺: ${data.shopDomain}</div>
      <div>套餐: ${data.shopPlan}</div>
      <div>生成时间: ${data.generatedAt}</div>
    </div>
  </div>

  <h1>迁移验收报告</h1>
  
  <div style="display: flex; gap: 20px; margin: 20px 0;">
    <div class="score-box score-${statusClass}" style="flex: 1;">
      <div class="score-value">${data.scores.passRate}%</div>
      <div class="score-label">通过率</div>
    </div>
    <div class="score-box score-${data.scores.parameterCompleteness >= 80 ? 'low' : 'medium'}" style="flex: 1;">
      <div class="score-value">${data.scores.parameterCompleteness}%</div>
      <div class="score-label">参数完整率</div>
    </div>
    <div class="score-box score-${data.scores.valueAccuracy >= 95 ? 'low' : 'medium'}" style="flex: 1;">
      <div class="score-value">${data.scores.valueAccuracy}%</div>
      <div class="score-label">金额准确率</div>
    </div>
  </div>

  <div class="${overallStatus === 'success' ? 'recommendation' : 'deadline-warning'}">
    <strong>${overallStatus === 'success' ? '✅ 验收通过' : overallStatus === 'partial' ? '⚠️ 部分通过' : '❌ 验收失败'}</strong>
    <p>${overallStatus === 'success' ? '您的追踪配置工作正常！建议定期运行验收以确保持续稳定。' :
        overallStatus === 'partial' ? '部分测试未通过，请检查下方详情并修复问题。' :
        '多项测试失败，请仔细检查配置并重新验收。'}</p>
  </div>

  <h2>📊 平台配置状态</h2>
  <table>
    <tr>
      <th>平台</th>
      <th>配置状态</th>
      <th>成功发送</th>
      <th>失败</th>
      <th>综合状态</th>
    </tr>
    ${data.platforms.map(platform => `
      <tr>
        <td>${platform.name}</td>
        <td>${platform.configured ? '<span class="badge badge-low">✓ 已配置</span>' : '<span class="badge badge-medium">未配置</span>'}</td>
        <td>${platform.eventsSent}</td>
        <td>${platform.eventsFailed}</td>
        <td><span class="badge badge-${platform.status === 'success' ? 'low' : platform.status === 'partial' ? 'medium' : 'high'}">${
          platform.status === 'success' ? '正常' :
          platform.status === 'partial' ? '部分正常' :
          platform.status === 'not_configured' ? '未配置' : '异常'
        }</span></td>
      </tr>
    `).join('')}
  </table>

  ${data.events.length > 0 ? `
  <h2 class="page-break">📝 事件详细记录</h2>
  <table>
    <tr>
      <th>事件类型</th>
      <th>平台</th>
      <th>订单 ID</th>
      <th>金额</th>
      <th>状态</th>
      <th>问题</th>
    </tr>
    ${data.events.slice(0, 20).map(event => `
      <tr>
        <td>${event.eventType}</td>
        <td>${event.platform}</td>
        <td>${event.orderId ? event.orderId.slice(-8) : '-'}</td>
        <td>${event.value !== undefined ? `${event.currency || 'USD'} ${event.value.toFixed(2)}` : '-'}</td>
        <td><span class="badge badge-${event.status === 'success' ? 'low' : event.status === 'missing_params' ? 'medium' : 'high'}">${
          event.status === 'success' ? '成功' :
          event.status === 'missing_params' ? '参数缺失' : '失败'
        }</span></td>
        <td style="font-size: 12px; color: #666;">${event.errors?.join('; ') || '-'}</td>
      </tr>
    `).join('')}
    ${data.events.length > 20 ? `
      <tr>
        <td colspan="6" style="text-align: center; color: #666;">
          ... 还有 ${data.events.length - 20} 条记录未显示
        </td>
      </tr>
    ` : ''}
  </table>
  ` : `
  <h2>📝 事件记录</h2>
  <p style="color: #666;">暂无事件记录。请先完成测试订单后再运行验收。</p>
  `}

  ${data.recommendations.length > 0 ? `
  <h2>💡 建议</h2>
  ${data.recommendations.map(rec => `
    <div class="recommendation">${rec}</div>
  `).join('')}
  ` : ''}

  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>验收类型: ${data.runType === 'full' ? '完整验收' : '快速验收'}</p>
    <p>如需帮助，请联系技术支持</p>
  </div>
</body>
</html>
`;
}

/**
 * 获取验收报告数据
 */
export async function fetchVerificationReportData(
  shopId: string,
  runId?: string
): Promise<VerificationReportData | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { 
      shopDomain: true, 
      plan: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true, serverSideEnabled: true },
      },
    },
  });
  if (!shop) return null;

  // 获取最近的验收运行
  const verificationRun = runId
    ? await prisma.verificationRun.findUnique({ where: { id: runId } })
    : await prisma.verificationRun.findFirst({
        where: { shopId },
        orderBy: { createdAt: "desc" },
      });

  if (!verificationRun) return null;

  const summaryJson = verificationRun.summaryJson as {
    totalEvents?: number;
    successfulEvents?: number;
    failedEvents?: number;
    missingParamsEvents?: number;
    platformResults?: Record<string, { sent: number; failed: number }>;
  } | null;

  const eventsJson = verificationRun.eventsJson as Array<{
    eventType: string;
    platform: string;
    orderId?: string;
    status: "success" | "failed" | "missing_params";
    params?: { value?: number; currency?: string };
    errors?: string[];
    discrepancies?: string[];
  }> | null;

  const totalEvents = summaryJson?.totalEvents || 0;
  const successfulEvents = summaryJson?.successfulEvents || 0;
  const failedEvents = summaryJson?.failedEvents || 0;
  const missingParamsEvents = summaryJson?.missingParamsEvents || 0;

  const passRate = totalEvents > 0 
    ? Math.round((successfulEvents / totalEvents) * 100) 
    : 0;

  // 计算参数完整率
  const parameterCompleteness = totalEvents > 0
    ? Math.round(((totalEvents - missingParamsEvents) / totalEvents) * 100)
    : 100;

  // 计算金额准确率 (基于事件数据)
  const eventsWithValue = eventsJson?.filter(e => e.params?.value !== undefined) || [];
  const valueAccuracy = eventsWithValue.length > 0
    ? Math.round((eventsWithValue.filter(e => e.status === 'success').length / eventsWithValue.length) * 100)
    : 100;

  // 平台状态
  const platformResults = summaryJson?.platformResults || {};
  const configuredPlatforms = new Set(shop.pixelConfigs.map(c => c.platform));
  
  const platforms = ['google', 'meta', 'tiktok', 'pinterest'].map(platform => {
    const results = platformResults[platform] || { sent: 0, failed: 0 };
    const configured = configuredPlatforms.has(platform);
    const total = results.sent + results.failed;
    
    let status: 'success' | 'partial' | 'failed' | 'not_configured' = 'not_configured';
    if (!configured) {
      status = 'not_configured';
    } else if (total === 0) {
      status = 'not_configured';
    } else if (results.failed === 0) {
      status = 'success';
    } else if (results.sent > results.failed) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    const nameMap: Record<string, string> = {
      google: 'GA4',
      meta: 'Meta (Facebook)',
      tiktok: 'TikTok',
      pinterest: 'Pinterest',
    };

    return {
      name: nameMap[platform] || platform,
      configured,
      eventsSent: results.sent,
      eventsFailed: results.failed,
      status,
    };
  });

  // 事件详情
  const events = (eventsJson || []).map(e => ({
    eventType: e.eventType,
    platform: e.platform,
    orderId: e.orderId,
    status: e.status,
    value: e.params?.value,
    currency: e.params?.currency,
    errors: [...(e.errors || []), ...(e.discrepancies || [])],
  }));

  // 生成建议
  const recommendations: string[] = [];
  
  if (failedEvents > 0) {
    recommendations.push('存在失败的事件发送，请检查平台凭证是否正确配置');
  }
  if (missingParamsEvents > 0) {
    recommendations.push(`${missingParamsEvents} 个事件缺少必要参数，可能影响归因效果`);
  }
  if (!configuredPlatforms.has('google')) {
    recommendations.push('建议配置 GA4 服务端追踪以获得更完整的归因数据');
  }
  if (!configuredPlatforms.has('meta')) {
    recommendations.push('建议配置 Meta CAPI 以提升 Facebook/Instagram 广告归因');
  }
  if (passRate >= 80) {
    recommendations.push('✅ 验收通过！建议每周运行一次验收以确保持续稳定');
  }

  return {
    shopDomain: shop.shopDomain,
    generatedAt: new Date().toISOString(),
    reportType: "audit",
    shopPlan: shop.plan,
    runType: (verificationRun.runType as "quick" | "full") || "quick",
    status: passRate >= 80 ? "completed" : passRate >= 50 ? "partial" : "failed",
    scores: {
      passRate,
      parameterCompleteness,
      valueAccuracy,
    },
    platforms,
    events,
    recommendations,
  };
}

// ============================================================
// Agency 批量报告 (Batch Report)
// 对应设计方案 4.7 Agency：导出"迁移验收报告"
// ============================================================

export interface BatchReportData extends ReportData {
  reportType: "audit";
  groupName: string;
  period: { startDate: string; endDate: string };
  summary: {
    totalShops: number;
    scannedShops: number;
    migratedShops: number;
    verifiedShops: number;
    avgRiskScore: number;
    avgMatchRate: number;
  };
  shops: Array<{
    shopDomain: string;
    riskScore: number;
    migrationStatus: "completed" | "in_progress" | "not_started";
    verificationStatus: "passed" | "partial" | "failed" | "not_verified";
    platforms: string[];
    lastScanDate?: string;
    lastVerificationDate?: string;
  }>;
}

export function generateBatchReportHtml(data: BatchReportData): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>批量验收报告 - ${data.groupName}</title>
  ${CSS_STYLES}
</head>
<body>
  <div class="header">
    <div class="logo">🛡️ Tracking Guardian</div>
    <div class="meta">
      <div>工作区: ${data.groupName}</div>
      <div>生成时间: ${data.generatedAt}</div>
      <div>统计周期: ${data.period.startDate} 至 ${data.period.endDate}</div>
    </div>
  </div>

  <h1>多店迁移验收报告</h1>
  
  <div style="display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap;">
    <div class="score-box score-low" style="flex: 1; min-width: 150px;">
      <div class="score-value">${data.summary.totalShops}</div>
      <div class="score-label">总店铺数</div>
    </div>
    <div class="score-box score-${data.summary.scannedShops === data.summary.totalShops ? 'low' : 'medium'}" style="flex: 1; min-width: 150px;">
      <div class="score-value">${data.summary.scannedShops}</div>
      <div class="score-label">已扫描</div>
    </div>
    <div class="score-box score-${data.summary.migratedShops === data.summary.totalShops ? 'low' : 'medium'}" style="flex: 1; min-width: 150px;">
      <div class="score-value">${data.summary.migratedShops}</div>
      <div class="score-label">已迁移</div>
    </div>
    <div class="score-box score-${data.summary.verifiedShops === data.summary.totalShops ? 'low' : 'medium'}" style="flex: 1; min-width: 150px;">
      <div class="score-value">${data.summary.verifiedShops}</div>
      <div class="score-label">已验收</div>
    </div>
  </div>

  <div style="display: flex; gap: 20px; margin: 20px 0;">
    <div class="score-box score-${data.summary.avgRiskScore <= 30 ? 'low' : data.summary.avgRiskScore <= 60 ? 'medium' : 'high'}" style="flex: 1;">
      <div class="score-value">${data.summary.avgRiskScore.toFixed(1)}</div>
      <div class="score-label">平均风险分</div>
    </div>
    <div class="score-box score-${data.summary.avgMatchRate >= 95 ? 'low' : data.summary.avgMatchRate >= 80 ? 'medium' : 'high'}" style="flex: 1;">
      <div class="score-value">${data.summary.avgMatchRate.toFixed(1)}%</div>
      <div class="score-label">平均匹配率</div>
    </div>
  </div>

  <h2>📊 店铺详情</h2>
  <table>
    <tr>
      <th>店铺</th>
      <th>风险分</th>
      <th>迁移状态</th>
      <th>验收状态</th>
      <th>配置平台</th>
      <th>最后扫描</th>
    </tr>
    ${data.shops.map(shop => `
      <tr>
        <td>${shop.shopDomain}</td>
        <td><span class="badge badge-${shop.riskScore <= 30 ? 'low' : shop.riskScore <= 60 ? 'medium' : 'high'}">${shop.riskScore}</span></td>
        <td><span class="badge badge-${shop.migrationStatus === 'completed' ? 'low' : shop.migrationStatus === 'in_progress' ? 'medium' : 'high'}">${
          shop.migrationStatus === 'completed' ? '已完成' :
          shop.migrationStatus === 'in_progress' ? '进行中' : '未开始'
        }</span></td>
        <td><span class="badge badge-${shop.verificationStatus === 'passed' ? 'low' : shop.verificationStatus === 'partial' ? 'medium' : 'high'}">${
          shop.verificationStatus === 'passed' ? '通过' :
          shop.verificationStatus === 'partial' ? '部分通过' :
          shop.verificationStatus === 'failed' ? '失败' : '未验收'
        }</span></td>
        <td>${shop.platforms.join(', ') || '-'}</td>
        <td>${shop.lastScanDate || '-'}</td>
      </tr>
    `).join('')}
  </table>

  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>Agency 版专属功能</p>
  </div>
</body>
</html>
`;
}

/**
 * 获取批量报告数据
 */
// ============================================================
// CSV 导出功能
// ============================================================

/**
 * 生成验收报告 CSV
 */
export function generateVerificationReportCsv(data: VerificationReportData): string {
  const lines: string[] = [];
  
  // 头部信息
  lines.push('验收报告');
  lines.push(`店铺,${data.shopDomain}`);
  lines.push(`套餐,${data.shopPlan}`);
  lines.push(`生成时间,${data.generatedAt}`);
  lines.push(`验收类型,${data.runType === 'full' ? '完整验收' : '快速验收'}`);
  lines.push('');
  
  // 评分摘要
  lines.push('评分摘要');
  lines.push('指标,数值');
  lines.push(`通过率,${data.scores.passRate}%`);
  lines.push(`参数完整率,${data.scores.parameterCompleteness}%`);
  lines.push(`金额准确率,${data.scores.valueAccuracy}%`);
  lines.push('');
  
  // 平台状态
  lines.push('平台配置状态');
  lines.push('平台,配置状态,成功发送,失败,综合状态');
  data.platforms.forEach(platform => {
    lines.push(`${platform.name},${platform.configured ? '已配置' : '未配置'},${platform.eventsSent},${platform.eventsFailed},${
      platform.status === 'success' ? '正常' :
      platform.status === 'partial' ? '部分正常' :
      platform.status === 'not_configured' ? '未配置' : '异常'
    }`);
  });
  lines.push('');
  
  // 事件详情
  if (data.events.length > 0) {
    lines.push('事件详细记录');
    lines.push('事件类型,平台,订单ID,金额,币种,状态,问题');
    data.events.forEach(event => {
      const escapedErrors = (event.errors || []).join('; ').replace(/,/g, '；');
      lines.push(`${event.eventType},${event.platform},${event.orderId || '-'},${event.value ?? '-'},${event.currency || '-'},${
        event.status === 'success' ? '成功' :
        event.status === 'missing_params' ? '参数缺失' : '失败'
      },${escapedErrors || '-'}`);
    });
    lines.push('');
  }
  
  // 建议
  if (data.recommendations.length > 0) {
    lines.push('建议');
    data.recommendations.forEach((rec, i) => {
      lines.push(`${i + 1},${rec.replace(/,/g, '，')}`);
    });
  }
  
  return lines.join('\n');
}

/**
 * 生成扫描报告 CSV
 */
export function generateScanReportCsv(data: ScanReportData): string {
  const lines: string[] = [];
  
  // 头部信息
  lines.push('追踪脚本扫描报告');
  lines.push(`店铺,${data.shopDomain}`);
  lines.push(`生成时间,${data.generatedAt}`);
  lines.push(`风险评分,${data.riskScore}/100`);
  lines.push(`风险等级,${data.riskLevel === 'high' ? '高风险' : data.riskLevel === 'medium' ? '中风险' : '低风险'}`);
  lines.push('');
  
  // 截止日期
  lines.push('迁移截止日期');
  lines.push(`Plus 商家,${data.migrationDeadlines.plusDate},剩余 ${data.migrationDeadlines.daysUntilPlus} 天`);
  lines.push(`非 Plus 商家,${data.migrationDeadlines.nonPlusDate},剩余 ${data.migrationDeadlines.daysUntilNonPlus} 天`);
  lines.push('');
  
  // 检测到的平台
  lines.push('检测到的平台');
  lines.push(data.identifiedPlatforms.join(',') || '无');
  lines.push('');
  
  // ScriptTags
  if (data.scriptTags.length > 0) {
    lines.push('ScriptTags');
    lines.push('ID,Source,Display Scope');
    data.scriptTags.forEach(tag => {
      lines.push(`${tag.id},${tag.src},${tag.display_scope || '-'}`);
    });
    lines.push('');
  }
  
  // 风险项
  if (data.riskItems.length > 0) {
    lines.push('风险详情');
    lines.push('名称,严重程度,描述,详情');
    data.riskItems.forEach(item => {
      lines.push(`${item.name},${item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '低'},${item.description.replace(/,/g, '，')},${(item.details || '').replace(/,/g, '，')}`);
    });
    lines.push('');
  }
  
  // 建议
  lines.push('迁移建议');
  data.recommendations.forEach((rec, i) => {
    lines.push(`${i + 1},${rec.replace(/,/g, '，')}`);
  });
  
  return lines.join('\n');
}

/**
 * 生成对账报告 CSV
 */
export function generateReconciliationReportCsv(data: ReconciliationReportData): string {
  const lines: string[] = [];
  
  // 头部信息
  lines.push('送达对账报告');
  lines.push(`店铺,${data.shopDomain}`);
  lines.push(`生成时间,${data.generatedAt}`);
  lines.push(`统计周期,${data.period.startDate} 至 ${data.period.endDate}`);
  lines.push(`总体匹配率,${data.overallMatchRate.toFixed(1)}%`);
  lines.push('');
  
  // 平台详情
  lines.push('平台送达详情');
  lines.push('平台,Webhook订单,成功发送,缺口,缺口率');
  data.platforms.forEach(platform => {
    lines.push(`${platform.name},${platform.webhookOrders},${platform.sentToPlatform},${platform.gap},${platform.gapPercentage.toFixed(1)}%`);
  });
  lines.push('');
  
  // 缺口分析
  if (data.gapAnalysis.length > 0) {
    lines.push('缺口原因分析');
    lines.push('原因,数量,占比');
    data.gapAnalysis.forEach(gap => {
      lines.push(`${gap.reason},${gap.count},${gap.percentage.toFixed(1)}%`);
    });
  }
  
  return lines.join('\n');
}

/**
 * 生成批量报告 CSV
 */
export function generateBatchReportCsv(data: BatchReportData): string {
  const lines: string[] = [];
  
  // 头部信息
  lines.push('多店迁移验收报告');
  lines.push(`工作区,${data.groupName}`);
  lines.push(`生成时间,${data.generatedAt}`);
  lines.push(`统计周期,${data.period.startDate} 至 ${data.period.endDate}`);
  lines.push('');
  
  // 汇总
  lines.push('汇总统计');
  lines.push(`总店铺数,${data.summary.totalShops}`);
  lines.push(`已扫描,${data.summary.scannedShops}`);
  lines.push(`已迁移,${data.summary.migratedShops}`);
  lines.push(`已验收,${data.summary.verifiedShops}`);
  lines.push(`平均风险分,${data.summary.avgRiskScore.toFixed(1)}`);
  lines.push(`平均匹配率,${data.summary.avgMatchRate.toFixed(1)}%`);
  lines.push('');
  
  // 店铺详情
  lines.push('店铺详情');
  lines.push('店铺,风险分,迁移状态,验收状态,配置平台,最后扫描');
  data.shops.forEach(shop => {
    lines.push(`${shop.shopDomain},${shop.riskScore},${
      shop.migrationStatus === 'completed' ? '已完成' :
      shop.migrationStatus === 'in_progress' ? '进行中' : '未开始'
    },${
      shop.verificationStatus === 'passed' ? '通过' :
      shop.verificationStatus === 'partial' ? '部分通过' :
      shop.verificationStatus === 'failed' ? '失败' : '未验收'
    },${shop.platforms.join('/') || '-'},${shop.lastScanDate || '-'}`);
  });
  
  return lines.join('\n');
}

export async function fetchBatchReportData(
  groupId: string,
  requesterId: string,
  days: number = 30
): Promise<BatchReportData | null> {
  // 导入 multi-shop 服务
  const { getShopGroupDetails, getGroupAggregatedStats } = await import("./multi-shop.server");
  
  const groupDetails = await getShopGroupDetails(groupId, requesterId);
  if (!groupDetails) return null;

  const memberShopIds = groupDetails.members.map(m => m.shopId);
  
  // 获取店铺详情
  const shops = await prisma.shop.findMany({
    where: { id: { in: memberShopIds } },
    select: {
      id: true,
      shopDomain: true,
      pixelConfigs: {
        where: { isActive: true, serverSideEnabled: true },
        select: { platform: true },
      },
      scanReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { riskScore: true, createdAt: true },
      },
      verificationRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, summaryJson: true, completedAt: true },
      },
    },
  });

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  // 计算汇总统计
  let totalRiskScore = 0;
  let scannedCount = 0;
  let migratedCount = 0;
  let verifiedCount = 0;

  const shopData = shops.map(shop => {
    const latestScan = shop.scanReports[0];
    const latestVerification = shop.verificationRuns[0];
    const platforms = shop.pixelConfigs.map(c => c.platform);

    const riskScore = latestScan?.riskScore || 0;
    if (latestScan) {
      totalRiskScore += riskScore;
      scannedCount++;
    }

    const migrationStatus = platforms.length > 0 
      ? (platforms.length >= 2 ? 'completed' : 'in_progress')
      : 'not_started';
    
    if (migrationStatus === 'completed') migratedCount++;

    let verificationStatus: 'passed' | 'partial' | 'failed' | 'not_verified' = 'not_verified';
    if (latestVerification) {
      const summary = latestVerification.summaryJson as { passRate?: number } | null;
      const passRate = summary?.passRate || 0;
      verificationStatus = passRate >= 80 ? 'passed' : passRate >= 50 ? 'partial' : 'failed';
      if (verificationStatus === 'passed') verifiedCount++;
    }

    return {
      shopDomain: shop.shopDomain,
      riskScore,
      migrationStatus: migrationStatus as 'completed' | 'in_progress' | 'not_started',
      verificationStatus,
      platforms,
      lastScanDate: latestScan?.createdAt?.toISOString().split('T')[0],
      lastVerificationDate: latestVerification?.completedAt?.toISOString().split('T')[0],
    };
  });

  // 获取匹配率
  const stats = await getGroupAggregatedStats(groupId, requesterId, days);
  const avgMatchRate = stats?.averageMatchRate || 100;

  return {
    shopDomain: groupDetails.name,
    generatedAt: new Date().toISOString(),
    reportType: "audit",
    groupName: groupDetails.name,
    period: {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    },
    summary: {
      totalShops: shops.length,
      scannedShops: scannedCount,
      migratedShops: migratedCount,
      verifiedShops: verifiedCount,
      avgRiskScore: scannedCount > 0 ? totalRiskScore / scannedCount : 0,
      avgMatchRate,
    },
    shops: shopData,
  };
}
