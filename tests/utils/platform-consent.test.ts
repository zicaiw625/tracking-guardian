/**
 * P0-07: Consent Strategy Unit Tests
 * 
 * Tests the consent evaluation logic across all combinations:
 * - Platform types: marketing (meta, tiktok) vs analytics (google, clarity)
 * - Strategies: strict, balanced, weak
 * - Receipt status: present, absent
 * - Consent values: true, false, undefined
 * - Dual-use platforms: Google with treatAsMarketing flag
 */

import { describe, it, expect } from "vitest";
import {
  evaluatePlatformConsentWithStrategy,
  evaluatePlatformConsent,
  getEffectiveConsentCategory,
  getPlatformConsentCategory,
  isMarketingPlatform,
  isAnalyticsPlatform,
  PLATFORM_CONSENT_CONFIG,
  type ConsentState,
} from "../../app/utils/platform-consent";

describe("Platform Consent Configuration", () => {
  describe("getPlatformConsentCategory", () => {
    it("should return marketing for Meta", () => {
      expect(getPlatformConsentCategory("meta")).toBe("marketing");
    });

    it("should return marketing for TikTok", () => {
      expect(getPlatformConsentCategory("tiktok")).toBe("marketing");
    });

    it("should return analytics for Google", () => {
      expect(getPlatformConsentCategory("google")).toBe("analytics");
    });

    it("should return analytics for Clarity", () => {
      expect(getPlatformConsentCategory("clarity")).toBe("analytics");
    });

    it("should return marketing for unknown platforms (safe default)", () => {
      expect(getPlatformConsentCategory("unknown_platform")).toBe("marketing");
    });
  });

  describe("getEffectiveConsentCategory (P0-07 dual-use)", () => {
    it("should return analytics for Google by default", () => {
      expect(getEffectiveConsentCategory("google")).toBe("analytics");
    });

    it("should return marketing for Google when treatAsMarketing=true", () => {
      expect(getEffectiveConsentCategory("google", true)).toBe("marketing");
    });

    it("should ignore treatAsMarketing for non-dual-use platforms", () => {
      expect(getEffectiveConsentCategory("meta", true)).toBe("marketing");
      expect(getEffectiveConsentCategory("clarity", true)).toBe("analytics");
    });
  });

  describe("isMarketingPlatform / isAnalyticsPlatform", () => {
    it("should correctly identify marketing platforms", () => {
      expect(isMarketingPlatform("meta")).toBe(true);
      expect(isMarketingPlatform("tiktok")).toBe(true);
      expect(isMarketingPlatform("google")).toBe(false);
    });

    it("should correctly identify analytics platforms", () => {
      expect(isAnalyticsPlatform("google")).toBe(true);
      expect(isAnalyticsPlatform("clarity")).toBe(true);
      expect(isAnalyticsPlatform("meta")).toBe(false);
    });
  });
});

