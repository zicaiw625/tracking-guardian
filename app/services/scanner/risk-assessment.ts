

import type { RiskItem, RiskSeverity, ScriptTag } from "../../types";
import type { EnhancedScanResult } from "./types";
import { PLATFORM_PATTERNS, PLATFORM_INFO, identifyPlatformFromSrc } from "./patterns";

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

export function assessRisks(result: EnhancedScanResult): RiskItem[] {
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
                    name: "订单状态页 ScriptTag（将被废弃）",
                    description: `检测到 ${tags.orderStatus.length} 个用于订单状态页的 ScriptTag (${platformName})，这是 Shopify 废弃公告的主要目标`,
                    severity: "high",
                    points: 30,
                    details: `平台: ${platformName}, 脚本数量: ${tags.orderStatus.length}`,
                    platform,
                }, `order_status_${platform}`);
            }

            if (tags.other.length > 0) {
                addRisk({
                    id: "deprecated_script_tag",
                    name: "ScriptTag API（建议迁移）",
                    description: `检测到 ${tags.other.length} 个 ScriptTag (${platformName})，建议迁移到 Web Pixel 以获得更好的兼容性`,
                    severity: "medium",
                    points: 15,
                    details: `平台: ${platformName}, 范围: ${tags.other.map(t => t.display_scope || "all").join(", ")}`,
                    platform,
                }, `script_tag_${platform}`);
            }
        }
    }

    if (result.identifiedPlatforms.length > 0) {

        addRisk({
            id: "inline_tracking",
            name: "内联追踪代码",
            description: "检测到页面源码中包含硬编码的追踪脚本，建议迁移到 Shopify Web Pixel",
            severity: "medium",
            points: 20,
            details: `检测到平台: ${result.identifiedPlatforms.map(p => PLATFORM_INFO[p]?.name || p).join(", ")}`,
        }, "inline_tracking");
    }

    const supportedPlatforms = result.identifiedPlatforms.filter(p => PLATFORM_INFO[p]?.supportLevel === "supported");

    if (supportedPlatforms.length > 0) {
        addRisk({
            id: "no_server_side",
            name: "建议启用服务端追踪",
            description: "对于检测到的支持平台，建议开启 Conversion API 以抵抗广告拦截和提升数据准确性",
            severity: "low",
            points: 10,
            details: `支持平台: ${supportedPlatforms.map(p => PLATFORM_INFO[p]?.name || p).join(", ")}`,
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

    return Math.min(100, Math.round(weightedPoints));
}

