import prisma from "../db.server";
import PDFDocument from "pdfkit";
import { escapeCSV } from "../utils/csv.server";
import { getVerificationRun, type VerificationSummary, type VerificationEventResult } from "./verification.server";

const STRICT_SANDBOX_FIELD_LIMITATIONS: Record<string, string[]> = {
  checkout_completed: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_started: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_contact_info_submitted: ["buyer.email", "buyer.phone"],
  checkout_shipping_info_submitted: ["deliveryAddress", "shippingAddress"],
  payment_info_submitted: ["billingAddress"],
  product_added_to_cart: [],
  product_viewed: [],
  page_viewed: [],
};

const STRICT_SANDBOX_UNAVAILABLE_EVENTS = [
  "refund",
  "order_cancelled",
  "order_edited",
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
];

function getEventSandboxLimitations(result: VerificationEventResult): string[] {
  const limitations: string[] = [];
  const eventType = result.eventType;
  const knownLimitations = STRICT_SANDBOX_FIELD_LIMITATIONS[eventType] || [];
  
  if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(eventType)) {
    limitations.push(`Strict sandbox 限制：${eventType} 事件在 Web Pixel strict sandbox 环境中不可用，需要通过订单 webhooks 获取`);
    return limitations;
  }
  
  if (knownLimitations.length > 0) {
    const missingKnownFields = knownLimitations.filter(field => {
      if (!result.discrepancies) {
        if (result.status === "missing_params" || result.status === "failed") {
          return true;
        }
        return false;
      }
      return result.discrepancies.some(d => 
        d.toLowerCase().includes(field.toLowerCase()) && 
        (d.includes("missing") || d.includes("null") || d.includes("undefined"))
      );
    });
    
    if (missingKnownFields.length > 0) {
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中无法获取以下字段：${missingKnownFields.join(", ")}。这是平台限制，不是故障。`);
    } else if (result.status === "missing_params" || result.status === "failed") {
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中可能无法获取以下字段（可能为 null）：${knownLimitations.join(", ")}。这是平台限制，不是故障。`);
    } else {
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中以下字段可能为 null（这是平台限制，不是故障）：${knownLimitations.join(", ")}。已自动标注。`);
    }
  }
  
  if (result.status === "missing_params" && result.discrepancies) {
    const missingFields = result.discrepancies.filter(d => 
      d.includes("missing") || d.includes("null") || d.includes("undefined")
    );
    if (missingFields.length > 0) {
      const fieldNames = missingFields.map(d => {
        const match = d.match(/(?:missing|null|undefined)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
        return match ? match[1] : d;
      }).filter(f => f.length > 0);
      const knownFields = fieldNames.filter(f => knownLimitations.some(kl => f.includes(kl) || kl.includes(f)));
      const unknownFields = fieldNames.filter(f => !knownFields.includes(f));
      if (knownFields.length > 0) {
        limitations.push(`Strict sandbox 限制：以下字段在 Web Worker 环境中不可用（已知限制）：${knownFields.join(", ")}`);
      }
      if (unknownFields.length > 0) {
        limitations.push(`Strict sandbox 限制：以下字段在 Web Worker 环境中不可用：${unknownFields.join(", ")}`);
      }
    }
  }
  
  if (result.eventType === "checkout_completed" || result.eventType === "checkout_started") {
    if (!result.params?.value && result.status !== "success") {
      limitations.push("Strict sandbox 限制：某些 checkout 事件在 Web Worker 环境中可能无法获取完整的 value 字段");
    }
  }
  
  if (knownLimitations.length > 0 && result.status === "success") {
    limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中以下字段可能为 null（这是平台限制，不是故障）：${knownLimitations.join(", ")}。已自动标注。`);
  }
  
  return limitations;
}

