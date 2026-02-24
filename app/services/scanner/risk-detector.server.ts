import type { RiskItem } from "../../types";
import { analyzeScriptContent } from "./content-analysis";
import { randomBytes } from "crypto";
import type { TFunction } from "i18next";
import { getT } from "../../utils/i18n-helpers";

export interface RiskDetectionResult {
  risks: RiskItem[];
  riskScore: number;
  detectedIssues: {
    piiAccess: boolean;
    windowDocumentAccess: boolean;
    blockingLoad: boolean;
    duplicateTriggers: boolean;
  };
}

export function detectRisksInContent(content: string, t?: TFunction): RiskDetectionResult {
  const analysis = analyzeScriptContent(content, t);
  const detectedIssues = {
    piiAccess: analysis.risks.some(r => r.id === "pii_access"),
    windowDocumentAccess: analysis.risks.some(r => r.id === "window_document_access"),
    blockingLoad: analysis.risks.some(r => r.id === "blocking_load"),
    duplicateTriggers: analysis.risks.some(r => r.id === "duplicate_triggers"),
  };
  const keyRisks = analysis.risks.filter(r =>
    r.id === "pii_access" ||
    r.id === "window_document_access" ||
    r.id === "blocking_load" ||
    r.id === "duplicate_triggers"
  );
  const enhancedRisks = keyRisks.map(risk => enhanceRiskDescription(risk, content, t));
  return {
    risks: enhancedRisks,
    riskScore: analysis.riskScore,
    detectedIssues,
  };
}

// P1-2: URL-based risk detection for ScriptTags (where content is not available)
export function detectRisksInUrl(url: string, t?: TFunction): RiskDetectionResult {
  const risks: RiskItem[] = [];
  const lowerUrl = url.toLowerCase();
  
  // Known tracking domains usually imply window/document access when loaded as ScriptTag
  const knownTrackingDomains = [
    "facebook.net", "connect.facebook.net", 
    "google-analytics.com", "googletagmanager.com", 
    "tiktok.com", "analytics.tiktok.com",
    "pinterest.com", "pinimg.com",
    "snapchat.com", "sc-static.net",
    "clarity.ms", "hotjar.com"
  ];
  
  const isKnownTracker = knownTrackingDomains.some(d => lowerUrl.includes(d));
  
  if (isKnownTracker) {
    risks.push({
      id: "window_document_access", // Inferred
      name: getT(t, "scan.risks.window_document_access.name", {}, "Window/Document Object Access"),
      severity: "medium",
      points: 20,
      description: getT(t, "scan.risks.window_document_access.description", {}, "External tracking script detected via URL. These scripts typically access window/document objects which is restricted in Checkout Extensibility."),
      recommendation: getT(t, "scan.risks.window_document_access.recommendation", {}, "Migrate to Web Pixel App Extension"),
    });
  }

  // External scripts are inherently blocking or network-dependent
  risks.push({
    id: "blocking_load",
    name: getT(t, "scan.risks.blocking_load.name", {}, "Blocking Script Load"),
    severity: "low",
    points: 10,
    description: getT(t, "scan.risks.blocking_load.description", {}, "External script resource. Network latency may impact page load performance."),
    recommendation: getT(t, "scan.risks.blocking_load.recommendation", {}, "Use asynchronous loading or Web Pixel"),
  });

  return {
    risks,
    riskScore: isKnownTracker ? 40 : 10,
    detectedIssues: {
      piiAccess: false, // Cannot detect from URL
      windowDocumentAccess: isKnownTracker,
      blockingLoad: true,
      duplicateTriggers: false
    }
  };
}

