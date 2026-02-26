import { describe, it, expect, vi } from "vitest";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  metrics: {
    silentDrop: vi.fn(),
    consentFilter: vi.fn(),
  },
}));

import {
  checkInitialConsent,
  filterPlatformsByConsent,
  type ConsentCheckResult,
} from "../../app/lib/pixel-events/consent-filter";

describe("Consent Filter - checkInitialConsent", () => {
  describe("Marketing Consent", () => {
    it("should detect marketing consent when marketing=true", () => {
      const result = checkInitialConsent({ marketing: true });
      expect(result.hasMarketingConsent).toBe(true);
      expect(result.hasAnyConsent).toBe(true);
    });
    it("should not detect marketing consent when marketing=false", () => {
      const result = checkInitialConsent({ marketing: false });
      expect(result.hasMarketingConsent).toBe(false);
    });
    it("should not detect marketing consent when marketing is undefined", () => {
      const result = checkInitialConsent({ analytics: true });
      expect(result.hasMarketingConsent).toBe(false);
    });
  });
  describe("Analytics Consent", () => {
    it("should detect analytics consent when analytics=true", () => {
      const result = checkInitialConsent({ analytics: true });
      expect(result.hasAnalyticsConsent).toBe(true);
      expect(result.hasAnyConsent).toBe(true);
    });
    it("should not detect analytics consent when analytics=false", () => {
      const result = checkInitialConsent({ analytics: false });
      expect(result.hasAnalyticsConsent).toBe(false);
    });
    it("should not detect analytics consent when analytics is undefined", () => {
      const result = checkInitialConsent({ marketing: true });
      expect(result.hasAnalyticsConsent).toBe(false);
    });
  });
  describe("Any Consent", () => {
    it("should return hasAnyConsent=true when only marketing consent", () => {
      const result = checkInitialConsent({ marketing: true, analytics: false });
      expect(result.hasAnyConsent).toBe(true);
    });
    it("should return hasAnyConsent=true when only analytics consent", () => {
      const result = checkInitialConsent({ marketing: false, analytics: true });
      expect(result.hasAnyConsent).toBe(true);
    });
    it("should return hasAnyConsent=true when both consents granted", () => {
      const result = checkInitialConsent({ marketing: true, analytics: true });
      expect(result.hasAnyConsent).toBe(true);
    });
    it("should return hasAnyConsent=false when no consents granted", () => {
      const result = checkInitialConsent({ marketing: false, analytics: false });
      expect(result.hasAnyConsent).toBe(false);
    });
    it("should return hasAnyConsent=false when consent is undefined", () => {
      const result = checkInitialConsent(undefined);
      expect(result.hasAnyConsent).toBe(false);
    });
    it("should return hasAnyConsent=false when consent is empty object", () => {
      const result = checkInitialConsent({});
      expect(result.hasAnyConsent).toBe(false);
    });
  });
  describe("P0-04: Sale of Data Opt-Out Only", () => {
    it("should only allow saleOfData when EXPLICITLY true", () => {
      const result = checkInitialConsent({ marketing: true, saleOfData: true });
      expect(result.saleOfDataAllowed).toBe(true);
    });
    it("should deny saleOfData when explicitly false", () => {
      const result = checkInitialConsent({ marketing: true, saleOfData: false });
      expect(result.saleOfDataAllowed).toBe(false);
    });
    it("should preserve undefined when saleOfData not provided", () => {
      const result = checkInitialConsent({ marketing: true });
      expect(result.saleOfDataAllowed).toBeUndefined();
    });
    it("should preserve undefined when saleOfData is null", () => {
      const result = checkInitialConsent({ marketing: true, saleOfData: null as unknown as boolean });
      expect(result.saleOfDataAllowed).toBeUndefined();
    });
    it("should preserve undefined when empty consent object", () => {
      const result = checkInitialConsent({});
      expect(result.saleOfDataAllowed).toBeUndefined();
    });
    it("should preserve undefined when consent is undefined", () => {
      const result = checkInitialConsent(undefined);
      expect(result.saleOfDataAllowed).toBeUndefined();
    });
  });
});

