
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import type { VerificationSummary } from "./verification.server";

export interface VerificationReportData {
  runId: string;
  shopId: string;
  shopDomain: string;
  runName: string;
  runType: "quick" | "full" | "custom";
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    missingParamTests: number;
    parameterCompleteness: number;
    valueAccuracy: number;
  };
  platformResults: Record<string, { sent: number; failed: number }>;
  reconciliation?: VerificationSummary["reconciliation"];
  events: Array<{
    testItemId: string;
    eventType: string;
    platform: string;
    orderId?: string;
    status: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>;
}

export async function generateVerificationReportData(
  shopId: string,
  runId: string
): Promise<VerificationReportData | null> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    include: {
      shop: {
        select: { shopDomain: true },
      },
    },
  });

  if (!run || run.shopId !== shopId) {
    return null;
  }

  const summary = run.summaryJson as Record<string, unknown> | null;
  const events = (run.eventsJson as Array<any>) || [];
  const reconciliation = summary?.reconciliation as VerificationSummary["reconciliation"] | undefined;

  return {
    runId: run.id,
    shopId: run.shopId,
    shopDomain: run.shop.shopDomain,
    runName: run.runName,
    runType: run.runType as "quick" | "full" | "custom",
    status: run.status as "pending" | "running" | "completed" | "failed",
    startedAt: run.startedAt || undefined,
    completedAt: run.completedAt || undefined,
    summary: {
      totalTests: (summary?.totalTests as number) || 0,
      passedTests: (summary?.passedTests as number) || 0,
      failedTests: (summary?.failedTests as number) || 0,
      missingParamTests: (summary?.missingParamTests as number) || 0,
      parameterCompleteness: (summary?.parameterCompleteness as number) || 0,
      valueAccuracy: (summary?.valueAccuracy as number) || 0,
    },
    platformResults: (summary?.platformResults as Record<string, { sent: number; failed: number }>) || {},
    reconciliation,
    events: events.map((e) => ({
      testItemId: e.testItemId || "",
      eventType: e.eventType || "",
      platform: e.platform || "",
      orderId: e.orderId,
      status: e.status || "not_tested",
      params: e.params,
      discrepancies: e.discrepancies,
      errors: e.errors,
    })),
  };
}

export function generateVerificationReportCSV(data: VerificationReportData): string {
  const headers = [
    "测试项",
    "事件类型",
    "平台",
    "订单ID",
    "订单号",
    "状态",
    "金额",
    "币种",
    "商品数量",
    "问题",
    "错误",
  ];

  const rows = data.events.map((event) => [
    event.testItemId,
    event.eventType,
    event.platform,
    event.orderId || "",
    "",
    event.status,
    event.params?.value?.toString() || "",
    event.params?.currency || "",
    event.params?.items?.toString() || "",
    event.discrepancies?.join("; ") || "",
    event.errors?.join("; ") || "",
  ]);

  const summaryRow = [
    "摘要",
    "",
    "",
    "",
    "",
    "",
    `总测试: ${data.summary.totalTests}`,
    `通过: ${data.summary.passedTests}`,
    `失败: ${data.summary.failedTests}`,
    `参数完整率: ${data.summary.parameterCompleteness}%`,
    `金额准确率: ${data.summary.valueAccuracy}%`,
  ];

  const csv = [
    `验收报告 - ${data.runName}`,
    `生成时间: ${data.completedAt?.toLocaleString("zh-CN") || new Date().toLocaleString("zh-CN")}`,
    `店铺: ${data.shopDomain}`,
    "",
    ...headers.map((h) => `"${h}"`).join(","),
    ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    "",
    ...summaryRow.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
  ].join("\n");

  return csv;
}

