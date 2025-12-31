
import type { RiskItem, RiskSeverity } from "../../types";
import type { ScriptAnalysisResult } from "./types";
import { analyzeScriptContent } from "./content-analysis";

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

export function detectRisksInContent(content: string): RiskDetectionResult {
  const analysis = analyzeScriptContent(content);

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

  const enhancedRisks = keyRisks.map(risk => enhanceRiskDescription(risk, content));

  return {
    risks: enhancedRisks,
    riskScore: analysis.riskScore,
    detectedIssues,
  };
}

function enhanceRiskDescription(risk: RiskItem, content: string): RiskItem {
  switch (risk.id) {
    case "pii_access":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 如果需要在服务端发送 PII，使用 Shopify Webhooks + Conversions API\n` +
          `2. 确保符合 GDPR/CCPA 要求，获得客户同意\n` +
          `3. 使用哈希后的 PII（如 SHA256）而非明文\n` +
          `4. 考虑使用 Shopify Customer Events API 获取客户数据`,
        recommendation: "迁移到服务端 CAPI 或使用 Shopify Customer Events API",
      };

    case "window_document_access":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 使用 Shopify Web Pixel API 替代：\n` +
          `   - analytics.subscribe() 替代 window 事件监听\n` +
          `   - settings 对象替代 document 配置读取\n` +
          `   - 使用 checkout 事件数据而非 DOM 查询\n` +
          `2. 如需 DOM 操作，考虑迁移到 Checkout UI Extension\n` +
          `3. 检查是否有第三方库依赖 window/document，需要替换`,
        recommendation: "使用 Shopify Web Pixel API 或迁移到 Checkout UI Extension",
      };

    case "blocking_load":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 移除 document.write() 和同步脚本\n` +
          `2. 使用异步加载的 Web Pixel\n` +
          `3. 避免在关键渲染路径上执行阻塞操作\n` +
          `4. 考虑使用服务端追踪减少客户端负担`,
        recommendation: "迁移到异步 Web Pixel 或服务端追踪",
      };

    case "duplicate_triggers":
      return {
        ...risk,
        description: `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 使用事件去重机制（event_id）\n` +
          `2. 确保每个事件只触发一次\n` +
          `3. 使用 Shopify 标准事件而非自定义事件\n` +
          `4. 在服务端实现去重逻辑`,
        recommendation: "实现事件去重机制，使用标准事件格式",
      };

    default:
      return risk;
  }
}

export function detectRisksInScripts(scripts: Array<{ content: string; id?: string }>): {
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
    const scriptId = script.id || `script_${Math.random().toString(36).substr(2, 9)}`;
    const result = detectRisksInContent(script.content);
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

export function generateRiskSummary(detectionResult: RiskDetectionResult): {
  level: "high" | "medium" | "low" | "none";
  message: string;
  recommendations: string[];
} {
  const { risks, detectedIssues } = detectionResult;

  if (risks.length === 0) {
    return {
      level: "none",
      message: "未检测到高风险项",
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
    if (detectedIssues.piiAccess) issues.push("PII 访问");
    if (detectedIssues.windowDocumentAccess) issues.push("window/document 访问");
    if (detectedIssues.blockingLoad) issues.push("阻塞加载");
    message = `检测到 ${highRisks.length} 个高风险项：${issues.join("、")}`;
  } else if (mediumRisks.length > 0) {
    level = "medium";
    message = `检测到 ${mediumRisks.length} 个中风险项，建议尽快迁移`;
  } else {
    level = "low";
    message = `检测到 ${risks.length} 个低风险项，建议优化`;
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

