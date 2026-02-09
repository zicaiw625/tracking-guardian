import { describe, it, expect } from "vitest";
import {
  evaluatePlatformConsentWithStrategy,
  evaluatePlatformConsent,
  isMarketingPlatform,
  isAnalyticsPlatform,
  getEffectiveConsentCategory,
  type ConsentState,
} from "../../app/utils/platform-consent";

describe("evaluatePlatformConsentWithStrategy", () => {
  describe("sale_of_data opt-out (P0-04)", () => {
    it("blocks when saleOfDataAllowed is false (strict mode)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: false
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sale_of_data_not_allowed");
    });
    it("blocks marketing platforms when saleOfDataAllowed is false (balanced mode)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: false
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sale_of_data_not_allowed");
    });
    it("allows analytics platforms when saleOfDataAllowed is false (P0-04)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: false
      };
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        "balanced",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(true);
    });
    it("blocks marketing platforms when saleOfDataAllowed is undefined (opt-out only)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
    });
    it("allows when saleOfDataAllowed is true", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(true);
    });
  });
  describe("strict mode", () => {
    it("blocks without receipt", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        false,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_receipt_strict_mode");
    });
    it("meta requires marketing=true", () => {
      const consent: ConsentState = {
        marketing: false,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.usedConsent).toBe("marketing");
    });
    it("google analytics requires analytics=true (when not treatAsMarketing)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: false,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        "strict",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.usedConsent).toBe("analytics");
    });
    it("google with treatAsMarketing requires marketing=true", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: false,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        "strict",
        consent,
        true,
        true
      );
      expect(result.allowed).toBe(true);
      expect(result.usedConsent).toBe("marketing");
    });
    it("blocks when consent is null", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "strict",
        null,
        true,
        false
      );
      expect(result.allowed).toBe(false);
    });
  });
  describe("balanced mode", () => {
    it("blocks without receipt (no longer allows analytics without receipt)", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "google",
        "balanced",
        consent,
        false,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_receipt_balanced_mode");
    });
    it("allows with receipt and consent=true", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(true);
    });
    it("blocks when consent is explicitly false", () => {
      const consent: ConsentState = {
        marketing: false,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "balanced",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(false);
    });
  });
  describe("weak mode (deprecated - falls through to default/strict)", () => {
    it("weak mode blocks when consent is null for marketing platforms", () => {
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "weak",
        null,
        false,
        false
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("sale_of_data_not_allowed (P1: undefined)");
    });
    it("weak mode with receipt and consent works like strict", () => {
      const consent: ConsentState = {
        marketing: true,
        analytics: true,
        saleOfDataAllowed: true
      };
      const result = evaluatePlatformConsentWithStrategy(
        "meta",
        "weak",
        consent,
        true,
        false
      );
      expect(result.allowed).toBe(true);
    });
  });
});

describe("evaluatePlatformConsent", () => {
  it("returns false when consentState is null", () => {
    const result = evaluatePlatformConsent("meta", null);
    expect(result.allowed).toBe(false);
    expect(result.usedConsent).toBe("none");
  });
  it("meta requires marketing consent AND saleOfData", () => {
    const consent: ConsentState = { marketing: true, analytics: false, saleOfDataAllowed: true };
    const result = evaluatePlatformConsent("meta", consent);
    expect(result.allowed).toBe(true);
    expect(result.usedConsent).toBe("marketing");
  });
  it("meta denied when saleOfData is undefined (opt-out only)", () => {
    const consent: ConsentState = { marketing: true, analytics: false };
    const result = evaluatePlatformConsent("meta", consent);
    expect(result.allowed).toBe(false);
  });
  it("google requires analytics consent (no saleOfData needed)", () => {
    const consent: ConsentState = { marketing: false, analytics: true };
    const result = evaluatePlatformConsent("google", consent);
    expect(result.allowed).toBe(true);
    expect(result.usedConsent).toBe("analytics");
  });
  it("unknown platform defaults to marketing and requires saleOfData", () => {
    const consent: ConsentState = { marketing: true, analytics: false, saleOfDataAllowed: true };
    const result = evaluatePlatformConsent("unknown_platform", consent);
    expect(result.allowed).toBe(true);
    expect(result.usedConsent).toBe("marketing");
  });
  it("unknown platform denied when saleOfData is undefined (opt-out only)", () => {
    const consent: ConsentState = { marketing: true, analytics: false };
    const result = evaluatePlatformConsent("unknown_platform", consent);
    expect(result.allowed).toBe(false);
  });
});

describe("platform category helpers", () => {
  it("isMarketingPlatform identifies marketing platforms", () => {
    expect(isMarketingPlatform("meta")).toBe(true);
    expect(isMarketingPlatform("tiktok")).toBe(true);
    expect(isMarketingPlatform("bing")).toBe(true);
  });
  it("isAnalyticsPlatform identifies analytics platforms", () => {
    expect(isAnalyticsPlatform("google")).toBe(true);
    expect(isAnalyticsPlatform("clarity")).toBe(true);
  });
  it("unknown platform is treated as marketing", () => {
    expect(isMarketingPlatform("unknown")).toBe(true);
    expect(isAnalyticsPlatform("unknown")).toBe(false);
  });
  it("getEffectiveConsentCategory returns correct category", () => {
    expect(getEffectiveConsentCategory("meta")).toBe("marketing");
    expect(getEffectiveConsentCategory("google")).toBe("analytics");
    expect(getEffectiveConsentCategory("google", true)).toBe("marketing");
  });
});
