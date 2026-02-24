import prisma from "../db.server";
import { escapeCSV } from "../utils/csv.server";
import { getVerificationRun, type VerificationSummary, type VerificationEventResult } from "./verification.server";
import { 
  STRICT_SANDBOX_FIELD_LIMITATIONS, 
  STRICT_SANDBOX_UNAVAILABLE_EVENTS, 
  getEventSandboxLimitations 
} from "../utils/verification-limits";

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
    let reason = "Web Pixel runs in a strict sandbox (Web Worker) environment without access to DOM, localStorage, third-party cookies, etc. Some fields may be unavailable";
    if (knownFields.length > 0) {
      reason += `. Known limited fields: ${knownFields.join(", ")}`;
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
        notes.push(`${eventType} event has known limited fields (may be null, this is a platform limitation, not a bug): ${knownLimitations.join(", ")}. Auto-annotated.`);
      } else {
        const missingForEvent = missingFields.find(mf => mf.eventType === eventType);
        if (missingForEvent) {
          notes.push(`${eventType} event has known limited fields (missing detected, this is a platform limitation, not a bug): ${missingForEvent.fields.join(", ")}. Auto-annotated.`);
        }
      }
    }
    if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(eventType)) {
      notes.push(`${eventType} event is unavailable in strict sandbox, needs to be obtained via order webhooks. Auto-annotated.`);
    }
  }
  
  notes.push("Web Pixel runs in a strict sandbox (Web Worker) environment with the following limitations:");
  notes.push("- Cannot access DOM elements");
  notes.push("- Cannot use localStorage/sessionStorage");
  notes.push("- Cannot access third-party cookies");
  notes.push("- Cannot execute certain browser APIs");
  notes.push("- Some event fields may be null or undefined, this is a platform limitation, not a bug");
  if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.length > 0) {
    notes.push(`- The following event types are unavailable in strict sandbox and need to be obtained via order webhooks: ${STRICT_SANDBOX_UNAVAILABLE_EVENTS.join(", ")}`);
  }
  
  if (missingFields.length > 0 || unavailableEvents.length > 0) {
    notes.push("");
    notes.push("Auto-annotation notes:");
    notes.push("- All fields and events that cannot be obtained due to strict sandbox limitations have been auto-annotated in the report");
    notes.push("- These limitations are by design in the Shopify platform, not bugs");
    notes.push("- To obtain these fields or events, use order webhooks or other Shopify APIs");
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
  reconciliationError?: string;
  limitReached?: boolean;
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
    reconciliationError: verificationSummary.reconciliationError,
    limitReached: verificationSummary.limitReached,
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
    lines.push("Strict Sandbox Limitations Summary (Auto-annotated)");
    lines.push("Web Pixel runs in a strict sandbox (Web Worker) environment with the following limitations:");
    lines.push("- Cannot access DOM elements");
    lines.push("- Cannot use localStorage/sessionStorage");
    lines.push("- Cannot access third-party cookies");
    lines.push("- Cannot execute certain browser APIs");
    lines.push("- Some event fields may be null or undefined, this is a platform limitation, not a bug");
    if (data.sandboxLimitations.missingFields.length > 0) {
      lines.push("");
      lines.push("Missing fields (due to strict sandbox limitations, auto-annotated):");
      for (const item of data.sandboxLimitations.missingFields) {
        lines.push(
          escapeCSV(`Event type: ${item.eventType}, Missing fields: ${item.fields.join(", ")}, Reason: ${item.reason}`)
        );
      }
    }
    if (data.sandboxLimitations.unavailableEvents.length > 0) {
      lines.push("");
      lines.push("Unavailable event types (auto-annotated, need to be obtained via order webhooks):");
      lines.push(data.sandboxLimitations.unavailableEvents.map((e) => escapeCSV(e)).join(", "));
    }
    if (data.sandboxLimitations.notes.length > 0) {
      lines.push("");
      lines.push("Auto-annotation notes:");
      for (const note of data.sandboxLimitations.notes) {
        lines.push(escapeCSV(note));
      }
    }
    lines.push("");
    lines.push("Important: All fields and events that cannot be obtained due to strict sandbox limitations have been auto-annotated in the report. These limitations are by design in the Shopify platform, not bugs. To obtain these fields or events, use order webhooks or other Shopify APIs.");
  }
  return lines.join("\n");
}

