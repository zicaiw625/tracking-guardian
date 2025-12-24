// Platform detection patterns for tracking scripts
// P1-1: 区分 GA4 (analytics) 和 Google Ads (marketing)

export const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
    // P1-1: Google Analytics (GA4) - 纯分析平台，本应用支持
    google: [
        /gtag\s*\(/i,
        /google-analytics/i,
        /G-[A-Z0-9]{10,}/i,  // GA4 Measurement ID
        /UA-\d+-\d+/i,       // Universal Analytics (legacy)
    ],
    // P1-1: Google Ads - 广告平台，建议使用官方应用
    google_ads: [
        /AW-\d{9,}/i,         // Google Ads Conversion ID
        /google_conversion/i,
        /googleadservices/i,
        /gtag.*conversion/i,
    ],
    // P1-1: Google Tag Manager - 可用于多种追踪，需特别说明
    gtm: [
        /googletagmanager/i,
        /gtm\.js/i,
    ],
    meta: [
        /fbq\s*\(/i,
        /facebook\.net\/.*fbevents/i,
        /connect\.facebook\.net/i,
        /fb-pixel/i,
        /pixel[_-]?id['":\s]+\d{15,16}/i,
    ],
    tiktok: [
        /ttq\s*[.(]/i,
        /tiktok.*pixel/i,
        /analytics\.tiktok\.com/i,
    ],
    bing: [
        /uetq/i,
        /bing.*uet/i,
        /bat\.bing\.com/i,
    ],
    clarity: [
        /clarity\s*\(/i,
        /clarity\.ms/i,
    ],
    pinterest: [
        /pintrk/i,
        /pinimg\.com.*tag/i,
    ],
    snapchat: [
        /snaptr/i,
        /sc-static\.net.*scevent/i,
    ],
    twitter: [
        /twq\s*\(/i,
        /twitter.*pixel/i,
        /static\.ads-twitter\.com/i,
    ],
};

// =============================================================================
// P1-1: Platform Categories and Recommendations
// =============================================================================

/**
 * P1-1: 平台类别定义
 * - supported: 本应用完全支持（可配置 CAPI）
 * - partial: 部分支持（建议使用官方应用）
 * - unsupported: 不支持（建议使用官方应用或其他方案）
 */
export type PlatformSupportLevel = "supported" | "partial" | "unsupported";

export interface PlatformInfo {
    name: string;
    supportLevel: PlatformSupportLevel;
    recommendation: string;
    officialApp?: string;
}

/**
 * P1-1: 平台信息配置
 */
export const PLATFORM_INFO: Record<string, PlatformInfo> = {
    google: {
        name: "Google Analytics (GA4)",
        supportLevel: "supported",
        recommendation: "本应用支持通过 Measurement Protocol 发送 GA4 转化事件",
    },
    google_ads: {
        name: "Google Ads",
        supportLevel: "unsupported",
        recommendation: "Google Ads 转化追踪建议使用 Shopify 官方 Google & YouTube 应用，它原生支持 Enhanced Conversions",
        officialApp: "https://apps.shopify.com/google",
    },
    gtm: {
        name: "Google Tag Manager",
        supportLevel: "partial",
        recommendation: "GTM 可包含多种追踪代码。GA4 事件可通过本应用管理；广告追踪（Google Ads、Meta 等）建议迁移到对应官方应用",
    },
    meta: {
        name: "Meta (Facebook/Instagram)",
        supportLevel: "supported",
        recommendation: "本应用支持 Meta Conversions API (CAPI)",
    },
    tiktok: {
        name: "TikTok",
        supportLevel: "supported",
        recommendation: "本应用支持 TikTok Events API",
    },
    bing: {
        name: "Microsoft Advertising (Bing)",
        supportLevel: "unsupported",
        recommendation: "Microsoft Advertising UET 建议使用 Microsoft 官方应用",
        officialApp: "https://apps.shopify.com/microsoft-channel",
    },
    clarity: {
        name: "Microsoft Clarity",
        supportLevel: "unsupported",
        recommendation: "Clarity 是用户行为分析工具，不需要转化追踪。可继续使用现有方式或通过 Web Pixel 集成",
    },
    pinterest: {
        name: "Pinterest",
        supportLevel: "unsupported",
        recommendation: "Pinterest 转化追踪建议使用 Pinterest 官方应用",
        officialApp: "https://apps.shopify.com/pinterest",
    },
    snapchat: {
        name: "Snapchat",
        supportLevel: "unsupported",
        recommendation: "Snapchat 转化追踪建议使用 Snapchat 官方应用",
        officialApp: "https://apps.shopify.com/snapchat-ads",
    },
    twitter: {
        name: "X (Twitter)",
        supportLevel: "unsupported",
        recommendation: "X 广告转化追踪目前没有官方 Shopify 应用，可考虑使用第三方集成或手动配置",
    },
    unknown: {
        name: "未知平台",
        supportLevel: "unsupported",
        recommendation: "无法识别的追踪代码，建议确认其用途后决定迁移方案",
    },
};

/**
 * P1-1: 获取平台信息
 */
export function getPlatformInfo(platform: string): PlatformInfo {
    return PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
}

/**
 * Detect platforms in the given content
 */
export function detectPlatforms(content: string): string[] {
    const detected: string[] = [];
    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                if (!detected.includes(platform)) {
                    detected.push(platform);
                }
                break;
            }
        }
    }
    return detected;
}

/**
 * Identify platform from script source URL
 */
export function identifyPlatformFromSrc(src: string): string {
    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(src)) {
                return platform;
            }
        }
    }
    return "unknown";
}

/**
 * Get pattern type description for a matched pattern
 * P1-1: 更新以反映 Google Ads / GA4 分离
 */
export function getPatternType(platform: string, pattern: RegExp): string {
    const patternStr = pattern.source;
    switch (platform) {
        case "google":
            if (patternStr.includes("gtag")) return "gtag() 函数调用";
            if (patternStr.includes("G-")) return "GA4 Measurement ID";
            if (patternStr.includes("UA-")) return "Universal Analytics (已弃用)";
            return "Google Analytics 追踪代码";
        case "google_ads":
            if (patternStr.includes("AW-")) return "Google Ads Conversion ID";
            if (patternStr.includes("google_conversion")) return "Google Ads 转化代码";
            return "Google Ads 追踪代码";
        case "gtm":
            if (patternStr.includes("gtm")) return "Google Tag Manager";
            return "GTM 追踪代码";
        case "meta":
            if (patternStr.includes("fbq")) return "Meta Pixel 函数调用";
            if (patternStr.includes("facebook")) return "Facebook SDK";
            if (patternStr.includes("pixel")) return "Pixel ID";
            return "Meta 追踪代码";
        case "tiktok":
            if (patternStr.includes("ttq")) return "TikTok Pixel 函数调用";
            return "TikTok 追踪代码";
        case "bing":
            if (patternStr.includes("uet")) return "Microsoft UET 标签";
            return "Bing 追踪代码";
        case "clarity":
            return "Microsoft Clarity";
        case "pinterest":
            return "Pinterest Tag";
        case "snapchat":
            return "Snapchat Pixel";
        case "twitter":
            return "X (Twitter) Pixel";
        default:
            return "追踪代码";
    }
}

