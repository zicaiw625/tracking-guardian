export type ConsentCategory = "marketing" | "analytics";
export interface PlatformConsentConfig {
    category: ConsentCategory;
    name: string;
    dualUse: boolean;
    consentReason: string;
    requiresSaleOfData: boolean;
}

export const PLATFORM_CONSENT_CONFIG: Record<string, PlatformConsentConfig> = {
    meta: {
        category: "marketing",
        name: "Meta (Facebook/Instagram)",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    tiktok: {
        category: "marketing",
        name: "TikTok",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    google: {
        category: "analytics",
        name: "Google Analytics 4 (GA4)",
        dualUse: true,
        consentReason: "用于网站分析和用户行为理解",
        requiresSaleOfData: false,
    },
    bing: {
        category: "marketing",
        name: "Microsoft Ads (Bing) - 不支持 CAPI",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    pinterest: {
        category: "marketing",
        name: "Pinterest",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    snapchat: {
        category: "marketing",
        name: "Snapchat",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    twitter: {
        category: "marketing",
        name: "Twitter/X",
        dualUse: false,
        consentReason: "用于转化追踪和广告优化",
        requiresSaleOfData: true,
    },
    clarity: {
        category: "analytics",
        name: "Microsoft Clarity - 客户端工具",
        dualUse: false,
        consentReason: "用于热力图和用户行为分析",
        requiresSaleOfData: false,
    },
};
export function getEffectiveConsentCategory(platform: string, treatAsMarketing = false): ConsentCategory {
    const config = PLATFORM_CONSENT_CONFIG[platform];
    if (!config) {
        return "marketing";
    }
    if (config.dualUse && treatAsMarketing) {
        return "marketing";
    }
    return config.category;
}
export function getPlatformConsentCategory(platform: string): ConsentCategory {
    return PLATFORM_CONSENT_CONFIG[platform]?.category || "marketing";
}
export function isMarketingPlatform(platform: string): boolean {
    return getPlatformConsentCategory(platform) === "marketing";
}
export function isAnalyticsPlatform(platform: string): boolean {
    return getPlatformConsentCategory(platform) === "analytics";
}
export interface ConsentState {
    marketing?: boolean;
    analytics?: boolean;
    saleOfDataAllowed?: boolean;
}
export interface ConsentDecision {
    allowed: boolean;
    reason?: string;
    usedConsent: "marketing" | "analytics" | "none";
}
export function evaluatePlatformConsent(platform: string, consentState: ConsentState | null, treatAsMarketing = false): ConsentDecision {
    const config = PLATFORM_CONSENT_CONFIG[platform];
    const platformName = config?.name || platform;
    if (!consentState) {
        return {
            allowed: false,
            reason: `No consent state available for ${platformName}`,
            usedConsent: "none",
        };
    }
    let category: ConsentCategory;
    if (config?.dualUse && treatAsMarketing) {
        category = "marketing";
    }
    else {
        category = config?.category || "marketing";
    }
    if (category === "marketing") {
        const requiresSaleOfData = config?.requiresSaleOfData ?? true;
        if (requiresSaleOfData && consentState.saleOfDataAllowed !== true) {
            return {
                allowed: false,
                reason: `Sale of data not explicitly allowed for ${platformName} (P0-04: saleOfData=${String(consentState.saleOfDataAllowed)})`,
                usedConsent: "none",
            };
        }
        if (consentState.marketing === true) {
            return { allowed: true, usedConsent: "marketing" };
        }
        else if (consentState.marketing === false) {
            return {
                allowed: false,
                reason: `Marketing consent denied for ${platformName}`,
                usedConsent: "marketing",
            };
        }
        return {
            allowed: false,
            reason: `Marketing consent not granted for ${platformName}`,
            usedConsent: "marketing",
        };
    }
    else {
        const requiresSaleOfData = config?.requiresSaleOfData ?? true;
        if (requiresSaleOfData && consentState.saleOfDataAllowed !== true) {
            return {
                allowed: false,
                reason: `Sale of data not explicitly allowed for ${platformName} (P0-04: saleOfData=${String(consentState.saleOfDataAllowed)})`,
                usedConsent: "none",
            };
        }
        if (consentState.analytics === true) {
            return { allowed: true, usedConsent: "analytics" };
        }
        else if (consentState.analytics === false) {
            return {
                allowed: false,
                reason: `Analytics consent denied for ${platformName}`,
                usedConsent: "analytics",
            };
        }
        return {
            allowed: false,
            reason: `Analytics consent not granted for ${platformName}`,
            usedConsent: "analytics",
        };
    }
}
export function evaluatePlatformConsentWithStrategy(platform: string, consentStrategy: string, consentState: ConsentState | null, hasPixelReceipt: boolean, treatAsMarketing = false): ConsentDecision {
    const config = PLATFORM_CONSENT_CONFIG[platform];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const category = getEffectiveConsentCategory(platform, treatAsMarketing);
    const requiresSaleOfData = config?.requiresSaleOfData ?? true;
    if (requiresSaleOfData && consentState?.saleOfDataAllowed !== true) {
        return {
            allowed: false,
            reason: `sale_of_data_not_allowed (P0-04: ${String(consentState?.saleOfDataAllowed)})`,
            usedConsent: "none",
        };
    }
    switch (consentStrategy) {
        case "strict": {
            if (!hasPixelReceipt) {
                return {
                    allowed: false,
                    reason: "no_receipt_strict_mode",
                    usedConsent: "none",
                };
            }
            return evaluatePlatformConsent(platform, consentState, treatAsMarketing);
        }
        case "balanced": {
            if (!hasPixelReceipt) {
                return {
                    allowed: false,
                    reason: "no_receipt_balanced_mode",
                    usedConsent: "none",
                };
            }
            return evaluatePlatformConsent(platform, consentState, treatAsMarketing);
        }
        default: {
            if (!hasPixelReceipt) {
                return {
                    allowed: false,
                    reason: "no_receipt_default_mode",
                    usedConsent: "none",
                };
            }
            return evaluatePlatformConsent(platform, consentState, treatAsMarketing);
        }
    }
}
export function getAllowedPlatforms(platforms: string[], consentState: ConsentState | null): {
    allowed: string[];
    blocked: string[];
    reasons: Record<string, string>;
} {
    const allowed: string[] = [];
    const blocked: string[] = [];
    const reasons: Record<string, string> = {};
    for (const platform of platforms) {
        const decision = evaluatePlatformConsent(platform, consentState);
        if (decision.allowed) {
            allowed.push(platform);
        }
        else {
            blocked.push(platform);
            if (decision.reason) {
                reasons[platform] = decision.reason;
            }
        }
    }
    return { allowed, blocked, reasons };
}
export function getPlatformConsentRequirements(platform: string): {
    category: ConsentCategory;
    requiresMarketing: boolean;
    requiresAnalytics: boolean;
    requiresSaleOfData: boolean;
    explanation: string;
} {
    const config = PLATFORM_CONSENT_CONFIG[platform];
    if (!config) {
        return {
            category: "marketing",
            requiresMarketing: true,
            requiresAnalytics: false,
            requiresSaleOfData: true,
            explanation: `Unknown platform "${platform}" - defaulting to marketing consent requirements`,
        };
    }
    const requiresMarketing = config.category === "marketing";
    const requiresAnalytics = config.category === "analytics";
    let explanation: string;
    if (requiresMarketing) {
        explanation = `${config.name}: 需要营销同意（marketingAllowed=true）`;
        if (config.requiresSaleOfData) {
            explanation += `，且在 saleOfDataAllowed=false 时不发送`;
        }
    }
    else {
        explanation = `${config.name}: 需要分析同意（analyticsProcessingAllowed=true）`;
    }
    return {
        category: config.category,
        requiresMarketing,
        requiresAnalytics,
        requiresSaleOfData: config.requiresSaleOfData,
        explanation,
    };
}
export function getAllPlatformConsentRequirements(): Record<string, ReturnType<typeof getPlatformConsentRequirements>> {
    const result: Record<string, ReturnType<typeof getPlatformConsentRequirements>> = {};
    for (const platform of Object.keys(PLATFORM_CONSENT_CONFIG)) {
        result[platform] = getPlatformConsentRequirements(platform);
    }
    return result;
}
