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
    recommendationKey: string;
    recommendation: string; // Added back for backward compatibility (English default)
    officialApp?: string;
}
export const PLATFORM_INFO: Record<string, PlatformInfo> = {
    google: {
        name: "Google Analytics (GA4)",
        supportLevel: "supported",
        recommendationKey: "patterns.google.recommendation",
        recommendation: "This app supports sending GA4 conversion events via Web Pixel",
    },
    gtm: {
        name: "Google Tag Manager",
        supportLevel: "partial",
        recommendationKey: "patterns.gtm.recommendation",
        recommendation: "GTM may contain multiple tracking codes. GA4 events can be managed by this app; ad tracking (Meta etc.) is recommended to migrate to official apps",
    },
    meta: {
        name: "Meta (Facebook/Instagram)",
        supportLevel: "supported",
        recommendationKey: "patterns.meta.recommendation",
        recommendation: "This app supports sending Meta conversion events via Web Pixel",
    },
    tiktok: {
        name: "TikTok",
        supportLevel: "supported",
        recommendationKey: "patterns.tiktok.recommendation",
        recommendation: "This app supports sending TikTok conversion events via Web Pixel",
    },
    unknown: {
        name: "Unknown Platform",
        supportLevel: "unsupported",
        recommendationKey: "patterns.unknown.recommendation",
        recommendation: "Unrecognized tracking code, please confirm its purpose before deciding on migration",
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
            if (patternStr.includes("gtag")) return "patterns.types.gtag";
            if (patternStr.includes("G-")) return "patterns.types.ga4";
            if (patternStr.includes("UA-")) return "patterns.types.ua";
            return "patterns.types.googleAnalytics";
        case "gtm":
            if (patternStr.includes("gtm")) return "patterns.types.gtm";
            return "patterns.types.gtmCode";
        case "meta":
            if (patternStr.includes("fbq")) return "patterns.types.metaPixel";
            if (patternStr.includes("facebook")) return "patterns.types.facebookSdk";
            if (patternStr.includes("pixel")) return "patterns.types.pixelId";
            return "patterns.types.metaCode";
        case "tiktok":
            if (patternStr.includes("ttq")) return "patterns.types.tiktokPixel";
            return "patterns.types.tiktokCode";
        default:
            return "patterns.types.trackingCode";
    }
}
