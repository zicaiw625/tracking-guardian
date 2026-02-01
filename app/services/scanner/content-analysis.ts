import type { RiskSeverity } from "../../types";
import type { ScriptAnalysisResult } from "./types";
import { PLATFORM_PATTERNS, getPatternType } from "./patterns";
import { calculateRiskScore } from "./risk-assessment";
import { SCRIPT_ANALYSIS_CONFIG } from "../../utils/config.shared";
import { sanitizeSensitiveInfo } from "../../utils/security";
import type { TFunction } from "i18next";

const MAX_CONTENT_LENGTH = SCRIPT_ANALYSIS_CONFIG.MAX_CONTENT_LENGTH;

const getT = (t: TFunction | undefined, key: string, options?: any, fallback?: string): string => {
  if (t) return t(key, options) as unknown as string;
  return fallback || key;
};

export function analyzeScriptContent(content: string, t?: TFunction): ScriptAnalysisResult {
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

    const trimmedContent = content.trim();
    let contentToAnalyze = trimmedContent;
    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
        contentToAnalyze = trimmedContent.substring(0, MAX_CONTENT_LENGTH);
    }

    const platformMatches: Map<string, {
        type: string;
        pattern: string;
    }[]> = new Map();

    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
            const match = contentToAnalyze.match(pattern);
            if (match) {
                if (!platformMatches.has(platform)) {
                    platformMatches.set(platform, []);
                }
                let matchedPattern = match[0];
                matchedPattern = sanitizeSensitiveInfo(matchedPattern);
                if (matchedPattern.length > 50) {
                    matchedPattern = matchedPattern.substring(0, 50) + "...";
                }
                platformMatches.get(platform)!.push({
                    type: getPatternType(platform, pattern),
                    pattern: matchedPattern,
                });
            }
        }
    }

    for (const [platform, matches] of platformMatches.entries()) {
        result.identifiedPlatforms.push(platform);
        for (const match of matches) {
            result.platformDetails.push({
                platform,
                type: match.type,
                confidence: matches.length > 1 ? "high" : "medium",
                matchedPattern: match.pattern,
            });
        }
    }

    const ga4Match = contentToAnalyze.match(/G-[A-Z0-9]{10,}/gi);
    if (ga4Match) {
        for (const id of ga4Match) {
            let cleanedId = sanitizeSensitiveInfo(id);
            if (cleanedId.length > 50) {
                cleanedId = cleanedId.substring(0, 50) + "...";
            }
            if (!result.platformDetails.some(d => d.matchedPattern.includes(id))) {
                result.platformDetails.push({
                    platform: "google",
                    type: "GA4 Measurement ID",
                    confidence: "high",
                    matchedPattern: cleanedId,
                });
            }
        }
    }

    const metaPixelMatch = contentToAnalyze.match(/(?:pixel[_-]?id|fbq\('init',)\s*['":]?\s*(\d{15,16})/gi);
    if (metaPixelMatch) {
        for (const match of metaPixelMatch) {
            const pixelId = match.match(/\d{15,16}/)?.[0];
            if (pixelId && !result.platformDetails.some(d => d.matchedPattern.includes(pixelId))) {
                let cleanedPixelId = sanitizeSensitiveInfo(pixelId);
                if (cleanedPixelId.length > 50) {
                    cleanedPixelId = cleanedPixelId.substring(0, 50) + "...";
                }
                result.platformDetails.push({
                    platform: "meta",
                    type: "Pixel ID",
                    confidence: "high",
                    matchedPattern: cleanedPixelId,
                });
            }
        }
    }

    const snapPixelMatch = contentToAnalyze.match(/snaptr\s*\(['"]init['"],\s*['"]?([A-Z0-9-]+)['"]?/gi);
    if (snapPixelMatch) {
        for (const match of snapPixelMatch) {
            const pixelId = match.match(/[A-Z0-9-]+/)?.[0];
            if (pixelId && !result.platformDetails.some(d => d.platform === "snapchat" && d.matchedPattern.includes(pixelId))) {
                let cleanedPixelId = sanitizeSensitiveInfo(pixelId);
                if (cleanedPixelId.length > 50) {
                    cleanedPixelId = cleanedPixelId.substring(0, 50) + "...";
                }
                result.platformDetails.push({
                    platform: "snapchat",
                    type: "Snap Pixel ID",
                    confidence: "high",
                    matchedPattern: cleanedPixelId,
                });
            }
        }
    }

    const pinterestTagMatch = contentToAnalyze.match(/pintrk\s*\(['"]load['"],\s*['"]?([A-Z0-9]+)['"]?/gi);
    if (pinterestTagMatch) {
        for (const match of pinterestTagMatch) {
            const tagId = match.match(/[A-Z0-9]+/)?.[0];
            if (tagId && !result.platformDetails.some(d => d.platform === "pinterest" && d.matchedPattern.includes(tagId))) {
                let cleanedTagId = sanitizeSensitiveInfo(tagId);
                if (cleanedTagId.length > 50) {
                    cleanedTagId = cleanedTagId.substring(0, 50) + "...";
                }
                result.platformDetails.push({
                    platform: "pinterest",
                    type: "Pinterest Tag ID",
                    confidence: "high",
                    matchedPattern: cleanedTagId,
                });
            }
        }
    }

    const tiktokPixelMatch = contentToAnalyze.match(/ttq\s*\.\s*load\s*\(['"]?([A-Z0-9]+)['"]?/gi);
    if (tiktokPixelMatch) {
        for (const match of tiktokPixelMatch) {
            const pixelId = match.match(/[A-Z0-9]+/)?.[0];
            if (pixelId && !result.platformDetails.some(d => d.platform === "tiktok" && d.matchedPattern.includes(pixelId))) {
                let cleanedPixelId = sanitizeSensitiveInfo(pixelId);
                if (cleanedPixelId.length > 50) {
                    cleanedPixelId = cleanedPixelId.substring(0, 50) + "...";
                }
                result.platformDetails.push({
                    platform: "tiktok",
                    type: "TikTok Pixel ID",
                    confidence: "high",
                    matchedPattern: cleanedPixelId,
                });
            }
        }
    }

    const piiPatterns = [
        /(?:email|e-mail|mail)\s*[:=]\s*['"]?([^'",\s@]+@[^'",\s]+)/gi,
        /customer\.(?:email|e-mail|contact_email)/gi,
        /order\.(?:email|e-mail|contact_email|customer_email)/gi,
        /checkout\.(?:email|e-mail|contact_email|customer\.email)/gi,
        /\.getAttribute\(['"]email['"]/gi,
        /\.getAttribute\(['"]e-mail['"]/gi,
        /\.email\s*[:=]/gi,
        /emailAddress/gi,
        /contactEmail/gi,
        /(?:phone|telephone|mobile|tel|phoneNumber)\s*[:=]\s*['"]?([^'",\s]+)/gi,
        /customer\.(?:phone|telephone|mobile|phone_number)/gi,
        /order\.(?:phone|telephone|mobile|billing_phone|shipping_phone)/gi,
        /checkout\.(?:phone|telephone|mobile|customer\.phone)/gi,
        /\.getAttribute\(['"]phone['"]/gi,
        /\.getAttribute\(['"]telephone['"]/gi,
        /\.phone\s*[:=]/gi,
        /phoneNumber/gi,
        /(?:address|street|city|zip|postal|postcode|addressLine1|addressLine2)\s*[:=]\s*['"]?([^'",\s]+)/gi,
        /customer\.(?:address|shipping_address|billing_address|address1|address2)/gi,
        /order\.(?:address|shipping_address|billing_address|shipping_address1|billing_address1)/gi,
        /checkout\.(?:address|shipping_address|billing_address|customer\.address)/gi,
        /\.getAttribute\(['"]address['"]/gi,
        /\.address\s*[:=]/gi,
        /shippingAddress/gi,
        /billingAddress/gi,
        /(?:first[_-]?name|last[_-]?name|full[_-]?name|name|firstName|lastName|fullName)\s*[:=]\s*['"]?([^'",\s]+)/gi,
        /customer\.(?:first_name|last_name|name|firstName|lastName)/gi,
        /order\.(?:first_name|last_name|name|billing_name|shipping_name|customer_name)/gi,
        /checkout\.(?:first_name|last_name|name|customer\.name)/gi,
        /customerName/gi,
        /billingName/gi,
        /shippingName/gi,
        /(?:ssn|social[_-]?security|credit[_-]?card|card[_-]?number|cardNumber|card_number)\s*[:=]/gi,
        /customer\.(?:ssn|credit_card|card_number)/gi,
        /order\.(?:credit_card|payment_method)/gi,
        /(?:ip[_-]?address|ipAddress|clientIp|userIp)\s*[:=]/gi,
        /(?:device[_-]?id|deviceId|device_id|fingerprint)\s*[:=]/gi,
    ];

    const piiMatches: string[] = [];
    piiPatterns.forEach(pattern => {
        const matches = contentToAnalyze.match(pattern);
        if (matches) {
            piiMatches.push(...matches.slice(0, 3));
        }
    });

    if (piiMatches.length > 0) {
        const uniqueMatches = [...new Set(piiMatches)];
        const piiTypes: string[] = [];
        // Since we are moving to translation, we can keep English keys here or use translated values if we want
        // But for display in "details", we should probably translate them too.
        // However, these are dynamically detected types.
        
        // For simplicity, let's keep hardcoded Chinese here IF t is not provided, 
        // but if t is provided, we should probably return English keys or translated values?
        // The original code had "邮箱", "电话" etc.
        // Let's use getT to translate these types if possible, or just keep them as is for now 
        // as they are inserted into the translation string via {{types}}.
        
        if (uniqueMatches.some(m => /email|mail/i.test(m))) piiTypes.push("Email");
        if (uniqueMatches.some(m => /phone|tel/i.test(m))) piiTypes.push("Phone");
        if (uniqueMatches.some(m => /address|street|city/i.test(m))) piiTypes.push("Address");
        if (uniqueMatches.some(m => /name/i.test(m))) piiTypes.push("Name");
        if (uniqueMatches.some(m => /ssn|credit|card/i.test(m))) piiTypes.push("Sensitive Info");

        const typesStr = piiTypes.join(", ");

        result.risks.push({
            id: "pii_access",
            name: getT(t, "scan.analysis.risks.pii_access.name", {}, "检测到 PII（个人身份信息）访问"),
            description: getT(t, "scan.analysis.risks.pii_access.description", { types: typesStr }, 
                `脚本可能读取客户${typesStr}等敏感信息，需要确保符合隐私法规（GDPR、CCPA）。Web Pixel 沙箱环境无法直接访问这些信息；如确需处理，请按 Shopify 官方能力与审核要求实施（PCD/权限），并最小化数据处理。`),
            severity: "high" as RiskSeverity,
            points: 35,
            details: getT(t, "scan.analysis.risks.pii_access.details", { count: piiMatches.length, types: typesStr }, 
                `检测到 ${piiMatches.length} 处 PII 访问: ${typesStr}`),
        });
    }

    const globalObjectPatterns = [
        /\bwindow\.(location|history|localStorage|sessionStorage|document|cookie|navigator|screen|innerWidth|innerHeight|outerWidth|outerHeight|scrollX|scrollY|pageXOffset|pageYOffset)/gi,
        /\bwindow\[/gi,
        /typeof\s+window/gi,
        /window\s*===/gi,
        /window\s*!==/gi,
        /window\s*&&/gi,
        /window\s*\|\|/gi,
        /\bdocument\.(getElementById|getElementsByClassName|getElementsByTagName|querySelector|querySelectorAll|body|head|title|cookie|createElement|write|writeln|addEventListener|removeEventListener|getElementsByName|createTextNode|createDocumentFragment)/gi,
        /\bdocument\[/gi,
        /typeof\s+document/gi,
        /document\s*===/gi,
        /document\s*!==/gi,
        /document\s*&&/gi,
        /document\s*\|\|/gi,
        /\.(innerHTML|outerHTML|textContent|innerText)\s*=/gi,
        /\.(appendChild|removeChild|insertBefore|replaceChild)\s*\(/gi,
        /\.(setAttribute|getAttribute|removeAttribute)\s*\(/gi,
        /\.(addEventListener|removeEventListener|attachEvent|detachEvent)\s*\(/gi,
        /\$\s*\(['"]/gi,
        /jQuery\s*\(['"]/gi,
    ];

    const windowDocumentMatches: string[] = [];
    const matchTypes = {
        window: [] as string[],
        document: [] as string[],
        dom: [] as string[],
    };

    globalObjectPatterns.forEach(pattern => {
        const matches = contentToAnalyze.match(pattern);
        if (matches) {
            windowDocumentMatches.push(...matches.slice(0, 5));
            matches.forEach(match => {
                if (/window/i.test(match)) {
                    matchTypes.window.push(match);
                } else if (/document/i.test(match)) {
                    matchTypes.document.push(match);
                } else {
                    matchTypes.dom.push(match);
                }
            });
        }
    });

    if (windowDocumentMatches.length > 0) {
        const uniqueMatches = [...new Set(windowDocumentMatches)];
        const issues: string[] = [];
        if (matchTypes.window.length > 0) issues.push(`window object (${matchTypes.window.length})`);
        if (matchTypes.document.length > 0) issues.push(`document object (${matchTypes.document.length})`);
        if (matchTypes.dom.length > 0) issues.push(`DOM operations (${matchTypes.dom.length})`);
        
        const issuesStr = issues.join(", ");

        result.risks.push({
            id: "window_document_access",
            name: getT(t, "scan.analysis.risks.window_document_access.name", {}, "检测到 window/document 全局对象访问"),
            description: getT(t, "scan.analysis.risks.window_document_access.description", {}, 
                "脚本使用了 window、document 或 DOM 操作。Web Pixel 运行在受限沙箱中，无法访问这些对象，需要在迁移时使用 Shopify 提供的受控 API 替代（如 analytics.subscribe、settings 等）"),
            severity: "high" as RiskSeverity,
            points: 40,
            details: getT(t, "scan.analysis.risks.window_document_access.details", { count: uniqueMatches.length, issues: issuesStr }, 
                `检测到 ${uniqueMatches.length} 处访问: ${issuesStr}`),
        });
    }

    const blockingPatterns = [
        /document\.write\s*\(/gi,
        /document\.writeln\s*\(/gi,
        /<script[^>]*(?!.*async)(?!.*defer)[^>]*>/gi,
        /\.innerHTML\s*=\s*['"]<script/gi,
        /\.outerHTML\s*=\s*['"]<script/gi,
        /eval\s*\(/gi,
        /new\s+Function\s*\(/gi,
        /new\s+XMLHttpRequest\s*\(\s*\)[^}]*\.open\s*\([^,]*,\s*[^,]*,\s*false/gi,
        /fetch\s*\([^)]*\)\s*\.then\s*\([^)]*\)\s*\.then\s*\([^)]*\)\s*\.catch/gi,
        /while\s*\([^)]*true[^)]*\)/gi,
        /for\s*\([^)]*\)\s*\{[^}]*while\s*\([^)]*true/gi,
        /localStorage\.(?:getItem|setItem)\s*\([^)]*\)\s*[^;]*[^a]/gi,
        /sessionStorage\.(?:getItem|setItem)\s*\([^)]*\)\s*[^;]*[^a]/gi,
        /document\.cookie\s*=\s*[^;]+/gi,
        /JSON\.parse\s*\([^)]*\)/gi,
    ];

    const blockingMatches: string[] = [];
    blockingPatterns.forEach(pattern => {
        const matches = contentToAnalyze.match(pattern);
        if (matches) {
            blockingMatches.push(...matches.slice(0, 3));
        }
    });

    if (blockingMatches.length > 0) {
        const uniqueMatches = [...new Set(blockingMatches)];
        const blockingTypes: string[] = [];
        if (uniqueMatches.some(m => /document\.write/i.test(m))) {
            blockingTypes.push("document.write");
        }
        if (uniqueMatches.some(m => /<script[^>]*(?!.*async)(?!.*defer)/i.test(m))) {
            blockingTypes.push("Sync Script Tag");
        }
        if (uniqueMatches.some(m => /eval|Function/i.test(m))) {
            blockingTypes.push("eval/Function");
        }
        if (uniqueMatches.some(m => /XMLHttpRequest.*false/i.test(m))) {
            blockingTypes.push("Sync XHR");
        }
        if (uniqueMatches.some(m => /while.*true/i.test(m))) {
            blockingTypes.push("Infinite Loop");
        }
        
        const typesStr = blockingTypes.join(", ");

        result.risks.push({
            id: "blocking_load",
            name: getT(t, "scan.analysis.risks.blocking_load.name", {}, "检测到阻塞加载的代码"),
            description: getT(t, "scan.analysis.risks.blocking_load.description", { types: typesStr }, 
                `脚本可能阻塞页面渲染，影响用户体验和页面性能。检测到：${typesStr}`),
            severity: "high" as RiskSeverity,
            points: 30,
            details: getT(t, "scan.analysis.risks.blocking_load.details", { count: uniqueMatches.length, types: typesStr }, 
                `检测到 ${uniqueMatches.length} 处阻塞代码：${typesStr}`),
        });
    }

    const duplicatePatterns = [
        /(?:fbq|gtag|ttq|pintrk|snaptr)\s*\([^)]*['"](?:track|event|purchase|pageview)['"]/gi,
    ];

    const eventCalls: string[] = [];
    for (const pattern of duplicatePatterns) {
        const matches = contentToAnalyze.match(pattern);
        if (matches) {
            eventCalls.push(...matches);
        }
    }

    const eventCounts = new Map<string, number>();
    eventCalls.forEach(call => {
        const normalized = call.toLowerCase().replace(/\s+/g, '');
        eventCounts.set(normalized, (eventCounts.get(normalized) || 0) + 1);
    });

    const hasDuplicateTriggers = Array.from(eventCounts.values()).some(count => count > 1);
    if (hasDuplicateTriggers) {
        const count = Array.from(eventCounts.values()).filter(c => c > 1).length;
        result.risks.push({
            id: "duplicate_triggers",
            name: getT(t, "scan.analysis.risks.duplicate_triggers.name", {}, "检测到重复触发的事件"),
            description: getT(t, "scan.analysis.risks.duplicate_triggers.description", {}, "脚本可能多次触发相同事件，导致重复追踪和数据不准确"),
            severity: "medium" as RiskSeverity,
            points: 20,
            details: getT(t, "scan.analysis.risks.duplicate_triggers.details", { count }, `检测到 ${count} 个重复的事件调用`),
        });
    }

    if (result.identifiedPlatforms.length > 0) {
        const platformsStr = result.identifiedPlatforms.join(", ");
        result.risks.push({
            id: "additional_scripts_detected",
            name: getT(t, "scan.analysis.risks.additional_scripts_detected.name", {}, "Additional Scripts 中检测到追踪代码"),
            description: getT(t, "scan.analysis.risks.additional_scripts_detected.description", {}, "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规"),
            severity: "high" as RiskSeverity,
            points: 25,
            details: getT(t, "scan.analysis.risks.additional_scripts_detected.details", { platforms: platformsStr }, `检测到平台: ${platformsStr}`),
        });

        if (result.identifiedPlatforms.includes("google") && contentToAnalyze.includes("UA-")) {
            result.risks.push({
                id: "legacy_ua",
                name: getT(t, "scan.analysis.risks.legacy_ua.name", {}, "使用旧版 Universal Analytics"),
                description: getT(t, "scan.analysis.risks.legacy_ua.description", {}, "Universal Analytics 已于 2023 年 7 月停止处理数据，请迁移到 GA4"),
                severity: "high" as RiskSeverity,
                points: 30,
            });
        }

        if (contentToAnalyze.includes("<script") && contentToAnalyze.includes("</script>")) {
            result.risks.push({
                id: "inline_script_tags",
                name: getT(t, "scan.analysis.risks.inline_script_tags.name", {}, "内联 Script 标签"),
                description: getT(t, "scan.analysis.risks.inline_script_tags.description", {}, "内联脚本可能影响页面加载性能，建议使用异步加载或 Web Pixel"),
                severity: "medium" as RiskSeverity,
                points: 15,
            });
        }
    }

    result.riskScore = calculateRiskScore(result.risks);

    for (const platform of result.identifiedPlatforms) {
        const key = `scan.analysis.recommendations.${platform}`;
        const fallback = `ℹ️ **${platform}**\n  → 请确认此追踪代码的用途，并评估是否需要迁移到 Web Pixel 或服务端方案`;
        
        // Check if key exists in predefined list implicitly by checking if it matches known platforms
        // Or just trust getT to return fallback if key missing (though getT doesn't check existence, t does)
        // If t is missing, getT returns fallback.
        
        // For default case logic:
        // We can just try to translate using the platform key. 
        // If translation returns the key itself (meaning missing), we can use the default recommendation.
        // But t() usually returns key if missing.
        
        let recommendation = getT(t, key, {}, "");
        if (!recommendation || recommendation === key) {
             recommendation = getT(t, "scan.analysis.recommendations.default", { platform }, fallback);
        }
        
        result.recommendations.push(recommendation);
    }

    if (result.identifiedPlatforms.length === 0 && contentToAnalyze.length > 100) {
        result.recommendations.push(
            getT(t, "scan.analysis.recommendations.unknown", {}, 
            "ℹ️ **未检测到已知追踪平台**\n" +
            "  → 可能是自定义脚本、Survey 工具、Post-purchase upsell 等\n" +
            "  → 迁移方案:\n" +
            "    • Survey/表单 → 按 Shopify 官方能力手动迁移\n" +
            "    • Post-purchase upsell → Shopify 官方 post-purchase 扩展\n" +
            "    • 自定义追踪 → Custom Pixel 或 Web Pixel\n" +
            "  → 建议: 确认脚本用途后选择对应迁移方案")
        );
    }

    if (result.identifiedPlatforms.length >= 2) {
        result.recommendations.push(
            getT(t, "scan.analysis.recommendations.checklist", {},
            "\n📋 **迁移清单建议**:\n" +
            "  1. 优先迁移广告平台（Meta、TikTok）以避免归因数据丢失\n" +
            "  2. 启用 Web Pixel 并完成测试订单验收\n" +
            "  3. 验证迁移后数据正常，再删除旧脚本\n" +
            "  4. 非支持平台（Bing、Pinterest 等）使用官方应用")
        );
    }

    return result;
}
