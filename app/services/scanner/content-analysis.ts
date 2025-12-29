

import type { RiskItem, RiskSeverity } from "../../types";
import type { ScriptAnalysisResult } from "./types";
import { PLATFORM_PATTERNS, getPatternType } from "./patterns";
import { calculateRiskScore } from "./risk-assessment";
import { SCRIPT_ANALYSIS_CONFIG } from "../../utils/config";
import { sanitizeSensitiveInfo } from "../../utils/security";

/**
 * 脚本内容分析配置常量
 */
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

    // 性能优化：对于大内容，先进行快速预检查
    const trimmedContent = content.trim();
    let contentToAnalyze = trimmedContent;
    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
        // 对于超大内容，只分析前 MAX_CONTENT_LENGTH 个字符
        // 这样可以避免正则匹配性能问题
        contentToAnalyze = trimmedContent.substring(0, MAX_CONTENT_LENGTH);
        // 注意：不再递归调用，直接使用截断后的内容进行分析
    }

    const platformMatches: Map<string, {
        type: string;
        pattern: string;
    }[]> = new Map();

    // 性能优化：如果只需要检测平台存在性，可以在找到第一个匹配后停止
    // 但这里我们需要收集所有匹配以生成详细信息，所以保留完整循环
    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
            const match = contentToAnalyze.match(pattern);
            if (match) {
                if (!platformMatches.has(platform)) {
                    platformMatches.set(platform, []);
                }
                // ✅ 修复：立即清理敏感信息，避免在前端显示
                let matchedPattern = match[0];
                matchedPattern = sanitizeSensitiveInfo(matchedPattern);
                // 限制长度
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
            // matchedPattern 已经在上面清理过了，直接使用
            result.platformDetails.push({
                platform,
                type: match.type,
                confidence: matches.length > 1 ? "high" : "medium",
                matchedPattern: match.pattern, // 已经是清理和截断后的值
            });
        }
    }

    const ga4Match = contentToAnalyze.match(/G-[A-Z0-9]{10,}/gi);
    if (ga4Match) {
        for (const id of ga4Match) {
            // ✅ 修复：清理敏感信息
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
                // ✅ 修复：清理敏感信息（Pixel ID 通常不是敏感信息，但为了一致性也清理）
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
                    "  → 链接: https://apps.shopify.com/google"
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
                    "  → 链接: https://apps.shopify.com/microsoft-channel\n" +
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
                    "  → 链接: https://apps.shopify.com/pinterest"
                );
                break;
            case "snapchat":
                result.recommendations.push(
                    "⚠️ **Snapchat Pixel**\n" +
                    "  → 迁移到: Shopify 官方 Snapchat Ads 应用\n" +
                    "  → 链接: https://apps.shopify.com/snapchat-ads"
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
                    "  → 链接: https://apps.shopify.com/enquire-post-purchase-surveys\n" +
                    "  → 注意: 如果已安装官方应用，只需更新到最新版本即可自动适配"
                );
                break;
            case "kno":
                result.recommendations.push(
                    "📋 **KnoCommerce (Survey)**\n" +
                    "  → 迁移到: KnoCommerce 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/kno-post-purchase-surveys\n" +
                    "  → 官方应用会自动适配 Checkout Extensibility"
                );
                break;
            case "zigpoll":
                result.recommendations.push(
                    "📋 **Zigpoll (Survey)**\n" +
                    "  → 迁移到: Zigpoll 官方应用（支持 Checkout UI Extension）\n" +
                    "  → 链接: https://apps.shopify.com/zigpoll"
                );
                break;

            case "carthook":
                result.recommendations.push(
                    "🛒 **CartHook (Post-purchase Upsell)**\n" +
                    "  → 迁移到: CartHook 官方应用（支持 post-purchase extension）\n" +
                    "  → 链接: https://apps.shopify.com/carthook\n" +
                    "  → 重要: Shopify 的 post-purchase 页面使用独立的 extension API"
                );
                break;
            case "aftersell":
                result.recommendations.push(
                    "🛒 **AfterSell (Upsell)**\n" +
                    "  → 迁移到: AfterSell 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/aftersell\n" +
                    "  → 官方应用已支持 Checkout Extensibility"
                );
                break;
            case "reconvert":
                result.recommendations.push(
                    "🛒 **ReConvert (Upsell & Thank You)**\n" +
                    "  → 迁移到: ReConvert 官方应用（已支持新版 Thank You 页面）\n" +
                    "  → 链接: https://apps.shopify.com/reconvert-upsell-cross-sell\n" +
                    "  → 确保更新到最新版本"
                );
                break;
            case "zipify":
                result.recommendations.push(
                    "🛒 **Zipify OneClickUpsell**\n" +
                    "  → 迁移到: Zipify OCU 官方应用（支持 Checkout Extensibility）\n" +
                    "  → 链接: https://apps.shopify.com/zipify-oneclickupsell"
                );
                break;

            case "refersion":
                result.recommendations.push(
                    "🤝 **Refersion (Affiliate)**\n" +
                    "  → 迁移到: Refersion 官方应用（支持服务端追踪）\n" +
                    "  → 链接: https://apps.shopify.com/refersion\n" +
                    "  → 官方应用使用 Webhook 追踪，不依赖客户端脚本"
                );
                break;
            case "referralcandy":
                result.recommendations.push(
                    "🤝 **ReferralCandy**\n" +
                    "  → 迁移到: ReferralCandy 官方应用\n" +
                    "  → 链接: https://apps.shopify.com/referralcandy\n" +
                    "  → 官方应用使用 Webhook，无需客户端脚本"
                );
                break;
            case "tapfiliate":
                result.recommendations.push(
                    "🤝 **Tapfiliate (Affiliate)**\n" +
                    "  → 迁移到: Tapfiliate 官方应用或服务端 API 集成\n" +
                    "  → 链接: https://apps.shopify.com/tapfiliate"
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
                    "  → 链接: https://apps.shopify.com/partnerstack"
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
                    "  → 链接: https://apps.shopify.com/klaviyo-email-marketing\n" +
                    "  → 官方应用使用 Webhook 追踪订单，客户端脚本主要用于网站浏览追踪"
                );
                break;
            case "attentive":
                result.recommendations.push(
                    "📱 **Attentive (SMS)**\n" +
                    "  → 迁移到: Attentive 官方应用（支持 Checkout Extensibility）\n" +
                    "  → 链接: https://apps.shopify.com/attentive\n" +
                    "  → 确保更新到最新版本"
                );
                break;
            case "postscript":
                result.recommendations.push(
                    "📱 **Postscript (SMS)**\n" +
                    "  → 迁移到: Postscript 官方应用（支持新版 Checkout）\n" +
                    "  → 链接: https://apps.shopify.com/postscript-sms-marketing"
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

