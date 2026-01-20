import { describe, it, expect } from "vitest";

function hasAnalyticsConsent(
  marketingAllowed: boolean,
  analyticsAllowed: boolean,
  _saleOfDataAllowed: boolean
): boolean {
  return analyticsAllowed === true;
}

describe("hasAnalyticsConsent - unified consent strategy", () => {
  describe("should allow sending when analytics consent is granted", () => {
    it("allows when analytics is true", () => {
      expect(hasAnalyticsConsent(false, true, true)).toBe(true);
    });
    it("allows when both marketing and analytics are true", () => {
      expect(hasAnalyticsConsent(true, true, true)).toBe(true);
    });
  });
  describe("should deny when analytics consent is not granted", () => {
    it("denies when only marketing is true", () => {
      expect(hasAnalyticsConsent(true, false, true)).toBe(false);
    });
    it("denies when neither marketing nor analytics", () => {
      expect(hasAnalyticsConsent(false, false, true)).toBe(false);
    });
    it("denies when all false", () => {
      expect(hasAnalyticsConsent(false, false, false)).toBe(false);
    });
  });
});

describe("Backend platform filtering with consent", () => {
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