describe("Consent Filter - filterPlatformsByConsent", () => {
  const marketingPlatforms = [
    { platform: "meta" },
    { platform: "tiktok" },
  ];
  const analyticsPlatforms = [
    { platform: "google" },
  ];
  const mixedPlatforms = [
    { platform: "meta" },
    { platform: "google" },
    { platform: "tiktok" },
  ];
  describe("Marketing Platforms", () => {
    it("should allow all marketing platforms when marketing consent granted", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: false,
        hasAnyConsent: false,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent(marketingPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "meta" },
        { platform: "tiktok" }
      ]);
      expect(result.skippedPlatforms).toEqual([]);
    });
    it("should skip all marketing platforms when marketing consent denied", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: false,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent(marketingPlatforms, consent);
      expect(result.platformsToRecord).toEqual([]);
      expect(result.skippedPlatforms).toEqual(["meta", "tiktok"]);
    });
  });
  describe("Analytics Platforms", () => {
    it("should allow analytics platforms when analytics consent granted", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: false,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: false,
      };
      const result = filterPlatformsByConsent(analyticsPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "google" }
      ]);
      expect(result.skippedPlatforms).toEqual([]);
    });
    it("should skip analytics platforms when analytics consent denied", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: false,
        hasAnyConsent: true,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent(analyticsPlatforms, consent);
      expect(result.platformsToRecord).toEqual([]);
      expect(result.skippedPlatforms).toEqual(["google"]);
    });
  });
  describe("Mixed Platforms", () => {
    it("should correctly filter when both consents granted", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent(mixedPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "meta" },
        { platform: "google" },
        { platform: "tiktok" }
      ]);
      expect(result.skippedPlatforms).toEqual([]);
    });
    it("should only allow marketing when only marketing consent", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: false,
        hasAnyConsent: false,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent(mixedPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "meta" },
        { platform: "tiktok" }
      ]);
      expect(result.skippedPlatforms).toEqual(["google"]);
    });
    it("should only allow analytics when only analytics consent", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: false,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: false,
      };
      const result = filterPlatformsByConsent(mixedPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "google" }
      ]);
      expect(result.skippedPlatforms).toEqual(["meta", "tiktok"]);
    });
    it("should skip all when no consents", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: false,
        hasAnalyticsConsent: false,
        hasAnyConsent: false,
        saleOfDataAllowed: false,
      };
      const result = filterPlatformsByConsent(mixedPlatforms, consent);
      expect(result.platformsToRecord).toEqual([]);
      expect(result.skippedPlatforms).toEqual(["meta", "google", "tiktok"]);
    });
    it("should allow marketing platforms when marketing=true and saleOfDataAllowed=undefined (opt-out only)", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: undefined,
      };
      const result = filterPlatformsByConsent(mixedPlatforms, consent);
      expect(result.platformsToRecord).toEqual([
        { platform: "meta" },
        { platform: "google" },
        { platform: "tiktok" }
      ]);
      expect(result.skippedPlatforms).toEqual([]);
    });
  });
  describe("Empty Configurations", () => {
    it("should handle empty pixel configs array", () => {
      const consent: ConsentCheckResult = {
        hasMarketingConsent: true,
        hasAnalyticsConsent: true,
        hasAnyConsent: true,
        saleOfDataAllowed: true,
      };
      const result = filterPlatformsByConsent([], consent);
      expect(result.platformsToRecord).toEqual([]);
      expect(result.skippedPlatforms).toEqual([]);
    });
  });
});

import {
  evaluatePlatformConsent,
  evaluatePlatformConsentWithStrategy,
  getAllowedPlatforms,
  getPlatformConsentCategory,
  isMarketingPlatform,
  isAnalyticsPlatform,
  type ConsentState,
} from "../../app/utils/platform-consent";

describe("Platform Consent - evaluatePlatformConsent", () => {
  describe("Meta (Marketing Platform)", () => {
    it("should allow Meta when marketing=true and saleOfData=true", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsent("meta", consent);
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
    it("should deny Meta when marketing=false", () => {
      const consent: ConsentState = {
        marketing: false,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsent("meta", consent);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Marketing consent denied");
    });
    it("should allow Meta when saleOfData is undefined (opt-out only)", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: undefined,
      };
      const result = evaluatePlatformConsent("meta", consent);
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
  });
  describe("Google Analytics (Analytics Platform)", () => {
    it("should allow Google Analytics when analytics=true (no saleOfData required)", () => {
      const consent: ConsentState = {
        analytics: true,
        saleOfDataAllowed: false,
      };
      const result = evaluatePlatformConsent("google", consent);
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("analytics");
    });
    it("should deny Google Analytics when analytics=false", () => {
      const consent: ConsentState = {
        analytics: false,
      };
      const result = evaluatePlatformConsent("google", consent);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Analytics consent denied");
    });
    it("should deny when analytics is undefined", () => {
      const consent: ConsentState = {
        marketing: true,
      };
      const result = evaluatePlatformConsent("google", consent);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Analytics consent not granted");
    });
  });
  describe("TikTok (Marketing Platform)", () => {
    it("should allow TikTok when marketing=true and saleOfData=true", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsent("tiktok", consent);
      expect(result.allowed).toBe(true);
    });
    it("should deny TikTok when saleOfData=false", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: false,
      };
      const result = evaluatePlatformConsent("tiktok", consent);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("P1");
    });
  });
  describe("Null Consent State", () => {
    it("should deny all platforms when consent is null", () => {
      const result = evaluatePlatformConsent("meta", null);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No consent state available");
      expect(result.usedConsent).toBe("none");
    });
  });
  describe("Unknown Platforms", () => {
    it("should default to marketing requirements for unknown platforms", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsent("unknown_platform", consent);
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
  });
});

