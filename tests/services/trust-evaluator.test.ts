import { describe, it, expect } from "vitest";
import { evaluateTrust } from "../../app/services/trust-evaluator.server";

describe("trust-evaluator altOrderKey fallback", () => {
  it("should extract checkout fingerprint from altOrderKey when payloadJson lacks it", () => {
    const hash = "a".repeat(64);
    const receipt = {
      id: "r1",
      shopId: "s1",
      orderKey: "123",
      altOrderKey: `checkout_${hash}`,
      originHost: null,
      pixelTimestamp: new Date(),
      createdAt: new Date(),
      eventType: "purchase",
      payloadJson: { hmacMatched: true },
      checkoutFingerprint: null,
    };
    const shop = {
      shopDomain: "test-shop.myshopify.com",
      primaryDomain: null,
      storefrontDomains: [],
      consentStrategy: "strict",
    };
    const result = evaluateTrust(receipt as any, { checkoutTokenHash: hash }, shop);
    expect(result.trustResult.trusted).toBe(true);
    expect(result.trustResult.level).toBe("trusted");
  });
});

