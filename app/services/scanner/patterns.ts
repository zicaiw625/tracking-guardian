export const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
    google: [
        /gtag\s*\(/i,
        /google-analytics/i,
        /G-[A-Z0-9]{10,}/i,
        /UA-\d+-\d+/i,
    ],
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
};
export type PlatformSupportLevel = "supported" | "partial" | "unsupported";
export interface PlatformInfo {
    name: string;
    supportLevel: PlatformSupportLevel;
    recommendation: string;
    officialApp?: string;
}
export const PLATFORM_INFO: Record<string, PlatformInfo> = {
    google: {
        name: "Google Analytics (GA4)",
        supportLevel: "supported",
        recommendation: "本应用支持通过 Web Pixel 发送 GA4 转化事件",
    },
    gtm: {
        name: "Google Tag Manager",
        supportLevel: "partial",
        recommendation: "GTM 可包含多种追踪代码。GA4 事件可通过本应用管理；广告追踪（Meta 等）建议迁移到对应官方应用",
    },
    meta: {
        name: "Meta (Facebook/Instagram)",
        supportLevel: "supported",
        recommendation: "本应用支持通过 Web Pixel 发送 Meta 转化事件",
    },
    tiktok: {
        name: "TikTok",
        supportLevel: "supported",
        recommendation: "本应用支持通过 Web Pixel 发送 TikTok 转化事件",
    },
    unknown: {
        name: "未知平台",
        supportLevel: "unsupported",
        recommendation: "无法识别的追踪代码，建议确认其用途后决定迁移方案",
    },
};
export function getPlatformInfo(platform: string): PlatformInfo {
    return PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
}
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
export function getPatternType(platform: string, pattern: RegExp): string {
    const patternStr = pattern.source;
    switch (platform) {
        case "google":
            if (patternStr.includes("gtag")) return "gtag() 函数调用";
            if (patternStr.includes("G-")) return "GA4 Measurement ID";
            if (patternStr.includes("UA-")) return "Universal Analytics (已弃用)";
            return "Google Analytics 追踪代码";
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
        default:
            return "追踪代码";
    }
}
