import { describe, expect, it } from "vitest";
import { verifyWithGraceWindow } from "../../app/utils/shop-access";

describe("verifyWithGraceWindow", () => {
  const baseShop = {
    id: "shop_1",
    shopDomain: "test-shop.myshopify.com",
    isActive: true,
    ingestionSecret: "active-secret",
    pendingIngestionSecret: null,
    pendingSecretIssuedAt: null,
    pendingSecretExpiry: null,
    pendingSecretMatchCount: 0,
    previousIngestionSecret: null,
    previousSecretExpiry: null,
    primaryDomain: null,
    storefrontDomains: [],
  };

  it("matches pending secret before previous secret", () => {
    const result = verifyWithGraceWindow(
      {
        ...baseShop,
        pendingIngestionSecret: "pending-secret",
        pendingSecretExpiry: new Date(Date.now() + 5 * 60 * 1000),
        previousIngestionSecret: "previous-secret",
        previousSecretExpiry: new Date(Date.now() + 5 * 60 * 1000),
      },
      (secret) => secret === "pending-secret"
    );
    expect(result.matched).toBe(true);
    expect(result.matchedSecretType).toBe("pending");
    expect(result.usedPreviousSecret).toBe(false);
  });
});