function analyzeSandboxLimitations(results: VerificationEventResult[]): {
  missingFields: Array<{
    eventType: string;
    fields: string[];
    reason: string;
  }>;
  unavailableEvents: string[];
  notes: string[];
} {
  const missingFieldsMap = new Map<string, Set<string>>();
  const unavailableEvents: string[] = [];
  const notes: string[] = [];
  const eventTypes = new Set<string>();
  
  for (const result of results) {
    eventTypes.add(result.eventType);
    if (result.status === "missing_params" || result.status === "failed") {
      if (result.discrepancies && result.discrepancies.length > 0) {
        const eventType = result.eventType;
        if (!missingFieldsMap.has(eventType)) {
          missingFieldsMap.set(eventType, new Set());
        }
        const fields = result.discrepancies
          .filter(d => d.includes("missing") || d.includes("null") || d.includes("undefined"))
          .map(d => {
            const match = d.match(/(?:missing|null|undefined)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
            return match ? match[1] : d.replace(/.*missing\s+/i, "").replace(/.*null\s+/i, "").replace(/.*undefined\s+/i, "").trim();
          })
          .filter(f => f.length > 0);
        fields.forEach(f => missingFieldsMap.get(eventType)!.add(f));
      }
    }
    if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(result.eventType)) {
      if (!unavailableEvents.includes(result.eventType)) {
        unavailableEvents.push(result.eventType);
      }
    }
  }
  
  const missingFields = Array.from(missingFieldsMap.entries()).map(([eventType, fields]) => {
    const knownLimitations = STRICT_SANDBOX_FIELD_LIMITATIONS[eventType] || [];
    const knownFields = Array.from(fields).filter(f => knownLimitations.some(kl => f.includes(kl) || kl.includes(f)));
    let reason = "Web Pixel 运行在 strict sandbox (Web Worker) 环境中，无法访问 DOM、localStorage、第三方 cookie 等，部分字段可能不可用";
    if (knownFields.length > 0) {
      reason += `。已知限制字段：${knownFields.join(", ")}`;
    }
    return {
      eventType,
      fields: Array.from(fields),
      reason,
    };
  });
  
  for (const eventType of eventTypes) {
    const knownLimitations = STRICT_SANDBOX_FIELD_LIMITATIONS[eventType];
    if (knownLimitations && knownLimitations.length > 0) {
      const hasMissing = missingFields.some(mf => mf.eventType === eventType);
      if (!hasMissing) {
        notes.push(`${eventType} 事件已知限制字段（可能为 null，这是平台限制，不是故障）：${knownLimitations.join(", ")}。已自动标注。`);
      } else {
        const missingForEvent = missingFields.find(mf => mf.eventType === eventType);
        if (missingForEvent) {
          notes.push(`${eventType} 事件已知限制字段（已检测到缺失，这是平台限制，不是故障）：${missingForEvent.fields.join(", ")}。已自动标注。`);
        }
      }
    }
    if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(eventType)) {
      notes.push(`${eventType} 事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取。已自动标注。`);
    }
  }
  
  notes.push("Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：");
  notes.push("- 无法访问 DOM 元素");
  notes.push("- 无法使用 localStorage/sessionStorage");
  notes.push("- 无法访问第三方 cookie");
  notes.push("- 无法执行某些浏览器 API");
  notes.push("- 部分事件字段可能为 null 或 undefined，这是平台限制，不是故障");
  if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.length > 0) {
    notes.push(`- 以下事件类型在 strict sandbox 中不可用，需要通过订单 webhooks 获取：${STRICT_SANDBOX_UNAVAILABLE_EVENTS.join(", ")}`);
  }
  
  if (missingFields.length > 0 || unavailableEvents.length > 0) {
    notes.push("");
    notes.push("自动标注说明：");
    notes.push("- 报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件");
    notes.push("- 这些限制是 Shopify 平台的设计限制，不是故障");
    notes.push("- 如需获取这些字段或事件，请使用订单 webhooks 或其他 Shopify API");
  }
  
  return {
    missingFields,
    unavailableEvents,
    notes,
  };
}