export async function generateVerificationReportPDF(
  data: VerificationReportData
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const html = generateVerificationReportHTML(data);

    const htmlToPdfModule = await import("./pdf-generator.server");

    const buffer = await htmlToPdfModule.htmlToPdf(html, {
      format: "A4",
      landscape: false,
      margin: {
        top: "20mm",
        right: "20mm",
        bottom: "20mm",
        left: "20mm",
      },
    });

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `verification-report-${data.shopDomain.replace(/\./g, "_")}-${timestamp}.pdf`;

    return { buffer, filename };
  } catch (error) {
    logger.error("Failed to generate verification report PDF", {
      runId: data.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function generateVerificationReportHTML(data: VerificationReportData): string {
  const formatDate = (date?: Date) => {
    if (!date) return "未开始";
    return date.toLocaleString("zh-CN");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return '<span style="color: green; font-weight: bold;">✓ 成功</span>';
      case "failed":
        return '<span style="color: red; font-weight: bold;">✗ 失败</span>';
      case "missing_params":
        return '<span style="color: orange; font-weight: bold;">⚠ 缺参</span>';
      default:
        return '<span style="color: gray;">未测试</span>';
    }
  };

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>验收报告 - ${data.runName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 40px;
      color: #333;
    }
    h1 { color: #202223; border-bottom: 2px solid #008060; padding-bottom: 10px; }
    h2 { color: #202223; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f6f6f7; font-weight: 600; }
    .summary-box {
      background: #f6f6f7;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-value { font-size: 24px; font-weight: bold; color: #008060; }
    .metric-label { font-size: 14px; color: #6d7175; }
    .reconciliation-section { margin-top: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; }
    .issue-item { padding: 8px; margin: 5px 0; background: #fff; border-left: 3px solid #ff6b6b; }
  </style>
</head>
<body>
  <h1>验收报告</h1>

  <div class="summary-box">
    <h2>报告信息</h2>
    <p><strong>报告名称:</strong> ${data.runName}</p>
    <p><strong>测试类型:</strong> ${data.runType === "quick" ? "快速测试" : data.runType === "full" ? "完整测试" : "自定义测试"}</p>
    <p><strong>店铺:</strong> ${data.shopDomain}</p>
    <p><strong>开始时间:</strong> ${formatDate(data.startedAt)}</p>
    <p><strong>完成时间:</strong> ${formatDate(data.completedAt)}</p>
    <p><strong>状态:</strong> ${data.status === "completed" ? "已完成" : data.status === "running" ? "进行中" : data.status === "failed" ? "失败" : "待开始"}</p>
  </div>

  <div class="summary-box">
    <h2>测试摘要</h2>
    <div class="metric">
      <div class="metric-value">${data.summary.totalTests}</div>
      <div class="metric-label">总测试数</div>
    </div>
    <div class="metric">
      <div class="metric-value">${data.summary.passedTests}</div>
      <div class="metric-label">通过</div>
    </div>
    <div class="metric">
      <div class="metric-value">${data.summary.failedTests}</div>
      <div class="metric-label">失败</div>
    </div>
    <div class="metric">
      <div class="metric-value">${data.summary.parameterCompleteness}%</div>
      <div class="metric-label">参数完整率</div>
    </div>
    <div class="metric">
      <div class="metric-value">${data.summary.valueAccuracy}%</div>
      <div class="metric-label">金额准确率</div>
    </div>
  </div>

  <h2>平台统计</h2>
  <table>
    <thead>
      <tr>
        <th>平台</th>
        <th>成功发送</th>
        <th>发送失败</th>
        <th>成功率</th>
      </tr>
    </thead>
    <tbody>
      ${Object.entries(data.platformResults).map(([platform, stats]) => {
        const total = stats.sent + stats.failed;
        const successRate = total > 0 ? Math.round((stats.sent / total) * 100) : 0;
        return `
        <tr>
          <td>${platform}</td>
          <td>${stats.sent}</td>
          <td>${stats.failed}</td>
          <td>${successRate}%</td>
        </tr>
        `;
      }).join("")}
    </tbody>
  </table>

  <h2>事件详情</h2>
  <table>
    <thead>
      <tr>
        <th>测试项</th>
        <th>事件类型</th>
        <th>平台</th>
        <th>订单ID</th>
        <th>状态</th>
        <th>金额</th>
        <th>币种</th>
        <th>问题</th>
      </tr>
    </thead>
    <tbody>
      ${data.events.map((event) => `
        <tr>
          <td>${event.testItemId}</td>
          <td>${event.eventType}</td>
          <td>${event.platform}</td>
          <td>${event.orderId || ""}</td>
          <td>${getStatusBadge(event.status)}</td>
          <td>${event.params?.value?.toFixed(2) || ""}</td>
          <td>${event.params?.currency || ""}</td>
          <td>${event.discrepancies?.join("; ") || event.errors?.join("; ") || ""}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  `;

  if (data.reconciliation) {
    html += `
  <div class="reconciliation-section">
    <h2>渠道对账结果</h2>

    ${data.reconciliation.pixelVsCapi ? `
    <h3>Pixel vs CAPI</h3>
    <ul>
      <li>仅 Pixel: ${data.reconciliation.pixelVsCapi.pixelOnly}</li>
      <li>仅 CAPI: ${data.reconciliation.pixelVsCapi.capiOnly}</li>
      <li>两者都有: ${data.reconciliation.pixelVsCapi.both}</li>
      <li>被同意策略阻止: ${data.reconciliation.pixelVsCapi.consentBlocked}</li>
    </ul>
    ` : ""}

    ${data.reconciliation.localConsistency ? `
    <h3>本地一致性检查</h3>
    <p>检查订单数: ${data.reconciliation.localConsistency.totalChecked}</p>
    <ul>
      <li>一致: ${data.reconciliation.localConsistency.consistent}</li>
      <li>部分一致: ${data.reconciliation.localConsistency.partial}</li>
      <li>不一致: ${data.reconciliation.localConsistency.inconsistent}</li>
    </ul>

    ${data.reconciliation.localConsistency.issues.length > 0 ? `
    <h4>问题订单</h4>
    ${data.reconciliation.localConsistency.issues.map((issue) => `
      <div class="issue-item">
        <strong>订单 ${issue.orderId}:</strong> ${issue.status}
        <ul>
          ${issue.issues.map((i) => `<li>${i}</li>`).join("")}
        </ul>
      </div>
    `).join("")}
    ` : ""}
    ` : ""}

    ${data.reconciliation.consistencyIssues && data.reconciliation.consistencyIssues.length > 0 ? `
    <h3>一致性问题</h3>
    <ul>
      ${data.reconciliation.consistencyIssues.map((issue) => `
        <li>订单 ${issue.orderId}: ${issue.issue} (类型: ${issue.type})</li>
      `).join("")}
    </ul>
    ` : ""}
  </div>
    `;
  }

  html += `
  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #6d7175; font-size: 12px;">
    <p>报告生成时间: ${new Date().toLocaleString("zh-CN")}</p>
    <p>Tracking Guardian - Checkout 升级助手</p>
  </div>
</body>
</html>
  `;

  return html;
}
