// Script content analysis for scanner

import type { RiskItem, RiskSeverity } from "../../types";
import type { ScriptAnalysisResult } from "./types";
import { PLATFORM_PATTERNS, getPatternType } from "./patterns";
import { calculateRiskScore } from "./risk-assessment";

/**
 * Analyze script content for platforms and risks
 */
export function analyzeScriptContent(content: string): ScriptAnalysisResult {
    const result: ScriptAnalysisResult = {
        identifiedPlatforms: [],
        platformDetails: [],
        risks: [],
        riskScore: 0,
        recommendations: [],
    };

    if (!content || content.trim().length === 0) {
        return result;
    }

    // Find platform matches
    const platformMatches: Map<string, {
        type: string;
        pattern: string;
    }[]> = new Map();

    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match) {
                if (!platformMatches.has(platform)) {
                    platformMatches.set(platform, []);
                }
                platformMatches.get(platform)!.push({
                    type: getPatternType(platform, pattern),
                    pattern: match[0],
                });
            }
        }
    }

    // Build platform details
    for (const [platform, matches] of platformMatches.entries()) {
        result.identifiedPlatforms.push(platform);
        for (const match of matches) {
            result.platformDetails.push({
                platform,
                type: match.type,
                confidence: matches.length > 1 ? "high" : "medium",
                matchedPattern: match.pattern.substring(0, 50) + (match.pattern.length > 50 ? "..." : ""),
            });
        }
    }

    // Check for specific ID patterns
    const ga4Match = content.match(/G-[A-Z0-9]{10,}/gi);
    if (ga4Match) {
        for (const id of ga4Match) {
            if (!result.platformDetails.some(d => d.matchedPattern.includes(id))) {
                result.platformDetails.push({
                    platform: "google",
                    type: "GA4 Measurement ID",
                    confidence: "high",
                    matchedPattern: id,
                });
            }
        }
    }

    const metaPixelMatch = content.match(/(?:pixel[_-]?id|fbq\('init',)\s*['":]?\s*(\d{15,16})/gi);
    if (metaPixelMatch) {
        for (const match of metaPixelMatch) {
            const pixelId = match.match(/\d{15,16}/)?.[0];
            if (pixelId && !result.platformDetails.some(d => d.matchedPattern.includes(pixelId))) {
                result.platformDetails.push({
                    platform: "meta",
                    type: "Pixel ID",
                    confidence: "high",
                    matchedPattern: pixelId,
                });
            }
        }
    }

    // Assess risks
    if (result.identifiedPlatforms.length > 0) {
        result.risks.push({
            id: "additional_scripts_detected",
            name: "Additional Scripts 中检测到追踪代码",
            description: "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规",
            severity: "high" as RiskSeverity,
            points: 25,
            details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
        });

        // Check for legacy UA
        if (result.identifiedPlatforms.includes("google") && content.includes("UA-")) {
            result.risks.push({
                id: "legacy_ua",
                name: "使用旧版 Universal Analytics",
                description: "Universal Analytics 已于 2023 年 7 月停止处理数据，请迁移到 GA4",
                severity: "high" as RiskSeverity,
                points: 30,
            });
        }

        // Check for inline script tags
        if (content.includes("<script") && content.includes("</script>")) {
            result.risks.push({
                id: "inline_script_tags",
                name: "内联 Script 标签",
                description: "内联脚本可能影响页面加载性能，建议使用异步加载或 Web Pixel",
                severity: "medium" as RiskSeverity,
                points: 15,
            });
        }
    }

    result.riskScore = calculateRiskScore(result.risks);

    // Generate recommendations
    for (const platform of result.identifiedPlatforms) {
        switch (platform) {
            case "google":
                result.recommendations.push("将 Google Analytics/Ads 追踪迁移到我们的 Web Pixel 扩展，支持 GA4 和 Google Ads 转化追踪");
                break;
            case "meta":
                result.recommendations.push("将 Meta Pixel 迁移到我们的 Web Pixel 扩展，并启用服务端 Conversions API (CAPI) 提高追踪准确性");
                break;
            case "tiktok":
                result.recommendations.push("将 TikTok Pixel 迁移到我们的 Web Pixel 扩展，并启用 Events API 进行服务端追踪");
                break;
            case "bing":
                result.recommendations.push("将 Microsoft UET 标签迁移到我们的 Web Pixel 扩展");
                break;
            case "clarity":
                result.recommendations.push("将 Microsoft Clarity 迁移到我们的 Web Pixel 扩展");
                break;
            default:
                result.recommendations.push(`将 ${platform} 追踪代码迁移到 Web Pixel 以确保 Checkout Extensibility 兼容性`);
        }
    }

    if (result.identifiedPlatforms.length === 0 && content.length > 100) {
        result.recommendations.push("未检测到已知追踪平台。如果您使用了自定义追踪代码，请确保它与 Checkout Extensibility 兼容。");
    }

    return result;
}