export interface VerificationReportData {
  runId: string;
  runName: string;
  shopId: string;
  shopDomain: string;
  runType: "quick" | "full" | "custom";
  status: string;
  platforms: string[];
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    missingParamTests: number;
    parameterCompleteness: number;
    valueAccuracy: number;
  };
  platformResults: Record<string, { sent: number; failed: number }>;
  events: Array<{
    testItemId?: string;
    eventType: string;
    platform: string;
    orderId?: string;
    status: string;
    params?: {
      value?: number;
      currency?: string;
    };
    discrepancies?: string[];
    errors?: string[];
    sandboxLimitations?: string[];
  }>;
  reconciliation?: VerificationSummary["reconciliation"];
  sandboxLimitations?: {
    missingFields: Array<{
      eventType: string;
      fields: string[];
      reason: string;
    }>;
    unavailableEvents: string[];
    notes: string[];
  };
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export async function generateVerificationReportData(
  shopId: string,
  runId: string
): Promise<VerificationReportData> {
  const verificationSummary = await getVerificationRun(runId);
  if (!verificationSummary) {
    throw new Error("Verification run not found");
  }
  if (verificationSummary.shopId !== shopId) {
    throw new Error("Access denied");
  }
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: {
      createdAt: true,
      Shop: {
        select: {
          shopDomain: true,
        },
      },
    },
  });
  if (!run) {
    throw new Error("Verification run not found");
  }
  const sandboxLimitations = analyzeSandboxLimitations(verificationSummary.results);
  return {
    runId: verificationSummary.runId,
    runName: verificationSummary.runName,
    shopId: verificationSummary.shopId,
    shopDomain: run.Shop.shopDomain,
    runType: verificationSummary.runType,
    status: verificationSummary.status,
    platforms: verificationSummary.platforms,
    summary: {
      totalTests: verificationSummary.totalTests,
      passedTests: verificationSummary.passedTests,
      failedTests: verificationSummary.failedTests,
      missingParamTests: verificationSummary.missingParamTests,
      parameterCompleteness: verificationSummary.parameterCompleteness,
      valueAccuracy: verificationSummary.valueAccuracy,
    },
    platformResults: verificationSummary.platformResults || {},
    events: verificationSummary.results.map((result) => ({
      testItemId: result.testItemId,
      eventType: result.eventType,
      platform: result.platform,
      orderId: result.orderId,
      status: result.status,
      params: result.params,
      discrepancies: result.discrepancies,
      errors: result.errors,
      sandboxLimitations: getEventSandboxLimitations(result),
    })),
    reconciliation: verificationSummary.reconciliation,
    sandboxLimitations,
    startedAt: verificationSummary.startedAt,
    completedAt: verificationSummary.completedAt,
    createdAt: run.createdAt,
  };
}

