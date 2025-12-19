/**
 * Platform Consent Mapping
 * 
 * P0-7: Maps platforms to consent categories (marketing vs analytics)
 * 
 * Consent Categories:
 * - marketing: Advertising/conversion platforms (Meta, TikTok, Google Ads)
 *   - Requires marketingAllowed consent
 *   - Used for retargeting, conversion optimization
 *   
 * - analytics: Analytics platforms (GA4 for pure analytics use)
 *   - Requires analyticsProcessingAllowed consent
 *   - Used for understanding user behavior without advertising intent
 * 
 * Note: Some platforms can serve both purposes:
 * - Google GA4: Primarily analytics, but can be used to export to Google Ads
 * - We classify GA4 as "analytics" by default, with option to treat as marketing
 */

// ==========================================
// Platform Classification
// ==========================================

export type ConsentCategory = "marketing" | "analytics";

export interface PlatformConsentConfig {
  /** Primary consent category for this platform */
  category: ConsentCategory;
  /** Platform display name */
  name: string;
  /** Whether this platform can be used for both categories */
  dualUse: boolean;
  /** Description of why this consent is needed */
  consentReason: string;
}

/**
 * Platform consent configuration
 * Maps each platform to its consent requirements
 */
export const PLATFORM_CONSENT_CONFIG: Record<string, PlatformConsentConfig> = {
  // Advertising/Marketing platforms - require marketing consent
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
  google: {
    category: "analytics",
    name: "Google Analytics 4 (GA4)",
    dualUse: true, // Can be used for Google Ads export
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
 * Get the consent category for a platform
 * Defaults to "marketing" for unknown platforms (safer assumption)
 */
export function getPlatformConsentCategory(platform: string): ConsentCategory {
  return PLATFORM_CONSENT_CONFIG[platform]?.category || "marketing";
}

/**
 * Check if platform is primarily a marketing platform
 */
export function isMarketingPlatform(platform: string): boolean {
  return getPlatformConsentCategory(platform) === "marketing";
}

/**
 * Check if platform is primarily an analytics platform
 */
export function isAnalyticsPlatform(platform: string): boolean {
  return getPlatformConsentCategory(platform) === "analytics";
}

// ==========================================
// Consent Evaluation
// ==========================================

export interface ConsentState {
  marketing?: boolean;
  analytics?: boolean;
}

export interface ConsentDecision {
  allowed: boolean;
  reason?: string;
  usedConsent: "marketing" | "analytics" | "none";
}

/**
 * P0-7: Evaluate consent for a specific platform
 * 
 * Strategy:
 * - For marketing platforms: Check marketingAllowed
 * - For analytics platforms: Check analyticsProcessingAllowed
 * - For dual-use platforms (like GA4): 
 *   - If configured for advertising, check marketing
 *   - If configured for pure analytics, check analytics
 * 
 * @param platform - Platform identifier (e.g., "meta", "google")
 * @param consentState - Current consent state from pixel/privacy API
 * @param treatAsMarketing - For dual-use platforms, whether to treat as marketing
 * @returns Consent decision with reason
 */
export function evaluatePlatformConsent(
  platform: string,
  consentState: ConsentState | null,
  treatAsMarketing = false
): ConsentDecision {
  const config = PLATFORM_CONSENT_CONFIG[platform];
  
  // No consent state - be conservative
  if (!consentState) {
    return {
      allowed: false,
      reason: "No consent state available",
      usedConsent: "none",
    };
  }
  
  // Determine which consent to check
  let category: ConsentCategory;
  if (config?.dualUse && treatAsMarketing) {
    // Dual-use platform configured for marketing
    category = "marketing";
  } else {
    category = config?.category || "marketing";
  }
  
  // Check the appropriate consent
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
    // marketing is undefined - treat as not consented
    return {
      allowed: false,
      reason: `Marketing consent not granted for ${config?.name || platform}`,
      usedConsent: "marketing",
    };
  } else {
    // Analytics platform
    if (consentState.analytics === true) {
      return { allowed: true, usedConsent: "analytics" };
    } else if (consentState.analytics === false) {
      return {
        allowed: false,
        reason: `Analytics consent denied for ${config?.name || platform}`,
        usedConsent: "analytics",
      };
    }
    // analytics is undefined - treat as not consented
    return {
      allowed: false,
      reason: `Analytics consent not granted for ${config?.name || platform}`,
      usedConsent: "analytics",
    };
  }
}

/**
 * P0-7: Evaluate consent for a platform with full consent strategy support
 * 
 * @param platform - Platform identifier
 * @param consentStrategy - Shop's consent strategy (strict/balanced/weak)
 * @param consentState - Consent state from pixel
 * @param hasPixelReceipt - Whether we received a pixel event
 * @returns Consent decision
 */
export function evaluatePlatformConsentWithStrategy(
  platform: string,
  consentStrategy: string,
  consentState: ConsentState | null,
  hasPixelReceipt: boolean
): ConsentDecision {
  const category = getPlatformConsentCategory(platform);
  
  switch (consentStrategy) {
    case "strict":
      // Must have pixel receipt with explicit consent
      if (!hasPixelReceipt) {
        return {
          allowed: false,
          reason: "No pixel event received (strict mode)",
          usedConsent: "none",
        };
      }
      return evaluatePlatformConsent(platform, consentState);
      
    case "balanced":
      // If we have a receipt, use its consent state
      if (hasPixelReceipt && consentState) {
        // Check if consent was explicitly denied
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
        // If consent is true or undefined (not explicitly denied), allow
        if (
          (category === "marketing" && consentState.marketing !== false) ||
          (category === "analytics" && consentState.analytics !== false)
        ) {
          return { allowed: true, usedConsent: category };
        }
      }
      // No receipt or ambiguous consent - don't send
      return {
        allowed: false,
        reason: `No pixel event received for ${platform} (balanced mode)`,
        usedConsent: "none",
      };
      
    case "weak":
      // Always allow (for regions with implied consent)
      return { allowed: true, usedConsent: category };
      
    default:
      // Default to balanced behavior
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

/**
 * Get platforms that are allowed given a consent state
 * Useful for UI to show which platforms will receive data
 */
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
