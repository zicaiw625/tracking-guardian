

export type ConsentCategory = "marketing" | "analytics";

export interface PlatformConsentConfig {
  
  category: ConsentCategory;
  
  name: string;
  
  dualUse: boolean;
  
  consentReason: string;
}

/**
 * P0-07: Centralized platform consent configuration
 * 
 * This is the SINGLE SOURCE OF TRUTH for platform consent categorization.
 * All consent-related logic should use these functions instead of hardcoding.
 */
export const PLATFORM_CONSENT_CONFIG: Record<string, PlatformConsentConfig> = {
  // Marketing platforms - require marketing consent
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

  // Analytics platforms - require analytics consent
  // P0-07: GA4 is dual-use: can be analytics OR marketing depending on config
  google: {
    category: "analytics",
    name: "Google Analytics 4 (GA4)",
    dualUse: true, // Can be used for both analytics and ads conversion tracking
    consentReason: "用于网站分析和用户行为理解",
  },
  clarity: {
    category: "analytics",
    name: "Microsoft Clarity",
    dualUse: false,
    consentReason: "用于热力图和用户行为分析",
  },
};

/**
 * P0-07: Get the effective consent category for a platform
 * Takes into account dual-use platforms and explicit marketing treatment
 * 
 * @param platform - Platform identifier (e.g., "google", "meta")
 * @param treatAsMarketing - For dual-use platforms, treat as marketing (e.g., Google Ads)
 */
export function getEffectiveConsentCategory(
  platform: string,
  treatAsMarketing = false
): ConsentCategory {
  const config = PLATFORM_CONSENT_CONFIG[platform];
  
  if (!config) {
    // Unknown platforms default to marketing for safety
    return "marketing";
  }
  
  // For dual-use platforms (like Google), check the treatAsMarketing flag
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

/**
 * P0-07: Evaluate platform consent with strategy
 * 
 * This is the MAIN function that should be used for consent evaluation.
 * It handles all combinations of:
 * - Consent strategy (strict/balanced/weak)
 * - Platform type (marketing/analytics)
 * - Dual-use platforms (treatAsMarketing flag)
 * - Pixel receipt presence
 * 
 * @param platform - Platform identifier
 * @param consentStrategy - Shop's consent strategy setting
 * @param consentState - Consent state from pixel receipt (if any)
 * @param hasPixelReceipt - Whether a pixel receipt exists for this conversion
 * @param treatAsMarketing - For dual-use platforms, treat as marketing
 */
export function evaluatePlatformConsentWithStrategy(
  platform: string,
  consentStrategy: string,
  consentState: ConsentState | null,
  hasPixelReceipt: boolean,
  treatAsMarketing = false
): ConsentDecision {
  // P0-07: Use effective category that respects treatAsMarketing for dual-use platforms
  const category = getEffectiveConsentCategory(platform, treatAsMarketing);
  
  switch (consentStrategy) {
    case "strict":
      // Strict mode: MUST have pixel receipt with consent
      if (!hasPixelReceipt) {
        return {
          allowed: false,
          reason: "No pixel event received (strict mode)",
          usedConsent: "none",
        };
      }
      return evaluatePlatformConsent(platform, consentState, treatAsMarketing);
      
    case "balanced":
      // Balanced mode: 
      // - Marketing platforms: require receipt + consent
      // - Analytics platforms: allow without receipt
      if (hasPixelReceipt && consentState) {
        // If we have a receipt, check explicit denial
        if (category === "marketing" && consentState.marketing === false) {
          return {
            allowed: false,
            reason: "Marketing consent explicitly denied",
            usedConsent: "marketing",
          };
        }
        if (category === "analytics" && consentState.analytics === false) {
          return {
            allowed: false,
            reason: "Analytics consent explicitly denied",
            usedConsent: "analytics",
          };
        }
        // Consent not explicitly denied - allow
        return { allowed: true, usedConsent: category };
      }
      
      // No receipt - only allow analytics platforms
      if (category === "analytics") {
        return { 
          allowed: true, 
          usedConsent: category,
          reason: "Analytics allowed without receipt (balanced mode)",
        };
      }
      
      // Marketing platforms require receipt in balanced mode
      return {
        allowed: false,
        reason: `No pixel event received for ${platform} (balanced mode requires consent for marketing)`,
        usedConsent: "none",
      };
      
    case "weak":
      // Weak mode: always allow (for regions with implied consent)
      return { allowed: true, usedConsent: category };
      
    default:
      // Unknown strategy - default to requiring receipt
      if (hasPixelReceipt) {
        return { allowed: true, usedConsent: category };
      }
      return {
        allowed: false,
        reason: "No pixel event received",
        usedConsent: "none",
      };
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
