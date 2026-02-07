import type { RiskItem, RiskSeverity, ScriptTag } from "../../types";
import type { EnhancedScanResult } from "./types";
import { PLATFORM_INFO, identifyPlatformFromSrc } from "./patterns";
import type { TFunction } from "i18next";

const getT = (t: TFunction | undefined, key: string, options?: any, fallback?: string): string => {
  if (t) return t(key, options) as unknown as string;
  return fallback || key;
};

interface RiskRule {
    id: string;
    name: string;
    description: string;
    severity: RiskSeverity;
    points: number;
}

export const RISK_RULES: RiskRule[] = [
    {
        id: "deprecated_script_tag",
        name: "已废弃的 ScriptTag",
        description: "使用了即将被关闭的 ScriptTag API",
        severity: "high",
        points: 30,
    },
    {
        id: "inline_tracking",
        name: "内联追踪代码",
        description: "检测到 ScriptTag 中使用传统追踪方式，建议迁移到 Web Pixel",
        severity: "medium",
        points: 20,
    },
    {
        id: "no_server_side",
        name: "建议启用服务端追踪",
        description: "仅依赖客户端追踪可能受广告拦截器和浏览器隐私设置影响",
        severity: "low",
        points: 10,
    },
    {
        id: "outdated_pixel_version",
        name: "过期的像素版本",
        description: "使用了旧版本的追踪像素代码",
        severity: "medium",
        points: 15,
    },
];

