/**
 * P0-2: Tests for pixel consent logic (Strict-only mode)
 * 
 * After P0-2 compliance update, the pixel requires:
 * - BOTH marketing AND analytics consent (matches toml declaration)
 * - saleOfData not opted-out
 * 
 * This is stricter than before to ensure declaration-behavior consistency
 * for Shopify App Store compliance.
 */

import { describe, it, expect } from "vitest";

// Simulate the hasAnyConsent function from the pixel extension
// P0-2: Updated to require BOTH marketing AND analytics (strict mode)
function hasAnyConsent(
  marketingAllowed: boolean,
  analyticsAllowed: boolean,
  saleOfDataAllowed: boolean
): boolean {
  // Strict: require BOTH marketing AND analytics (matches toml declaration)
  const hasMarketing = marketingAllowed === true;
  const hasAnalytics = analyticsAllowed === true;
  return hasMarketing && hasAnalytics && saleOfDataAllowed;
}

describe("hasAnyConsent - P0-2 strict mode", () => {
  describe("should allow sending only when BOTH tracking types are consented", () => {
    it("allows when both marketing and analytics are true", () => {
      expect(hasAnyConsent(true, true, true)).toBe(true);
    });

    it("denies when only marketing is true (strict requires both)", () => {
      expect(hasAnyConsent(true, false, true)).toBe(false);
    });

    it("denies when only analytics is true (strict requires both)", () => {
      expect(hasAnyConsent(false, true, true)).toBe(false);
    });
  });

  describe("should deny sending when saleOfData is denied", () => {
    it("denies even with both marketing and analytics", () => {
      expect(hasAnyConsent(true, true, false)).toBe(false);
    });

    it("denies with only marketing", () => {
      expect(hasAnyConsent(true, false, false)).toBe(false);
    });

    it("denies with only analytics", () => {
      expect(hasAnyConsent(false, true, false)).toBe(false);
    });
  });

  describe("should deny when no tracking consent", () => {
    it("denies when neither marketing nor analytics", () => {
      expect(hasAnyConsent(false, false, true)).toBe(false);
    });

    it("denies when all false", () => {
      expect(hasAnyConsent(false, false, false)).toBe(false);
    });
  });
});

describe("Backend platform filtering with consent", () => {
  // Simulate the backend logic
  function shouldRecordForPlatform(
    platform: string,
    marketingConsent: boolean,
    analyticsConsent: boolean
  ): boolean {
    const marketingPlatforms = ["meta", "tiktok", "google"];
    const analyticsPlatforms = ["clarity"];
    
    if (marketingPlatforms.includes(platform)) {
      return marketingConsent;
    }
    
    if (analyticsPlatforms.includes(platform)) {
      return analyticsConsent;
    }
    
    // Unknown platform - require marketing consent as default
    return marketingConsent;
  }

  it("records Meta when marketing consent given", () => {
    expect(shouldRecordForPlatform("meta", true, false)).toBe(true);
  });

  it("skips Meta when only analytics consent", () => {
    expect(shouldRecordForPlatform("meta", false, true)).toBe(false);
  });

  it("records Clarity when analytics consent given", () => {
    expect(shouldRecordForPlatform("clarity", false, true)).toBe(true);
  });

  it("skips Clarity when only marketing consent", () => {
    expect(shouldRecordForPlatform("clarity", true, false)).toBe(false);
  });

  it("records Google when marketing consent given", () => {
    expect(shouldRecordForPlatform("google", true, false)).toBe(true);
  });
});

