
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { htmlToPdf } from "./pdf-generator.server";
import type { VerificationSummary } from "./verification.server";
import { getEventLogs } from "./event-log.server";

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
      Shop: {
        select: { shopDomain: true },
      },
    },
  });

  if (!run || run.shopId !== shopId) {
    return null;
  }

  const summary = run.summaryJson as Record<string, unknown> | null;
  const events = (run.eventsJson as Array<{
    testItemId?: string;
    eventType?: string;
    platform?: string;
    orderId?: string;
    status?: string;
    params?: {
      value?: number;
      currency?: string;
      items?: number;
    };
    discrepancies?: string[];
    errors?: string[];
  }>) || [];
  const reconciliation = summary?.reconciliation as VerificationSummary["reconciliation"] | undefined;

  // P0: 获取 EventLog 证据链（用于导出报告）
  const eventLogs = await getEventLogs(run.shopId, {
    startDate: run.startedAt || undefined,
    endDate: run.completedAt || undefined,
    limit: 1000, // 限制数量避免报告过大
  });

  // 将 EventLog 与 events 关联（通过 eventId 或 orderId）
  const eventsWithEvidence = events.map((e) => {
    const relatedLogs = eventLogs.filter((log) => {
      if (e.orderId && log.requestPayload && typeof log.requestPayload === "object") {
        const payload = log.requestPayload as Record<string, unknown>;
        const body = payload.body as Record<string, unknown> | undefined;
        if (body) {
          // 检查 GA4/Meta/TikTok payload 中的 orderId
          const orderIdInPayload = 
            (body as any)?.data?.[0]?.custom_data?.order_id ||
            (body as any)?.events?.[0]?.params?.transaction_id ||
            (body as any)?.properties?.order_id;
          return orderIdInPayload === e.orderId;
        }
      }
      return log.eventId === e.testItemId || log.eventName === e.eventType;
    });

    return {
      testItemId: e.testItemId || "",
      eventType: e.eventType || "",
      platform: e.platform || "",
      orderId: e.orderId,
      status: e.status || "not_tested",
      params: e.params,
      discrepancies: e.discrepancies,
      errors: e.errors,
      // P0: 添加证据链
      evidence: relatedLogs.map((log) => ({
        destination: log.destination,
        requestPayload: log.requestPayload,
        status: log.status,
        errorDetail: log.errorDetail,
        responseStatus: log.responseStatus,
        sentAt: log.sentAt,
      })),
    };
  });

  return {
    runId: run.id,
    shopId: run.shopId,
    shopDomain: run.Shop.shopDomain,
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
    events: eventsWithEvidence,
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

  // P1-12: 在 CSV 中添加免责声明
  const disclaimer = [
    "",
    "重要说明：事件发送与平台归因",
    "本应用仅保证事件生成与发送成功，不保证平台侧归因一致。",
    "我们保证：事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）。",
    "我们不保证：平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、数据处理延迟等。",
    "验收报告说明：本验收报告仅验证事件是否成功发送到平台 API，以及事件参数是否完整。平台侧报表中的归因数据可能因平台算法、数据处理延迟等因素与 Shopify 订单数据存在差异，这是正常现象。",
    "",
  ];

  const csv = [
    `验收报告 - ${data.runName}`,
    `生成时间: ${data.completedAt?.toLocaleString("zh-CN") || new Date().toLocaleString("zh-CN")}`,
    `店铺: ${data.shopDomain}`,
    "",
    ...disclaimer.map((line) => `"${line.replace(/"/g, '""')}"`),
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

    const buffer = await htmlToPdf(html, {
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

  <!-- P0-05: Checkout Extensibility 风险提示 -->
  <div style="background: #fff4e6; border-left: 4px solid #ff9800; padding: 20px; margin: 20px 0; border-radius: 4px;">
    <h2 style="color: #e65100; margin-top: 0;">⚠️ 重要提示：Checkout Extensibility 迁移边界情况</h2>
    <p style="margin: 10px 0;"><strong>为确保数据不断档，请注意以下边界情况：</strong></p>
    <ul style="margin: 10px 0; padding-left: 20px;">
      <li style="margin: 8px 0;"><strong>旧脚本弃用时间线：</strong> Thank you / Order status 页面的旧方式（script tags / additional scripts / checkout.liquid）已被 Checkout Extensibility 替换，且有明确的关停日期。请确保在关停前完成迁移。</li>
      <li style="margin: 8px 0;"><strong>checkout_completed 触发位置：</strong> 该事件不一定在 Thank you 页触发。当存在 upsell / post-purchase 时，可能在第一个 upsell 页触发，且 Thank you 页不再触发。若触发页加载失败则完全不触发。
      <br />
      <strong>v1.0 版本说明：</strong>v1.0 版本仅依赖 Web Pixels 标准事件，不处理订单 webhooks。请确保 checkout_completed 事件能够正常触发。</li>
      <li style="margin: 8px 0;"><strong>Web Pixel 隐私与 consent：</strong> 在需要 consent 的地区，回调会在 consent 后执行，之前注册的事件会 replay。请确保您的迁移方案能正确处理 consent 状态变化。</li>
    </ul>
    <p style="margin: 10px 0; font-style: italic; color: #666;">💡 <strong>v1.0 版本说明：</strong> v1.0 版本仅依赖 Web Pixels 标准事件，不处理订单 webhooks。在验收测试中，请特别关注 upsell 场景和 consent 变化场景，确保 checkout_completed 事件能够正常触发。</p>
  </div>

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
  <p style="color: #6d7175; font-size: 14px; margin-bottom: 10px;">
    💡 <strong>注意：</strong>以下事件包含发往平台的请求 payload 证据链。如果某些字段（如姓名、邮箱、电话、地址）为 null，可能是由于：
    <br />• PCD (Protected Customer Data) 需要额外 scope 审批（2025-12-10 起生效）
    <br />• 用户未同意 analytics/marketing consent
    <br />• 这是 Shopify 平台的合规行为，不是故障
  </p>
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
        <th>证据链</th>
      </tr>
    </thead>
    <tbody>
      ${data.events.map((event) => {
        const evidenceCount = (event as any).evidence?.length || 0;
        const evidenceHtml = evidenceCount > 0 
          ? `<details style="cursor: pointer;"><summary>查看 ${evidenceCount} 条证据</summary><pre style="background: #f6f6f7; padding: 10px; margin: 5px 0; border-radius: 4px; font-size: 12px; max-height: 200px; overflow: auto;">${JSON.stringify((event as any).evidence, null, 2)}</pre></details>`
          : "无证据";
        return `
        <tr>
          <td>${event.testItemId}</td>
          <td>${event.eventType}</td>
          <td>${event.platform}</td>
          <td>${event.orderId || ""}</td>
          <td>${getStatusBadge(event.status)}</td>
          <td>${event.params?.value?.toFixed(2) || ""}</td>
          <td>${event.params?.currency || ""}</td>
          <td>${event.discrepancies?.join("; ") || event.errors?.join("; ") || ""}</td>
          <td>${evidenceHtml}</td>
        </tr>
      `;
      }).join("")}
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

  // P1-12: 添加免责声明，明确说明我们只保证生成与发送成功，不保证平台侧归因一致
  html += `
  <div style="margin-top: 40px; padding: 20px; background: #f6f6f7; border-radius: 8px; border-left: 4px solid #008060;">
    <h3 style="color: #202223; margin-top: 0;">重要说明：事件发送与平台归因</h3>
    <p style="margin: 10px 0; color: #202223;"><strong>本应用仅保证事件生成与发送成功，不保证平台侧归因一致。</strong></p>
    <ul style="margin: 10px 0; padding-left: 20px; color: #6d7175;">
      <li style="margin: 8px 0;"><strong>我们保证：</strong>事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）。本报告中的"成功"状态表示事件已成功发送到平台 API，并收到平台确认响应。</li>
      <li style="margin: 8px 0;"><strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、数据处理延迟等。</li>
      <li style="margin: 8px 0;"><strong>验收报告说明：</strong>本验收报告仅验证事件是否成功发送到平台 API，以及事件参数是否完整。平台侧报表中的归因数据可能因平台算法、数据处理延迟等因素与 Shopify 订单数据存在差异，这是正常现象。</li>
    </ul>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #6d7175; font-size: 12px;">
    <p>报告生成时间: ${new Date().toLocaleString("zh-CN")}</p>
    <p>Tracking Guardian - Checkout 升级助手</p>
  </div>
</body>
</html>
  `;

  return html;
}

export const generateVerificationReportHtml = generateVerificationReportHTML;