export function generateVerificationReportCSV(data: VerificationReportData): string {
  const lines: string[] = [];
  lines.push("Run ID,Run Name,Shop Domain,Run Type,Status,Platforms,Total Tests,Passed Tests,Failed Tests,Missing Param Tests,Parameter Completeness,Value Accuracy");
  lines.push(
    [
      escapeCSV(data.runId),
      escapeCSV(data.runName),
      escapeCSV(data.shopDomain),
      escapeCSV(data.runType),
      escapeCSV(data.status),
      escapeCSV(data.platforms.join(";")),
      String(data.summary.totalTests),
      String(data.summary.passedTests),
      String(data.summary.failedTests),
      String(data.summary.missingParamTests),
      escapeCSV(`${data.summary.parameterCompleteness.toFixed(2)}%`),
      escapeCSV(`${data.summary.valueAccuracy.toFixed(2)}%`),
    ].join(",")
  );
  lines.push("");
  lines.push("Platform,Sent,Failed");
  for (const [platform, stats] of Object.entries(data.platformResults)) {
    lines.push(
      [
        escapeCSV(platform),
        String(stats.sent),
        String(stats.failed),
      ].join(",")
    );
  }
  lines.push("");
  lines.push("Test Item ID,Event Type,Platform,Order ID,Status,Value,Currency,Discrepancies,Errors,Sandbox Limitations");
  for (const event of data.events) {
    lines.push(
      [
        escapeCSV(event.testItemId || ""),
        escapeCSV(event.eventType),
        escapeCSV(event.platform),
        escapeCSV(event.orderId || ""),
        escapeCSV(event.status),
        escapeCSV(event.params?.value?.toFixed(2) || ""),
        escapeCSV(event.params?.currency || ""),
        escapeCSV(event.discrepancies?.join("; ") || ""),
        escapeCSV(event.errors?.join("; ") || ""),
        escapeCSV(event.sandboxLimitations?.join("; ") || ""),
      ].join(",")
    );
  }
  if (data.sandboxLimitations) {
    lines.push("");
    lines.push("Strict Sandbox Limitations Summary (已自动标注)");
    lines.push("Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：");
    lines.push("- 无法访问 DOM 元素");
    lines.push("- 无法使用 localStorage/sessionStorage");
    lines.push("- 无法访问第三方 cookie");
    lines.push("- 无法执行某些浏览器 API");
    lines.push("- 部分事件字段可能为 null 或 undefined，这是平台限制，不是故障");
    if (data.sandboxLimitations.missingFields.length > 0) {
      lines.push("");
      lines.push("缺失字段（由于 strict sandbox 限制，已自动标注）：");
      for (const item of data.sandboxLimitations.missingFields) {
        lines.push(`事件类型: ${item.eventType}, 缺失字段: ${item.fields.join(", ")}, 原因: ${item.reason}`);
      }
    }
    if (data.sandboxLimitations.unavailableEvents.length > 0) {
      lines.push("");
      lines.push("不可用的事件类型（已自动标注，需要通过订单 webhooks 获取）：");
      lines.push(data.sandboxLimitations.unavailableEvents.join(", "));
    }
    if (data.sandboxLimitations.notes.length > 0) {
      lines.push("");
      lines.push("自动标注说明：");
      for (const note of data.sandboxLimitations.notes) {
        lines.push(escapeCSV(note));
      }
    }
    lines.push("");
    lines.push("重要提示：报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。这些限制是 Shopify 平台的设计限制，不是故障。如需获取这些字段或事件，请使用订单 webhooks 或其他 Shopify API。");
  }
  return lines.join("\n");
}

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 1000;
const MAX_EVENTS_IN_PDF = 100;