function enhanceRiskDescription(risk: RiskItem, _content: string, t?: TFunction): RiskItem {
  const tipsTitle = getT(t, "scan.common.migrationTips", {}, "Migration Tips");
  
  switch (risk.id) {
    case "pii_access":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 ${tipsTitle}:\n` +
          getT(t, "scan.risks.pii_access.tips", {}, `1. Avoid reading/uploading customer sensitive information in checkout scripts\n` +
          `2. If sensitive fields must be processed, follow Shopify official paths (PCD/permissions) and compliance requirements\n` +
          `3. Use hashed data instead of plaintext\n` +
          `4. Prefer Shopify official events and API capabilities`),
        recommendation: getT(t, "scan.risks.pii_access.recommendation", {}, "Prioritize migration to Web Pixel and handle sensitive fields per Shopify official capabilities and compliance requirements"),
      };
    case "window_document_access":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 ${tipsTitle}:\n` +
          getT(t, "scan.risks.window_document_access.tips", {}, `1. Use Shopify Web Pixel API as replacement:\n` +
          `   - analytics.subscribe() instead of window event listeners\n` +
          `   - settings object instead of document config reads\n` +
          `   - Use checkout event data instead of DOM queries\n` +
          `2. If DOM operations are needed, manually migrate page logic per Shopify official capabilities\n` +
          `3. Check if third-party libraries depend on window/document and need replacement`),
        recommendation: getT(t, "scan.risks.window_document_access.recommendation", {}, "Use Shopify Web Pixel API or manually migrate page logic per Shopify official capabilities"),
      };
    case "blocking_load":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 ${tipsTitle}:\n` +
          getT(t, "scan.risks.blocking_load.tips", {}, `1. Remove document.write() and synchronous scripts\n` +
          `2. Use asynchronously loaded Web Pixel\n` +
          `3. Avoid blocking operations on the critical rendering path\n` +
          `4. Prioritize consolidating tracking logic into Web Pixel event subscriptions`),
        recommendation: getT(t, "scan.risks.blocking_load.recommendation", {}, "Migrate to async Web Pixel and reduce blocking logic"),
      };
    case "duplicate_triggers":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 ${tipsTitle}:\n` +
          getT(t, "scan.risks.duplicate_triggers.tips", {}, `1. Use event deduplication mechanism (event_id)\n` +
          `2. Ensure each event is triggered only once\n` +
          `3. Use Shopify standard events instead of custom events\n` +
          `4. Implement deduplication logic on the server side`),
        recommendation: getT(t, "scan.risks.duplicate_triggers.recommendation", {}, "Implement event deduplication mechanism and use standard event format"),
      };
    default:
      return risk;
  }
}

export function detectRisksInScripts(scripts: Array<{ content: string; id?: string }>, t?: TFunction): {
  totalRisks: RiskItem[];
  byScript: Map<string, RiskDetectionResult>;
  summary: {
    totalScripts: number;
    scriptsWithRisks: number;
    highRiskCount: number;
    mediumRiskCount: number;
    lowRiskCount: number;
  };
} {
  const byScript = new Map<string, RiskDetectionResult>();
  const allRisks: RiskItem[] = [];
  for (const script of scripts) {
    const scriptId = script.id || `script_${randomBytes(6).toString("hex")}`;
    const result = detectRisksInContent(script.content, t);
    byScript.set(scriptId, result);
    allRisks.push(...result.risks);
  }
  const highRiskCount = allRisks.filter(r => r.severity === "high").length;
  const mediumRiskCount = allRisks.filter(r => r.severity === "medium").length;
  const lowRiskCount = allRisks.filter(r => r.severity === "low").length;
  return {
    totalRisks: allRisks,
    byScript,
    summary: {
      totalScripts: scripts.length,
      scriptsWithRisks: Array.from(byScript.values()).filter(r => r.risks.length > 0).length,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
    },
  };
}

export function generateRiskSummary(detectionResult: RiskDetectionResult, t?: TFunction): {
  level: "high" | "medium" | "low" | "none";
  message: string;
  recommendations: string[];
} {
  const { risks, detectedIssues } = detectionResult;
  if (risks.length === 0) {
    return {
      level: "none",
      message: getT(t, "scan.risks.summary.none", {}, "No high-risk items detected"),
      recommendations: [],
    };
  }
  const highRisks = risks.filter(r => r.severity === "high");
  const mediumRisks = risks.filter(r => r.severity === "medium");
  let level: "high" | "medium" | "low";
  let message: string;
  if (highRisks.length > 0) {
    level = "high";
    const issues: string[] = [];
    if (detectedIssues.piiAccess) issues.push(getT(t, "scan.risks.summary.issues.piiAccess", {}, "PII access"));
    if (detectedIssues.windowDocumentAccess) issues.push(getT(t, "scan.risks.summary.issues.windowDocumentAccess", {}, "window/document access"));
    if (detectedIssues.blockingLoad) issues.push(getT(t, "scan.risks.summary.issues.blockingLoad", {}, "Blocking load"));
    message = getT(t, "scan.risks.summary.high", { count: highRisks.length, issues: issues.join(", ") }, `Detected ${highRisks.length} high-risk items: ${issues.join(", ")}`);
  } else if (mediumRisks.length > 0) {
    level = "medium";
    message = getT(t, "scan.risks.summary.medium", { count: mediumRisks.length }, `Detected ${mediumRisks.length} medium-risk items, migration recommended`);
  } else {
    level = "low";
    message = getT(t, "scan.risks.summary.low", { count: risks.length }, `Detected ${risks.length} low-risk items, optimization recommended`);
  }
  const recommendations = risks
    .filter(r => r.recommendation)
    .map(r => r.recommendation!)
    .filter((rec, index, self) => self.indexOf(rec) === index);
  return {
    level,
    message,
    recommendations,
  };
}
