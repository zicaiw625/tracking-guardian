

export const PLATFORM_PATTERNS: Record<string, RegExp[]> = {

    google: [
        /gtag\s*\(/i,
        /google-analytics/i,
        /G-[A-Z0-9]{10,}/i,
        /UA-\d+-\d+/i,
    ],

    google_ads: [
        /AW-\d{9,}/i,
        /google_conversion/i,
        /googleadservices/i,
        /gtag.*conversion/i,
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

    fairing: [
        /fairing/i,
        /enquirelabs/i,
        /post-purchase-survey/i,
    ],
    kno: [
        /knocommerce/i,
        /kno\.com/i,
    ],
    zigpoll: [
        /zigpoll/i,
    ],

    carthook: [
        /carthook/i,
    ],
    aftersell: [
        /aftersell/i,
    ],
    reconvert: [
        /reconvert/i,
    ],
    zipify: [
        /zipify/i,
        /oneclickupsell/i,
    ],

    refersion: [
        /refersion/i,
    ],
    referralcandy: [
        /referralcandy/i,
    ],
    tapfiliate: [
        /tapfiliate/i,
    ],
    impact: [
        /impact\.com/i,
        /impactradius/i,
    ],
    partnerstack: [
        /partnerstack/i,
    ],

    hotjar: [
        /hotjar/i,
        /hj\s*\(/i,
    ],
    lucky_orange: [
        /luckyorange/i,
    ],
    klaviyo: [
        /klaviyo/i,
        /_learnq/i,
    ],
    attentive: [
        /attentive\.io/i,
        /attentivemobile/i,
    ],
    postscript: [
        /postscript/i,
    ],

    shopify_analytics: [
        /shopify\.analytics/i,
        /shopify.*track/i,
    ],
    segment: [
        /segment\.com/i,
        /analytics\.load/i,
    ],
    mixpanel: [
        /mixpanel/i,
        /mixpanel\.track/i,
    ],
    amplitude: [
        /amplitude/i,
        /amplitude\.init/i,
    ],
    braze: [
        /braze/i,
        /appboy/i,
    ],
    customerio: [
        /customer\.io/i,
        /customerio/i,
    ],
    sendinblue: [
        /sendinblue/i,
        /sib-api/i,
    ],
    omnisend: [
        /omnisend/i,
    ],
    yotpo: [
        /yotpo/i,
        /staticw2\.yotpo\.com/i,
    ],
    judge_me: [
        /judge\.me/i,
        /judgeme/i,
    ],
    loox: [
        /loox\.io/i,
        /loox\.app/i,
    ],
    stamped: [
        /stamped\.io/i,
    ],
    gorgias: [
        /gorgias\.io/i,
        /gorgias-chat/i,
    ],
    zendesk: [
        /zendesk\.com/i,
        /zendesk.*chat/i,
    ],
    intercom: [
        /intercom\.io/i,
        /intercom\.chat/i,
    ],
    drift: [
        /drift\.com/i,
        /drift\.chat/i,
    ],
    crisp: [
        /crisp\.chat/i,
        /crisp\.io/i,
    ],
    aftership: [
        /aftership\.com/i,
        /aftership.*track/i,
    ],
    seventeen_track: [
        /17track\.net/i,
        /17track/i,
    ],
    route: [
        /route\.app/i,
        /route.*track/i,
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
        recommendation: "本应用支持通过 Measurement Protocol 发送 GA4 转化事件",
    },
    google_ads: {
        name: "Google Ads",
        supportLevel: "unsupported",
        recommendation: "Google Ads 转化追踪建议使用 Shopify 官方 Google & YouTube 应用，它原生支持 Enhanced Conversions",
        officialApp: "https:
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
        officialApp: "https:
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
        officialApp: "https:
    },
    snapchat: {
        name: "Snapchat",
        supportLevel: "unsupported",
        recommendation: "Snapchat 转化追踪建议使用 Snapchat 官方应用",
        officialApp: "https:
    },
    twitter: {
        name: "X (Twitter)",
        supportLevel: "unsupported",
        recommendation: "X 广告转化追踪目前没有官方 Shopify 应用，可考虑使用第三方集成或手动配置",
    },

    fairing: {
        name: "Fairing (Post-purchase Survey)",
        supportLevel: "unsupported",
        recommendation: "Fairing 提供官方 Shopify 应用，支持 Checkout Extensibility。建议迁移到官方应用或使用 Checkout UI Extension",
        officialApp: "https:
    },
    kno: {
        name: "KnoCommerce (Survey)",
        supportLevel: "unsupported",
        recommendation: "KnoCommerce 有官方 Shopify 应用。如脚本是官方应用生成的，会自动迁移",
        officialApp: "https:
    },
    zigpoll: {
        name: "Zigpoll (Survey)",
        supportLevel: "unsupported",
        recommendation: "Zigpoll 提供 Checkout UI Extension 集成。建议使用官方应用",
        officialApp: "https:
    },

    carthook: {
        name: "CartHook (Post-purchase Upsell)",
        supportLevel: "unsupported",
        recommendation: "CartHook 需要迁移到 Shopify 的 post-purchase extension。建议使用官方应用",
        officialApp: "https:
    },
    aftersell: {
        name: "AfterSell (Upsell)",
        supportLevel: "unsupported",
        recommendation: "AfterSell 官方应用支持 Checkout Extensibility，建议迁移",
        officialApp: "https:
    },
    reconvert: {
        name: "ReConvert (Upsell & Thank You)",
        supportLevel: "unsupported",
        recommendation: "ReConvert 官方应用支持新版 Thank You 页面。如使用旧版脚本，需更新应用",
        officialApp: "https:
    },
    zipify: {
        name: "Zipify OneClickUpsell",
        supportLevel: "unsupported",
        recommendation: "Zipify OCU 支持 Checkout Extensibility。请确保使用最新版应用",
        officialApp: "https:
    },

    refersion: {
        name: "Refersion (Affiliate)",
        supportLevel: "unsupported",
        recommendation: "Refersion 官方应用支持服务端追踪。建议迁移到官方应用",
        officialApp: "https:
    },
    referralcandy: {
        name: "ReferralCandy",
        supportLevel: "unsupported",
        recommendation: "ReferralCandy 官方应用使用 Webhook 进行追踪，无需客户端脚本",
        officialApp: "https:
    },
    tapfiliate: {
        name: "Tapfiliate (Affiliate)",
        supportLevel: "unsupported",
        recommendation: "Tapfiliate 支持服务端集成。建议迁移到官方应用或 API 集成",
        officialApp: "https:
    },
    impact: {
        name: "impact.com (Affiliate)",
        supportLevel: "unsupported",
        recommendation: "Impact.com 支持服务端 API 集成。建议联系 Impact 支持团队了解 Shopify Checkout Extensibility 迁移方案",
    },
    partnerstack: {
        name: "PartnerStack",
        supportLevel: "unsupported",
        recommendation: "PartnerStack 支持 Webhook 集成，无需客户端脚本",
        officialApp: "https:
    },

    hotjar: {
        name: "Hotjar (Heatmaps)",
        supportLevel: "unsupported",
        recommendation: "Hotjar 是用户行为分析工具（热力图/录屏）。在 Thank You 页面升级后，需在 Shopify 主题中添加代码，或使用 Web Pixel（仅限追踪事件）",
    },
    lucky_orange: {
        name: "Lucky Orange",
        supportLevel: "unsupported",
        recommendation: "Lucky Orange 类似 Hotjar，是行为分析工具。需要在主题中添加代码",
    },
    klaviyo: {
        name: "Klaviyo",
        supportLevel: "unsupported",
        recommendation: "Klaviyo 官方 Shopify 应用使用 Webhook 进行订单追踪，客户端脚本主要用于网站追踪。建议确保使用官方应用",
        officialApp: "https:
    },
    attentive: {
        name: "Attentive (SMS)",
        supportLevel: "unsupported",
        recommendation: "Attentive 官方应用支持 Checkout Extensibility。请确保使用最新版应用",
        officialApp: "https:
    },
    postscript: {
        name: "Postscript (SMS)",
        supportLevel: "unsupported",
        recommendation: "Postscript 官方应用支持新版 Checkout。请确保使用最新版应用",
        officialApp: "https:
    },
    shopify_analytics: {
        name: "Shopify Analytics",
        supportLevel: "supported",
        recommendation: "Shopify 内置分析工具，无需迁移",
    },
    segment: {
        name: "Segment",
        supportLevel: "partial",
        recommendation: "Segment 是数据路由平台，需要检查其配置的最终目的地。建议迁移到 Web Pixel 或服务端集成",
    },
    mixpanel: {
        name: "Mixpanel",
        supportLevel: "unsupported",
        recommendation: "Mixpanel 是产品分析工具，建议在 Shopify 主题中集成或使用服务端 API",
    },
    amplitude: {
        name: "Amplitude",
        supportLevel: "unsupported",
        recommendation: "Amplitude 是产品分析工具，建议在 Shopify 主题中集成或使用服务端 API",
    },
    braze: {
        name: "Braze",
        supportLevel: "unsupported",
        recommendation: "Braze 是营销自动化平台，建议使用服务端 API 集成",
    },
    customerio: {
        name: "Customer.io",
        supportLevel: "unsupported",
        recommendation: "Customer.io 是营销自动化平台，建议使用服务端 API 集成",
    },
    sendinblue: {
        name: "Sendinblue (Brevo)",
        supportLevel: "unsupported",
        recommendation: "Sendinblue 是邮件营销平台，建议使用服务端 API 集成",
    },
    omnisend: {
        name: "Omnisend",
        supportLevel: "unsupported",
        recommendation: "Omnisend 官方应用支持 Webhook 追踪，建议使用官方应用",
        officialApp: "https:
    },
    yotpo: {
        name: "Yotpo",
        supportLevel: "unsupported",
        recommendation: "Yotpo 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    judge_me: {
        name: "Judge.me",
        supportLevel: "unsupported",
        recommendation: "Judge.me 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    loox: {
        name: "Loox",
        supportLevel: "unsupported",
        recommendation: "Loox 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    stamped: {
        name: "Stamped.io",
        supportLevel: "unsupported",
        recommendation: "Stamped.io 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    gorgias: {
        name: "Gorgias",
        supportLevel: "unsupported",
        recommendation: "Gorgias 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    zendesk: {
        name: "Zendesk",
        supportLevel: "unsupported",
        recommendation: "Zendesk 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    intercom: {
        name: "Intercom",
        supportLevel: "unsupported",
        recommendation: "Intercom 官方应用支持 Checkout Extensibility，建议使用官方应用",
        officialApp: "https:
    },
    drift: {
        name: "Drift",
        supportLevel: "unsupported",
        recommendation: "Drift 是对话营销平台，建议在 Shopify 主题中集成或使用服务端 API",
    },
    crisp: {
        name: "Crisp",
        supportLevel: "unsupported",
        recommendation: "Crisp 是客服聊天工具，建议在 Shopify 主题中集成或使用官方应用",
    },
    aftership: {
        name: "AfterShip",
        supportLevel: "unsupported",
        recommendation: "AfterShip 官方应用支持订单追踪，建议使用官方应用",
        officialApp: "https:
    },
    seventeen_track: {
        name: "17Track",
        supportLevel: "unsupported",
        recommendation: "17Track 是物流追踪服务，建议使用服务端 API 集成或官方应用",
    },
    route: {
        name: "Route",
        supportLevel: "unsupported",
        recommendation: "Route 是包裹保护和追踪服务，建议使用官方应用或服务端 API",
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