export async function generateVerificationReportPDF(
  data: VerificationReportData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      let totalSize = 0;
      let pageCount = 0;
      
      doc.on("data", (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        if (totalSize > MAX_PDF_SIZE_BYTES) {
          doc.removeAllListeners();
          reject(new Error(`PDF size exceeds maximum limit of ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB`));
        }
      });
      
      doc.on("pageAdded", () => {
        pageCount++;
        if (pageCount > MAX_PDF_PAGES) {
          doc.removeAllListeners();
          reject(new Error(`PDF page count exceeds maximum limit of ${MAX_PDF_PAGES} pages`));
        }
      });
      
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(20).text("Verification Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(14).text(`Run: ${data.runName}`, { align: "left" });
      doc.text(`Shop: ${data.shopDomain}`);
      doc.text(`Run Type: ${data.runType}`);
      doc.text(`Status: ${data.status}`);
      doc.text(`Platforms: ${data.platforms.join(", ")}`);
      if (data.completedAt) {
        doc.text(`Completed At: ${new Date(data.completedAt).toLocaleString("zh-CN")}`);
      }
      doc.moveDown();
      doc.fontSize(16).text("Summary", { underline: true });
      doc.fontSize(12);
      doc.text(`Total Tests: ${data.summary.totalTests}`);
      doc.text(`Passed: ${data.summary.passedTests}`);
      doc.text(`Failed: ${data.summary.failedTests}`);
      doc.text(`Missing Params: ${data.summary.missingParamTests}`);
      doc.text(`Parameter Completeness: ${data.summary.parameterCompleteness.toFixed(2)}%`);
      doc.text(`Value Accuracy: ${data.summary.valueAccuracy.toFixed(2)}%`);
      doc.moveDown();
      if (Object.keys(data.platformResults).length > 0) {
        doc.fontSize(16).text("Platform Results", { underline: true });
        doc.fontSize(12);
        for (const [platform, stats] of Object.entries(data.platformResults)) {
          const total = stats.sent + stats.failed;
          const successRate = total > 0 ? (stats.sent / total) * 100 : 0;
          doc.text(`${platform}: ${stats.sent} sent, ${stats.failed} failed (${successRate.toFixed(2)}% success rate)`);
        }
        doc.moveDown();
      }
      if (data.events.length > 0) {
        doc.fontSize(16).text("Event Details", { underline: true });
        doc.fontSize(10);
        const eventsToInclude = Math.min(data.events.length, MAX_EVENTS_IN_PDF);
        for (let i = 0; i < eventsToInclude; i++) {
          const event = data.events[i];
          doc.text(`${i + 1}. ${event.eventType} (${event.platform}) - ${event.status}`);
          if (event.orderId) {
            doc.text(`   Order ID: ${event.orderId}`);
          }
          if (event.params?.value) {
            doc.text(`   Value: ${event.params.value} ${event.params.currency || ""}`);
          }
          if (event.discrepancies && event.discrepancies.length > 0) {
            doc.text(`   Discrepancies: ${event.discrepancies.join(", ")}`);
          }
          if (event.errors && event.errors.length > 0) {
            doc.text(`   Errors: ${event.errors.join(", ")}`);
          }
          if (event.sandboxLimitations && event.sandboxLimitations.length > 0) {
            doc.text(`   Sandbox Limitations: ${event.sandboxLimitations.join("; ")}`, { indent: 10 });
          }
          doc.moveDown(0.5);
        }
        if (data.events.length > MAX_EVENTS_IN_PDF) {
          doc.text(`... and ${data.events.length - MAX_EVENTS_IN_PDF} more events`);
        }
      }
      if (data.sandboxLimitations) {
        doc.moveDown();
        doc.fontSize(16).text("Strict Sandbox Limitations (已自动标注)", { underline: true });
        doc.fontSize(12);
        doc.text("Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：", { indent: 10 });
        doc.text("- 无法访问 DOM 元素", { indent: 10 });
        doc.text("- 无法使用 localStorage/sessionStorage", { indent: 10 });
        doc.text("- 无法访问第三方 cookie", { indent: 10 });
        doc.text("- 无法执行某些浏览器 API", { indent: 10 });
        doc.text("- 部分事件字段可能为 null 或 undefined，这是平台限制，不是故障", { indent: 10 });
        doc.moveDown(0.5);
        if (data.sandboxLimitations.missingFields.length > 0) {
          doc.text("缺失字段（由于 strict sandbox 限制，已自动标注）：");
          for (const item of data.sandboxLimitations.missingFields) {
            doc.text(`  事件类型：${item.eventType}`, { indent: 10 });
            doc.text(`  缺失字段：${item.fields.join(", ")}`, { indent: 10 });
            doc.text(`  原因：${item.reason}`, { indent: 10 });
            doc.moveDown(0.3);
          }
        }
        if (data.sandboxLimitations.unavailableEvents.length > 0) {
          doc.moveDown(0.5);
          doc.text("不可用的事件类型（已自动标注，需要通过订单 webhooks 获取）：");
          doc.text(`  ${data.sandboxLimitations.unavailableEvents.join(", ")}`, { indent: 10 });
        }
        if (data.sandboxLimitations.notes.length > 0) {
          doc.moveDown(0.5);
          doc.text("自动标注说明：");
          for (const note of data.sandboxLimitations.notes) {
            doc.text(`  ${note}`, { indent: 10 });
          }
        }
        doc.moveDown(0.5);
        doc.text("重要提示：报告中已自动标注所有因 strict sandbox 限制而无法获取的字段和事件。这些限制是 Shopify 平台的设计限制，不是故障。如需获取这些字段或事件，请使用订单 webhooks 或其他 Shopify API。", { indent: 10 });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
