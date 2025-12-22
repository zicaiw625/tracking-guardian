// Platform detection patterns for tracking scripts

export const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
    google: [
        /gtag\s*\(/i,
        /google-analytics/i,
        /googletagmanager/i,
        /G-[A-Z0-9]{10,}/i,
        /AW-\d{9,}/i,
        /google_conversion/i,
        /gtm\.js/i,
        /UA-\d+-\d+/i,
    ],
    meta: [
        /fbq\s*\(/i,
        /facebook\.net\/.*fbevents/i,
        /connect\.facebook\.net/i,
        /fb-pixel/i,
        /pixel[_\-]?id['":\s]+\d{15,16}/i,
    ],
    tiktok: [
        /ttq\s*\(/i,
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
 */
export function getPatternType(platform: string, pattern: RegExp): string {
    const patternStr = pattern.source;
    switch (platform) {
        case "google":
            if (patternStr.includes("gtag")) return "gtag() 函数调用";
            if (patternStr.includes("gtm")) return "Google Tag Manager";
            if (patternStr.includes("G-")) return "GA4 Measurement ID";
            if (patternStr.includes("AW-")) return "Google Ads Conversion ID";
            if (patternStr.includes("UA-")) return "Universal Analytics (已弃用)";
            return "Google 追踪代码";
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
        default:
            return "追踪代码";
    }
}

