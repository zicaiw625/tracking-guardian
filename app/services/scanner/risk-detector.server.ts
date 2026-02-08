import type { RiskItem } from "../../types";
import { analyzeScriptContent } from "./content-analysis";
import { randomBytes } from "crypto";

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
    piiAccess: analysis.risks.some((r) => r.id === "pii_access"),
    windowDocumentAccess: analysis.risks.some((r) => r.id === "window_document_access"),
    blockingLoad: analysis.risks.some((r) => r.id === "blocking_load"),
    duplicateTriggers: analysis.risks.some((r) => r.id === "duplicate_triggers"),
  };
  const keyRisks = analysis.risks.filter(
    (r) =>
      r.id === "pii_access" ||
      r.id === "window_document_access" ||
      r.id === "blocking_load" ||
      r.id === "duplicate_triggers"
  );
  const enhancedRisks = keyRisks.map((risk) => enhanceRiskDescription(risk, content));
  return {
    risks: enhancedRisks,
    riskScore: analysis.riskScore,
    detectedIssues,
  };
}

// P1-2: URL-based risk detection for ScriptTags (where content is not available)
export function detectRisksInUrl(url: string): RiskDetectionResult {
  const risks: RiskItem[] = [];
  const lowerUrl = url.toLowerCase();

  // Known tracking domains usually imply window/document access when loaded as ScriptTag
  const knownTrackingDomains = [
    "facebook.net",
    "connect.facebook.net",
    "google-analytics.com",
    "googletagmanager.com",
    "tiktok.com",
    "analytics.tiktok.com",
    "pinterest.com",
    "pinimg.com",
    "snapchat.com",
    "sc-static.net",
    "clarity.ms",
    "hotjar.com",
  ];

  const isKnownTracker = knownTrackingDomains.some((d) => lowerUrl.includes(d));

  if (isKnownTracker) {
    risks.push({
      id: "window_document_access", // Inferred
      name: "Window/Document Object Access",
      severity: "medium",
      points: 20,
      description:
        "External tracking script detected via URL. These scripts typically access window/document objects which is restricted in Checkout Extensibility.",
      recommendation: "Migrate to Web Pixel App Extension",
    });
  }

  // External scripts are inherently blocking or network-dependent
  risks.push({
    id: "blocking_load",
    name: "Blocking Script Load",
    severity: "low",
    points: 10,
    description: "External script resource. Network latency may impact page load performance.",
    recommendation: "Use asynchronous loading or Web Pixel",
  });

  return {
    risks,
    riskScore: isKnownTracker ? 40 : 10,
    detectedIssues: {
      piiAccess: false, // Cannot detect from URL
      windowDocumentAccess: isKnownTracker,
      blockingLoad: true,
      duplicateTriggers: false,
    },
  };
}

function enhanceRiskDescription(risk: RiskItem, _content: string): RiskItem {
  switch (risk.id) {
    case "pii_access":
      return {
        ...risk,
        description:
          `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 避免在结账页脚本中读取/上传客户敏感信息\n` +
          `2. 如确需处理敏感字段，请按 Shopify 官方路径（PCD/权限）与合规要求实施\n` +
          `3. 使用哈希后的数据而非明文\n` +
          `4. 优先使用 Shopify 官方事件与 API 能力`,
        recommendation: "优先迁移到 Web Pixel，并按 Shopify 官方能力与合规要求处理敏感字段",
      };
    case "window_document_access":
      return {
        ...risk,
        description:
          `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 使用 Shopify Web Pixel API 替代：\n` +
          `   - analytics.subscribe() 替代 window 事件监听\n` +
          `   - settings 对象替代 document 配置读取\n` +
          `   - 使用 checkout 事件数据而非 DOM 查询\n` +
          `2. 如需 DOM 操作，请按 Shopify 官方能力手动迁移页面逻辑\n` +
          `3. 检查是否有第三方库依赖 window/document，需要替换`,
        recommendation: "使用 Shopify Web Pixel API 或按 Shopify 官方能力手动迁移页面逻辑",
      };
    case "blocking_load":
      return {
        ...risk,
        description:
          `${risk.description}\n\n💡 迁移建议：\n` +
          `1. 移除 document.write() 和同步脚本\n` +
          `2. 使用异步加载的 Web Pixel\n` +
          `3. 避免在关键渲染路径上执行阻塞操作\n` +
          `4. 优先将追踪逻辑收敛到 Web Pixel 事件订阅`,
        recommendation: "迁移到异步 Web Pixel 并减少阻塞逻辑",
      };
    case "duplicate_triggers":
      return {
        ...risk,
        description:
          `${risk.description}\n\n💡 迁移建议：\n` +
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
    const scriptId = script.id || `script_${randomBytes(6).toString("hex")}`;
    const result = detectRisksInContent(script.content);
    byScript.set(scriptId, result);
    allRisks.push(...result.risks);
  }
  const highRiskCount = allRisks.filter((r) => r.severity === "high").length;
  const mediumRiskCount = allRisks.filter((r) => r.severity === "medium").length;
  const lowRiskCount = allRisks.filter((r) => r.severity === "low").length;
  return {
    totalRisks: allRisks,
    byScript,
    summary: {
      totalScripts: scripts.length,
      scriptsWithRisks: Array.from(byScript.values()).filter((r) => r.risks.length > 0).length,
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
  const highRisks = risks.filter((r) => r.severity === "high");
  const mediumRisks = risks.filter((r) => r.severity === "medium");
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
    .filter((r) => r.recommendation)
    .map((r) => r.recommendation!)
    .filter((rec, index, self) => self.indexOf(rec) === index);
  return {
    level,
    message,
    recommendations,
  };
}