describe("evaluatePlatformConsentWithStrategy", () => {
  // Test matrix for strict strategy
  describe("Strict Strategy", () => {
    const strategy = "strict";

    it("should BLOCK all platforms without pixel receipt", () => {
      const platforms = ["meta", "tiktok", "google", "clarity"];
      
      for (const platform of platforms) {
        const result = evaluatePlatformConsentWithStrategy(
          platform,
          strategy,
          { marketing: true, analytics: true },
          false // no receipt
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("No pixel event received");
      }
    });

    it("should ALLOW marketing platform with receipt + marketing consent", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        strategy,
        { marketing: true },
        true
      );
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });

    it("should BLOCK marketing platform with receipt + marketing denied", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        strategy,
        { marketing: false },
        true
      );
      expect(result.allowed).toBe(false);
      expect(result.usedConsent).toBe("marketing");
    });

    it("should ALLOW analytics platform with receipt + analytics consent", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        strategy,
        { analytics: true },
        true
      );
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("analytics");
    });

    it("should BLOCK analytics platform with receipt + analytics denied", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        strategy,
        { analytics: false },
        true
      );
      expect(result.allowed).toBe(false);
    });
  });

  // Test matrix for balanced strategy
  describe("Balanced Strategy", () => {
    const strategy = "balanced";

    it("should BLOCK marketing platforms without receipt", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        strategy,
        null,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("balanced mode requires consent for marketing");
    });

    it("should ALLOW analytics platforms without receipt", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        strategy,
        null,
        false
      );
      expect(result.allowed).toBe(true);
    });

    it("should BLOCK marketing with receipt + explicit denial", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "tiktok",
        strategy,
        { marketing: false },
        true
      );
      expect(result.allowed).toBe(false);
    });

    it("should ALLOW marketing with receipt + consent", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        strategy,
        { marketing: true },
        true
      );
      expect(result.allowed).toBe(true);
    });
  });

  // Test matrix for weak strategy
  describe("Weak Strategy", () => {
    const strategy = "weak";

    it("should ALLOW all platforms regardless of receipt or consent", () => {
      const platforms = ["meta", "tiktok", "google", "clarity"];
      const consentStates: Array<ConsentState | null> = [
        null,
        { marketing: false, analytics: false },
        { marketing: true, analytics: true },
      ];

      for (const platform of platforms) {
        for (const consent of consentStates) {
          for (const hasReceipt of [true, false]) {
            const result = evaluatePlatformConsentWithStrategy(
              platform,
              strategy,
              consent,
              hasReceipt
            );
            expect(result.allowed).toBe(true);
          }
        }
      }
    });
  });

  // P0-07: Dual-use platform tests
  describe("Dual-Use Platforms (Google as Marketing)", () => {
    it("should treat Google as marketing when treatAsMarketing=true in strict mode", () => {
      // Without the flag, Google uses analytics consent
      const analyticsResult = evaluatePlatformConsentWithStrategy(
        "google",
        "strict",
        { marketing: false, analytics: true },
        true,
        false // treatAsMarketing = false
      );
      expect(analyticsResult.allowed).toBe(true);
      expect(analyticsResult.usedConsent).toBe("analytics");

      // With the flag, Google requires marketing consent
      const marketingResult = evaluatePlatformConsentWithStrategy(
        "google",
        "strict",
        { marketing: false, analytics: true },
        true,
        true // treatAsMarketing = true
      );
      expect(marketingResult.allowed).toBe(false);
      expect(marketingResult.usedConsent).toBe("marketing");
    });

    it("should block Google as marketing in balanced mode without receipt", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        "balanced",
        null,
        false, // no receipt
        true // treatAsMarketing = true
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("balanced mode requires consent for marketing");
    });
  });
});

describe("evaluatePlatformConsent (legacy function)", () => {
  it("should block when no consent state available", () => {
    const result = evaluatePlatformConsent("meta", null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No consent state");
  });

  it("should block marketing platform with undefined marketing consent", () => {
    const result = evaluatePlatformConsent("meta", { analytics: true });
    expect(result.allowed).toBe(false);
  });

  it("should allow marketing platform with explicit true", () => {
    const result = evaluatePlatformConsent("meta", { marketing: true });
    expect(result.allowed).toBe(true);
  });
});

describe("PLATFORM_CONSENT_CONFIG completeness", () => {
  it("should have config for all commonly used platforms", () => {
    const expectedPlatforms = ["meta", "tiktok", "google", "bing", "pinterest"];
    for (const platform of expectedPlatforms) {
      expect(PLATFORM_CONSENT_CONFIG[platform]).toBeDefined();
      expect(PLATFORM_CONSENT_CONFIG[platform].name).toBeTruthy();
      expect(PLATFORM_CONSENT_CONFIG[platform].category).toBeTruthy();
    }
  });

  it("should mark Google as dual-use", () => {
    expect(PLATFORM_CONSENT_CONFIG.google.dualUse).toBe(true);
  });

  it("should not mark marketing-only platforms as dual-use", () => {
    expect(PLATFORM_CONSENT_CONFIG.meta.dualUse).toBe(false);
    expect(PLATFORM_CONSENT_CONFIG.tiktok.dualUse).toBe(false);
  });
});