export function assessRisks(result: EnhancedScanResult, t?: TFunction): RiskItem[] {
    const risks: RiskItem[] = [];
    const seenRiskKeys = new Set<string>();
    function addRisk(risk: RiskItem, dedupeKey?: string): void {
        const key = dedupeKey || `${risk.id}_${risk.platform || ""}`;
        if (!seenRiskKeys.has(key)) {
            seenRiskKeys.add(key);
            risks.push(risk);
        }
    }
    if (result.scriptTags.length > 0) {
        const platformScriptTags: Record<string, {
            orderStatus: ScriptTag[];
            other: ScriptTag[];
        }> = {};
        for (const tag of result.scriptTags) {
            const src = tag.src || "";
            const platform = identifyPlatformFromSrc(src);
            if (!platformScriptTags[platform]) {
                platformScriptTags[platform] = { orderStatus: [], other: [] };
            }
            const displayScope = tag.display_scope || "all";
            if (displayScope === "order_status") {
                platformScriptTags[platform].orderStatus.push(tag);
            } else {
                platformScriptTags[platform].other.push(tag);
            }
        }
        for (const [platform, tags] of Object.entries(platformScriptTags)) {
            const platformName = PLATFORM_INFO[platform]?.name || platform;
            if (tags.orderStatus.length > 0) {
                addRisk({
                    id: "deprecated_script_tag_order_status",
                    name: getT(t, "scan.risks.deprecatedScriptTagOrderStatus.name", {}, "Order Status Page ScriptTag (Deprecated)"),
                    nameKey: "scan.risks.deprecatedScriptTagOrderStatus.name",
                    description: getT(t, "scan.risks.deprecatedScriptTagOrderStatus.description", { count: tags.orderStatus.length, platform: platformName }, `Detected ${tags.orderStatus.length} ScriptTags for Order Status Page (${platformName}), which is the main target of Shopify's deprecation announcement. Detection method: URL pattern matching`),
                    descriptionKey: "scan.risks.deprecatedScriptTagOrderStatus.description",
                    descriptionParams: { count: tags.orderStatus.length, platform: platformName },
                    severity: "high",
                    points: 30,
                    details: getT(t, "scan.risks.deprecatedScriptTagOrderStatus.details", { platform: platformName, count: tags.orderStatus.length }, `Platform: ${platformName}, Script Count: ${tags.orderStatus.length}`),
                    detailsKey: "scan.risks.deprecatedScriptTagOrderStatus.details",
                    detailsParams: { platform: platformName, count: tags.orderStatus.length },
                    platform,
                }, `order_status_${platform}`);
            }
            if (tags.other.length > 0) {
                addRisk({
                    id: "deprecated_script_tag",
                    name: getT(t, "scan.risks.deprecatedScriptTag.name", {}, "ScriptTag API (Migration Recommended)"),
                    nameKey: "scan.risks.deprecatedScriptTag.name",
                    description: getT(t, "scan.risks.deprecatedScriptTag.description", { count: tags.other.length, platform: platformName }, `Detected ${tags.other.length} ScriptTags (${platformName}). Migration to Web Pixel is recommended for better compatibility. Detection method: URL pattern matching`),
                    descriptionKey: "scan.risks.deprecatedScriptTag.description",
                    descriptionParams: { count: tags.other.length, platform: platformName },
                    severity: "medium",
                    points: 15,
                    details: getT(t, "scan.risks.deprecatedScriptTag.details", { platform: platformName, scope: tags.other.map(t => t.display_scope || "all").join(", ") }, `Platform: ${platformName}, Scope: ${tags.other.map(t => t.display_scope || "all").join(", ")}`),
                    detailsKey: "scan.risks.deprecatedScriptTag.details",
                    detailsParams: { platform: platformName, scope: tags.other.map(t => t.display_scope || "all").join(", ") },
                    platform,
                }, `script_tag_${platform}`);
            }
        }
    }
    if (result.identifiedPlatforms.length > 0) {
        const platformsStr = result.identifiedPlatforms.map(p => PLATFORM_INFO[p]?.name || p).join(", ");
        addRisk({
            id: "inline_tracking",
            name: getT(t, "scan.risks.inlineTracking.name", {}, "Inline Tracking Code"),
            nameKey: "scan.risks.inlineTracking.name",
            description: getT(t, "scan.risks.inlineTracking.description", {}, "Detected hardcoded tracking scripts in page source. Migration to Shopify Web Pixel is recommended. Detection method: URL pattern matching and content inference"),
            descriptionKey: "scan.risks.inlineTracking.description",
            severity: "medium",
            points: 20,
            details: getT(t, "scan.risks.inlineTracking.details", { platforms: platformsStr }, `Detected Platforms: ${platformsStr}`),
            detailsKey: "scan.risks.inlineTracking.details",
            detailsParams: { platforms: platformsStr },
        }, "inline_tracking");
    }
    const supportedPlatforms = result.identifiedPlatforms.filter(p => PLATFORM_INFO[p]?.supportLevel === "supported");
    if (supportedPlatforms.length > 0) {
        const platformsStr = supportedPlatforms.map(p => PLATFORM_INFO[p]?.name || p).join(", ");
        addRisk({
            id: "no_server_side",
            name: getT(t, "scan.risks.noServerSide.name", {}, "Server-side Tracking Recommended"),
            nameKey: "scan.risks.noServerSide.name",
            description: getT(t, "scan.risks.noServerSide.description", {}, "For detected supported platforms, enabling Conversion API is recommended to resist ad blockers and improve data accuracy"),
            descriptionKey: "scan.risks.noServerSide.description",
            severity: "low",
            points: 10,
            details: getT(t, "scan.risks.noServerSide.details", { platforms: platformsStr }, `Supported Platforms: ${platformsStr}`),
            detailsKey: "scan.risks.noServerSide.details",
            detailsParams: { platforms: platformsStr },
        }, "no_server_side");
    }
    return risks;
}

export function calculateRiskScore(riskItems: RiskItem[]): number {
    if (riskItems.length === 0) {
        return 0;
    }
    const severityWeight: Record<RiskSeverity, number> = {
        high: 1.5,
        medium: 1.0,
        low: 0.5,
    };
    const weightedPoints = riskItems.reduce((sum, item) => {
        const weight = severityWeight[item.severity] || 1.0;
        return sum + item.points * weight;
    }, 0);
    const highRiskCount = riskItems.filter(item => item.severity === "high").length;
    const mediumRiskCount = riskItems.filter(item => item.severity === "medium").length;
    let multiplier = 1.0;
    if (highRiskCount >= 3) {
        multiplier = 1.3;
    } else if (highRiskCount >= 2) {
        multiplier = 1.2;
    } else if (highRiskCount === 1 && mediumRiskCount >= 3) {
        multiplier = 1.1;
    }
    const adjustedScore = weightedPoints * multiplier;
    const maxPossibleScore = 200;
    const normalizedScore = Math.min(100, Math.round((adjustedScore / maxPossibleScore) * 100));
    return normalizedScore;
}
