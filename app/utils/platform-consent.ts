export type ConsentCategory = "marketing" | "analytics";

export interface PlatformConsentConfig {
  category: ConsentCategory;
  name: string;
  dualUse: boolean;
  consentReason: string;
}

export const PLATFORM_CONSENT_CONFIG: Record<string, PlatformConsentConfig> = {
  meta: {
    category: "marketing",
    name: "Meta (Facebook/Instagram)",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  tiktok: {
    category: "marketing",
    name: "TikTok",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  bing: {
    category: "marketing",
    name: "Microsoft Ads (Bing)",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  pinterest: {
    category: "marketing",
    name: "Pinterest",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  snapchat: {
    category: "marketing",
    name: "Snapchat",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  twitter: {
    category: "marketing",
    name: "Twitter/X",
    dualUse: false,
    consentReason: "用于转化追踪和广告优化",
  },
  google: {
    category: "analytics",
    name: "Google Analytics 4 (GA4)",
    dualUse: true,
    consentReason: "用于网站分析和用户行为理解",
  },
  clarity: {
    category: "analytics",
    name: "Microsoft Clarity",
    dualUse: false,
    consentReason: "用于热力图和用户行为分析",
  },
};

export function getEffectiveConsentCategory(
  platform: string,
  treatAsMarketing = false
): ConsentCategory {
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

export function evaluatePlatformConsent(
  platform: string,
  consentState: ConsentState | null,
  treatAsMarketing = false
): ConsentDecision {
  const config = PLATFORM_CONSENT_CONFIG[platform];

  if (!consentState) {
    return {
      allowed: false,
      reason: "No consent state available",
      usedConsent: "none",
    };
  }

  let category: ConsentCategory;
  if (config?.dualUse && treatAsMarketing) {
    category = "marketing";
  } else {
    category = config?.category || "marketing";
  }

  if (category === "marketing") {
    if (consentState.marketing === true) {
      return { allowed: true, usedConsent: "marketing" };
    } else if (consentState.marketing === false) {
      return {
        allowed: false,
        reason: `Marketing consent denied for ${config?.name || platform}`,
        usedConsent: "marketing",
      };
    }
    
    return {
      allowed: false,
      reason: `Marketing consent not granted for ${config?.name || platform}`,
      usedConsent: "marketing",
    };
  } else {
    if (consentState.analytics === true) {
      return { allowed: true, usedConsent: "analytics" };
    } else if (consentState.analytics === false) {
      return {
        allowed: false,
        reason: `Analytics consent denied for ${config?.name || platform}`,
        usedConsent: "analytics",
      };
    }
    
    return {
      allowed: false,
      reason: `Analytics consent not granted for ${config?.name || platform}`,
      usedConsent: "analytics",
    };
  }
}

export function evaluatePlatformConsentWithStrategy(
  platform: string,
  consentStrategy: string,
  consentState: ConsentState | null,
  hasPixelReceipt: boolean,
  treatAsMarketing = false
): ConsentDecision {
  if (consentState?.saleOfDataAllowed === false) {
    return {
      allowed: false,
      reason: "sale_of_data_opted_out",
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

export function getAllowedPlatforms(
  platforms: string[],
  consentState: ConsentState | null
): { allowed: string[]; blocked: string[]; reasons: Record<string, string> } {
  const allowed: string[] = [];
  const blocked: string[] = [];
  const reasons: Record<string, string> = {};
  
  for (const platform of platforms) {
    const decision = evaluatePlatformConsent(platform, consentState);
    if (decision.allowed) {
      allowed.push(platform);
    } else {
      blocked.push(platform);
      if (decision.reason) {
        reasons[platform] = decision.reason;
      }
    }
  }
  
  return { allowed, blocked, reasons };
}
