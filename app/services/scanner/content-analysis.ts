

import type { RiskItem, RiskSeverity } from "../../types";
import type { ScriptAnalysisResult } from "./types";
import { PLATFORM_PATTERNS, getPatternType } from "./patterns";
import { calculateRiskScore } from "./risk-assessment";
import { SCRIPT_ANALYSIS_CONFIG } from "../../utils/config";
import { sanitizeSensitiveInfo } from "../../utils/security";

const MAX_CONTENT_LENGTH = SCRIPT_ANALYSIS_CONFIG.MAX_CONTENT_LENGTH;

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
        if (uniqueMatches.some(m => /email|mail/i.test(m))) piiTypes.push("邮箱");
        if (uniqueMatches.some(m => /phone|tel/i.test(m))) piiTypes.push("电话");
        if (uniqueMatches.some(m => /address|street|city/i.test(m))) piiTypes.push("地址");
        if (uniqueMatches.some(m => /name/i.test(m))) piiTypes.push("姓名");
        if (uniqueMatches.some(m => /ssn|credit|card/i.test(m))) piiTypes.push("其他敏感信息");

        result.risks.push({
            id: "pii_access",
            name: "检测到 PII（个人身份信息）访问",
            description: `脚本可能读取客户${piiTypes.join("、")}等敏感信息，需要确保符合隐私法规（GDPR、CCPA）。Web Pixel 沙箱环境无法直接访问这些信息，需要迁移到服务端 CAPI 或使用 Shopify Customer Events API。`,
            severity: "high" as RiskSeverity,
            points: 35,
            details: `检测到 ${piiMatches.length} 处 PII 访问: ${piiTypes.join("、")}`,
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
        if (matchTypes.window.length > 0) issues.push(`window 对象访问 (${matchTypes.window.length} 处)`);
        if (matchTypes.document.length > 0) issues.push(`document 对象访问 (${matchTypes.document.length} 处)`);
        if (matchTypes.dom.length > 0) issues.push(`DOM 操作 (${matchTypes.dom.length} 处)`);

        result.risks.push({
            id: "window_document_access",
            name: "检测到 window/document 全局对象访问",
            description: "脚本使用了 window、document 或 DOM 操作。Web Pixel 运行在受限沙箱中，无法访问这些对象，需要在迁移时使用 Shopify 提供的受控 API 替代（如 analytics.subscribe、settings 等）",
            severity: "high" as RiskSeverity,
            points: 40,
            details: `检测到 ${uniqueMatches.length} 处访问: ${issues.join("、")}`,
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
            blockingTypes.push("同步脚本标签");
        }
        if (uniqueMatches.some(m => /eval|Function/i.test(m))) {
            blockingTypes.push("eval/Function");
        }
        if (uniqueMatches.some(m => /XMLHttpRequest.*false/i.test(m))) {
            blockingTypes.push("同步 XHR");
        }
        if (uniqueMatches.some(m => /while.*true/i.test(m))) {
            blockingTypes.push("可能的无限循环");
        }

        result.risks.push({
            id: "blocking_load",
            name: "检测到阻塞加载的代码",
            description: `脚本可能阻塞页面渲染，影响用户体验和页面性能。检测到：${blockingTypes.join("、")}`,
            severity: "high" as RiskSeverity,
            points: 30,
            details: `检测到 ${uniqueMatches.length} 处阻塞代码：${blockingTypes.join("、")}`,
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
        result.risks.push({
            id: "duplicate_triggers",
            name: "检测到重复触发的事件",
            description: "脚本可能多次触发相同事件，导致重复追踪和数据不准确",
            severity: "medium" as RiskSeverity,
            points: 20,
            details: `检测到 ${Array.from(eventCounts.values()).filter(c => c > 1).length} 个重复的事件调用`,
        });
    }

    if (result.identifiedPlatforms.length > 0) {
        result.risks.push({
            id: "additional_scripts_detected",
            name: "Additional Scripts 中检测到追踪代码",
            description: "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规",
            severity: "high" as RiskSeverity,
            points: 25,
            details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
        });

        if (result.identifiedPlatforms.includes("google") && contentToAnalyze.includes("UA-")) {
            result.risks.push({
                id: "legacy_ua",
                name: "使用旧版 Universal Analytics",
                description: "Universal Analytics 已于 2023 年 7 月停止处理数据，请迁移到 GA4",
                severity: "high" as RiskSeverity,
                points: 30,
            });
        }

        if (contentToAnalyze.includes("<script") && contentToAnalyze.includes("</script>")) {
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

    for (const platform of result.identifiedPlatforms) {
        switch (platform) {
            case "google":
                result.recommendations.push(
                    "🎯 **Google Analytics (GA4)**\n" +
                    "  → 迁移到: Tracking Guardian Web Pixel + 服务端 Measurement Protocol\n" +
                    "  → 操作: 在「设置」页面配置 GA4 Measurement ID 和 API Secret\n" +
                    "  → 效果: 客户端 + 服务端双通路，通常更稳定；实际归因以平台数据为准"
                );
                break;
            case "google_ads":
                result.recommendations.push(
                    "🎯 **Google Ads 转化追踪**\n" +
                    "  → 迁移到: Shopify 官方 Google & YouTube 应用\n" +
                    "  → 原因: 官方应用原生支持 Enhanced Conversions，Tracking Guardian 不支持 Google Ads CAPI\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;
            case "gtm":
                result.recommendations.push(
                    "🎯 **Google Tag Manager**\n" +
                    "  → 迁移方案取决于 GTM 内的具体标签:\n" +
                    "    • GA4 事件 → Tracking Guardian Web Pixel\n" +
                    "    • Google Ads → Shopify 官方 Google 应用\n" +
                    "    • Meta Pixel → Tracking Guardian CAPI\n" +
                    "  → 建议: 审查 GTM 容器内的标签，分别迁移到对应方案"
                );
                break;
            case "meta":
                result.recommendations.push(
                    "🎯 **Meta Pixel (Facebook/Instagram)**\n" +
                    "  → 迁移到: Tracking Guardian Web Pixel + 服务端 Conversions API\n" +
                    "  → 操作: 在「设置」页面配置 Pixel ID 和 Access Token\n" +
                    "  → 效果: 有助于提升事件匹配度；最终归因以 Meta 平台回传为准，仍可能受设备/隐私限制影响"
                );
                break;
            case "tiktok":
                result.recommendations.push(
                    "🎯 **TikTok Pixel**\n" +
                    "  → 迁移到: Tracking Guardian Web Pixel + 服务端 Events API\n" +
                    "  → 操作: 在「设置」页面配置 Pixel Code 和 Access Token\n" +
                    "  → 效果: 服务端追踪有助于提升事件匹配质量；以 TikTok 归因结果为准"
                );
                break;
            case "bing":
                result.recommendations.push(
                    "⚠️ **Microsoft Advertising (Bing UET)**\n" +
                    "  → 迁移到: Shopify 官方 Microsoft Channel 应用\n" +
                    "  → 原因: Tracking Guardian 不支持 Microsoft Ads 服务端追踪\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 备选: 在 Shopify 主题中添加 UET 标签（非 Thank you 页面可继续使用）"
                );
                break;
            case "clarity":
                result.recommendations.push(
                    "ℹ️ **Microsoft Clarity**\n" +
                    "  → 无需迁移到服务端: Clarity 是客户端会话回放/热力图工具\n" +
                    "  → 迁移方案: 在 Shopify 主题中添加 Clarity 代码\n" +
                    "  → 注意: Thank you 页面升级后，checkout.liquid 中的 Clarity 代码将失效"
                );
                break;
            case "pinterest":
                result.recommendations.push(
                    "⚠️ **Pinterest Tag**\n" +
                    "  → 迁移到: Shopify 官方 Pinterest 应用\n" +
                    "  → 原因: 官方应用支持 Pinterest Conversions API\n" +
                    "  → 链接: https://apps.shopify.com/pinterest",
                );
                break;
            case "snapchat":
                result.recommendations.push(
                    "⚠️ **Snapchat Pixel**\n" +
                    "  → 迁移到: Shopify 官方 Snapchat Ads 应用\n" +
                    "  → 链接: https://apps.shopify.com/snapchat-ads",
                );
                break;
            case "twitter":
                result.recommendations.push(
                    "⚠️ **X (Twitter) Pixel**\n" +
                    "  → 无官方 Shopify 应用\n" +
                    "  → 备选方案: 使用第三方集成或手动配置 X Conversions API"
                );
                break;

            case "fairing":
                result.recommendations.push(
                    "📋 **Fairing (Post-purchase Survey)**\n" +
                    "  → 迁移到: Fairing 官方 Shopify 应用（支持 Checkout Extensibility）\n" +
                    "  → 链接: https://apps.shopify.com/fairing",
                    "  → 注意: 如果已安装官方应用，只需更新到最新版本即可自动适配"
                );
                break;
            case "kno":
                result.recommendations.push(
                    "📋 **KnoCommerce (Survey)**\n" +
                    "  → 迁移到: KnoCommerce 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 官方应用会自动适配 Checkout Extensibility"
                );
                break;
            case "zigpoll":
                result.recommendations.push(
                    "📋 **Zigpoll (Survey)**\n" +
                    "  → 迁移到: Zigpoll 官方应用（支持 Checkout UI Extension）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;

            case "carthook":
                result.recommendations.push(
                    "🛒 **CartHook (Post-purchase Upsell)**\n" +
                    "  → 迁移到: CartHook 官方应用（支持 post-purchase extension）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 重要: Shopify 的 post-purchase 页面使用独立的 extension API"
                );
                break;
            case "aftersell":
                result.recommendations.push(
                    "🛒 **AfterSell (Upsell)**\n" +
                    "  → 迁移到: AfterSell 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 官方应用已支持 Checkout Extensibility"
                );
                break;
            case "reconvert":
                result.recommendations.push(
                    "🛒 **ReConvert (Upsell & Thank You)**\n" +
                    "  → 迁移到: ReConvert 官方应用（已支持新版 Thank You 页面）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 确保更新到最新版本"
                );
                break;
            case "zipify":
                result.recommendations.push(
                    "🛒 **Zipify OneClickUpsell**\n" +
                    "  → 迁移到: Zipify OCU 官方应用（支持 Checkout Extensibility）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;

            case "refersion":
                result.recommendations.push(
                    "🤝 **Refersion (Affiliate)**\n" +
                    "  → 迁移到: Refersion 官方应用（支持服务端追踪）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 官方应用使用 Webhook 追踪，不依赖客户端脚本"
                );
                break;
            case "referralcandy":
                result.recommendations.push(
                    "🤝 **ReferralCandy**\n" +
                    "  → 迁移到: ReferralCandy 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 官方应用使用 Webhook，无需客户端脚本"
                );
                break;
            case "tapfiliate":
                result.recommendations.push(
                    "🤝 **Tapfiliate (Affiliate)**\n" +
                    "  → 迁移到: Tapfiliate 官方应用或服务端 API 集成\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;
            case "impact":
                result.recommendations.push(
                    "🤝 **impact.com (Affiliate)**\n" +
                    "  → 建议: 联系 impact.com 支持团队了解 Shopify Checkout Extensibility 迁移方案\n" +
                    "  → impact.com 支持服务端 API 集成，可脱离客户端脚本"
                );
                break;
            case "partnerstack":
                result.recommendations.push(
                    "🤝 **PartnerStack**\n" +
                    "  → 迁移到: PartnerStack 官方应用（支持 Webhook）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;

            case "hotjar":
                result.recommendations.push(
                    "🔥 **Hotjar (Heatmaps/Recordings)**\n" +
                    "  → 迁移方案: 在 Shopify 主题中添加 Hotjar 代码\n" +
                    "  → 注意: Thank You 页面升级后，checkout.liquid 中的代码将失效\n" +
                    "  → Hotjar 是客户端行为分析工具，无法使用服务端追踪"
                );
                break;
            case "lucky_orange":
                result.recommendations.push(
                    "🔥 **Lucky Orange**\n" +
                    "  → 迁移方案: 在 Shopify 主题中添加 Lucky Orange 代码\n" +
                    "  → 类似 Hotjar，是客户端行为分析工具\n" +
                    "  → Thank You 页面升级后需要其他集成方式"
                );
                break;
            case "klaviyo":
                result.recommendations.push(
                    "📧 **Klaviyo**\n" +
                    "  → 迁移到: Klaviyo 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 官方应用使用 Webhook 追踪订单，客户端脚本主要用于网站浏览追踪"
                );
                break;
            case "attentive":
                result.recommendations.push(
                    "📱 **Attentive (SMS)**\n" +
                    "  → 迁移到: Attentive 官方应用（支持 Checkout Extensibility）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                    "  → 确保更新到最新版本"
                );
                break;
            case "postscript":
                result.recommendations.push(
                    "📱 **Postscript (SMS)**\n" +
                    "  → 迁移到: Postscript 官方应用（支持新版 Checkout）\n" +
                    "  → 链接: https://apps.shopify.com/microsoft-channel",
                );
                break;
            default:
                result.recommendations.push(
                    `ℹ️ **${platform}**\n` +
                    "  → 请确认此追踪代码的用途，并评估是否需要迁移到 Web Pixel 或服务端方案"
                );
        }
    }

    if (result.identifiedPlatforms.length === 0 && contentToAnalyze.length > 100) {
        result.recommendations.push(
            "ℹ️ **未检测到已知追踪平台**\n" +
            "  → 可能是自定义脚本、Survey 工具、Post-purchase upsell 等\n" +
            "  → 迁移方案:\n" +
            "    • Survey/表单 → Checkout UI Extension\n" +
            "    • Post-purchase upsell → Shopify 官方 post-purchase 扩展\n" +
            "    • 自定义追踪 → Custom Pixel 或 Web Pixel\n" +
            "  → 建议: 确认脚本用途后选择对应迁移方案"
        );
    }

    if (result.identifiedPlatforms.length >= 2) {
        result.recommendations.push(
            "\n📋 **迁移清单建议**:\n" +
            "  1. 优先迁移广告平台（Meta、TikTok）以避免归因数据丢失\n" +
            "  2. 配置服务端 CAPI 以提高追踪可靠性\n" +
            "  3. 验证迁移后数据正常，再删除旧脚本\n" +
            "  4. 非支持平台（Bing、Pinterest 等）使用官方应用"
        );
    }

    return result;
}