describe("Platform Consent - evaluatePlatformConsentWithStrategy", () => {
  describe("Strict Strategy", () => {
    it("should deny when no pixel receipt in strict mode", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_receipt_strict_mode");
    });
    it("should evaluate consent when pixel receipt exists in strict mode", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true
      );
      expect(result.allowed).toBe(true);
    });
  });
  describe("Balanced Strategy", () => {
    it("should deny when no pixel receipt in balanced mode", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_receipt_balanced_mode");
    });
    it("should allow when pixel receipt exists with consent", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        true
      );
      expect(result.allowed).toBe(true);
    });
  });
  describe("Default Strategy", () => {
    it("should deny when no pixel receipt in default mode", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "default",
        consent,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_receipt_default_mode");
    });
  });
  describe("P0-04: saleOfData Opt-Out Only Across Strategies", () => {
    it("should allow in strict mode when saleOfData undefined (opt-out only)", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: undefined,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true
      );
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
    it("should allow in balanced mode when saleOfData undefined (opt-out only)", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: undefined,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        true
      );
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
    it("should deny when saleOfData explicitly false", () => {
      const consent: ConsentState = {
        marketing: true,
        saleOfDataAllowed: false,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sale_of_data_not_allowed");
      expect(result.reason).toContain("P1");
    });
  });
});

describe("Platform Consent - getAllowedPlatforms", () => {
  it("should correctly filter allowed and blocked platforms", () => {
    const platforms = ["meta", "google", "tiktok"];
    const consent: ConsentState = {
      marketing: true,
      analytics: false,
      saleOfDataAllowed: true,
    };
    const result = getAllowedPlatforms(platforms, consent);
    expect(result.allowed).toEqual(["meta", "tiktok"]);
    expect(result.blocked).toEqual(["google"]);
    expect(result.reasons["google"]).toContain("Analytics consent denied");
  });
  it("should block all platforms when consent is null", () => {
    const platforms = ["meta", "google", "tiktok"];
    const result = getAllowedPlatforms(platforms, null);
    expect(result.allowed).toEqual([]);
    expect(result.blocked).toEqual(["meta", "google", "tiktok"]);
  });
  it("should handle empty platforms array", () => {
    const consent: ConsentState = { marketing: true, saleOfDataAllowed: true };
    const result = getAllowedPlatforms([], consent);
    expect(result.allowed).toEqual([]);
    expect(result.blocked).toEqual([]);
    expect(result.reasons).toEqual({});
  });
});

describe("Platform Consent - Category Detection", () => {
  describe("isMarketingPlatform", () => {
    it("should identify Meta as marketing platform", () => {
      expect(isMarketingPlatform("meta")).toBe(true);
    });
    it("should identify TikTok as marketing platform", () => {
      expect(isMarketingPlatform("tiktok")).toBe(true);
    });
    it("should not identify Google Analytics as marketing platform", () => {
      expect(isMarketingPlatform("google")).toBe(false);
    });
  });
  describe("isAnalyticsPlatform", () => {
    it("should identify Google Analytics as analytics platform", () => {
      expect(isAnalyticsPlatform("google")).toBe(true);
    });
    it("should not identify Meta as analytics platform", () => {
      expect(isAnalyticsPlatform("meta")).toBe(false);
    });
  });
  describe("getPlatformConsentCategory", () => {
    it("should return marketing for Meta", () => {
      expect(getPlatformConsentCategory("meta")).toBe("marketing");
    });
    it("should return analytics for Google Analytics", () => {
      expect(getPlatformConsentCategory("google")).toBe("analytics");
    });
    it("should default to marketing for unknown platforms", () => {
      expect(getPlatformConsentCategory("unknown")).toBe("marketing");
    });
  });
});

describe("Consent - Real-World Scenarios", () => {
  describe("GDPR Region (EU)", () => {
    it("should block marketing when only analytics granted (common EU pattern)", () => {
      const consent: ConsentState = {
        marketing: false,
        analytics: true,
        saleOfDataAllowed: false,
      };
      const metaResult = evaluatePlatformConsent("meta", consent);
      const googleResult = evaluatePlatformConsent("google", consent);
      expect(metaResult.allowed).toBe(false);
      expect(googleResult.allowed).toBe(true);
    });
  });
  describe("CCPA Region (California)", () => {
    it("should handle opt-out of sale scenario (P0-04)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: false,
      };
      const metaResult = evaluatePlatformConsent("meta", consent);
      expect(metaResult.allowed).toBe(false);
      const googleResult = evaluatePlatformConsent("google", consent);
      expect(googleResult.allowed).toBe(true);
    });
  });
  describe("Full Consent Granted", () => {
    it("should allow all platforms when full consent", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true,
      };
      const platforms = ["meta", "google", "tiktok"];
      for (const platform of platforms) {
        const result = evaluatePlatformConsent(platform, consent);
        expect(result.allowed).toBe(true);
      }
    });
  });
  describe("Consent Banner Not Interacted", () => {
    it("should block all when no interaction (undefined values)", () => {
      const consent: ConsentState = {};
      const metaResult = evaluatePlatformConsent("meta", consent);
      const googleResult = evaluatePlatformConsent("google", consent);
      expect(metaResult.allowed).toBe(false);
      expect(googleResult.allowed).toBe(false);
    });
  });
});
