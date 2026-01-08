import type { EnhancedRiskReport } from "./risk-report.server";

export function generateRiskReportHtml(report: EnhancedRiskReport): string {
  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };

  const getRiskCategoryLabel = (category: string) => {
    switch (category) {
      case "will_fail":
        return "会失效/受限";
      case "can_replace":
        return "可直接替换";
      case "no_migration_needed":
        return "无需迁移";
      default:
        return category;
    }
  };

  const getMigrationLabel = (migration: string) => {
    switch (migration) {
      case "web_pixel":
        return "Web Pixel";
      case "ui_extension":
        return "UI Extension";
      case "server_side":
        return "Server-side CAPI";
      case "none":
        return "无需迁移";
      default:
        return migration;
    }
  };

  const getRiskLevelBadge = (level: string) => {
    const colors = {
      high: "#d72c0d",
      medium: "#f57c00",
      low: "#0288d1",
    };
    const labels = {
      high: "高风险",
      medium: "中风险",
      low: "低风险",
    };
    return `<span style="background-color: ${colors[level as keyof typeof colors] || "#666"}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${labels[level as keyof typeof labels] || level}</span>`;
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>风险报告 - ${report.shopDomain}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #666;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #333;
    }
    .section {
      background: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .section h2 {
      margin-top: 0;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
    }
    .item {
      border-left: 4px solid #e0e0e0;
      padding: 15px;
      margin: 15px 0;
      background: #fafafa;
    }
    .item.will-fail { border-left-color: #d72c0d; }
    .item.can-replace { border-left-color: #f57c00; }
    .item.no-migration { border-left-color: #0288d1; }
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 10px;
    }
    .item-title {
      font-weight: bold;
      font-size: 16px;
    }
    .item-meta {
      font-size: 12px;
      color: #666;
      margin: 5px 0;
    }
    .migration-steps {
      margin-top: 10px;
      padding-left: 20px;
    }
    .migration-steps li {
      margin: 5px 0;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-left: 5px;
    }
    .badge-high { background: #d72c0d; color: white; }
    .badge-medium { background: #f57c00; color: white; }
    .badge-low { background: #0288d1; color: white; }
    .footer {
      text-align: center;
      color: #666;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>迁移风险报告</h1>
    <p><strong>店铺:</strong> ${report.shopDomain}</p>
    <p><strong>生成时间:</strong> ${new Date(report.generatedAt).toLocaleString("zh-CN")}</p>
    <p><strong>总体风险分数:</strong> <span style="font-size: 24px; font-weight: bold; color: ${report.overallRiskScore >= 70 ? "#d72c0d" : report.overallRiskScore >= 40 ? "#f57c00" : "#0288d1"}">${report.overallRiskScore}</span> / 100</p>
  </div>

  <div class="summary">
    <div class="summary-card">
      <h3>总计</h3>
      <div class="value">${report.summary.totalItems}</div>
    </div>
    <div class="summary-card">
      <h3>会失效/受限</h3>
      <div class="value" style="color: #d72c0d;">${report.summary.willFailCount}</div>
    </div>
    <div class="summary-card">
      <h3>可直接替换</h3>
      <div class="value" style="color: #f57c00;">${report.summary.canReplaceCount}</div>
    </div>
    <div class="summary-card">
      <h3>无需迁移</h3>
      <div class="value" style="color: #0288d1;">${report.summary.noMigrationNeededCount}</div>
    </div>
    <div class="summary-card">
      <h3>预计总时间</h3>
      <div class="value">${formatTime(report.summary.totalEstimatedTime)}</div>
    </div>
  </div>

  ${report.categories.willFail.length > 0 ? `
  <div class="section">
    <h2>⚠️ 会失效/受限 (${report.categories.willFail.length} 项)</h2>
    <p style="color: #d72c0d; font-weight: bold;">这些项在 Shopify 升级后将失效或受限，必须优先处理。</p>
    ${report.categories.willFail.map(item => `
      <div class="item will-fail">
        <div class="item-header">
          <div>
            <div class="item-title">${item.displayName}</div>
            <div class="item-meta">
              ${item.platform ? `平台: ${item.platform} • ` : ""}
              类别: ${item.category} •
              优先级: ${item.priority}/10 •
              预计时间: ${formatTime(item.estimatedTimeMinutes)}
              ${getRiskLevelBadge(item.riskLevel)}
            </div>
          </div>
        </div>
        <p><strong>推荐迁移方式:</strong> ${getMigrationLabel(item.suggestedMigration)}</p>
        <p>${item.description}</p>
        <ul class="migration-steps">
          ${item.migrationSteps.map(step => `<li>${step}</li>`).join("")}
        </ul>
      </div>
    `).join("")}
  </div>
  ` : ""}

  ${report.categories.canReplace.length > 0 ? `
  <div class="section">
    <h2>🔄 可直接替换 (${report.categories.canReplace.length} 项)</h2>
    <p style="color: #f57c00;">这些项可以直接替换为新的实现方式。</p>
    ${report.categories.canReplace.map(item => `
      <div class="item can-replace">
        <div class="item-header">
          <div>
            <div class="item-title">${item.displayName}</div>
            <div class="item-meta">
              ${item.platform ? `平台: ${item.platform} • ` : ""}
              类别: ${item.category} •
              优先级: ${item.priority}/10 •
              预计时间: ${formatTime(item.estimatedTimeMinutes)}
              ${getRiskLevelBadge(item.riskLevel)}
            </div>
          </div>
        </div>
        <p><strong>推荐迁移方式:</strong> ${getMigrationLabel(item.suggestedMigration)}</p>
        <p>${item.description}</p>
        <ul class="migration-steps">
          ${item.migrationSteps.map(step => `<li>${step}</li>`).join("")}
        </ul>
      </div>
    `).join("")}
  </div>
  ` : ""}

  ${report.categories.noMigrationNeeded.length > 0 ? `
  <div class="section">
    <h2>✅ 无需迁移 (${report.categories.noMigrationNeeded.length} 项)</h2>
    <p style="color: #0288d1;">这些项无需迁移，可以保留现有配置。</p>
    ${report.categories.noMigrationNeeded.map(item => `
      <div class="item no-migration">
        <div class="item-header">
          <div>
            <div class="item-title">${item.displayName}</div>
            <div class="item-meta">
              ${item.platform ? `平台: ${item.platform} • ` : ""}
              类别: ${item.category}
              ${getRiskLevelBadge(item.riskLevel)}
            </div>
          </div>
        </div>
        <p>${item.description}</p>
      </div>
    `).join("")}
  </div>
  ` : ""}

  <div class="footer">
    <p>本报告由 Tracking Guardian 自动生成</p>
    <p>生成时间: ${new Date(report.generatedAt).toLocaleString("zh-CN")}</p>
  </div>
</body>
</html>`;
}
