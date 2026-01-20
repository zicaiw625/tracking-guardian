import { describe, it, expect } from "vitest";
import {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  extractOriginHost,
  buildShopAllowedDomains,
} from "../../app/utils/receipt-trust";

describe("verifyReceiptTrust", () => {
  describe("P0-1: Checkout token binding", () => {
    it("should return trusted when checkout tokens match", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
      });
      expect(result.trusted).toBe(true);
      expect(result.level).toBe("trusted");
      expect(result.reason).toBeUndefined();
    });
    it("should return untrusted when checkout tokens mismatch", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "xyz789",
        ingestionKeyMatched: true,
        receiptExists: true,
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("untrusted");
      expect(result.reason).toBe("checkout_token_mismatch");
    });
    it("should return partial when receipt has no checkout token", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: null,
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("partial");
      expect(result.reason).toBe("missing_checkout_token");
    });
    it("should return partial when webhook has no checkout token", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: null,
        ingestionKeyMatched: true,
        receiptExists: true,
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("partial");
      expect(result.reason).toBe("missing_checkout_token");
    });
  });
  describe("Receipt existence", () => {
    it("should return untrusted when receipt does not exist", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: null,
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: false,
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("untrusted");
      expect(result.reason).toBe("receipt_not_found");
    });
  });
  describe("Ingestion key validation", () => {
    it("should return untrusted when ingestion key not matched", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: false,
        receiptExists: true,
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("untrusted");
      expect(result.reason).toBe("ingestion_key_invalid");
    });
  });
  describe("Origin validation (strict mode)", () => {
    it("should return trusted when origin is in allowlist", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
        receiptOriginHost: "example.com",
        allowedDomains: ["example.com"],
        options: { strictOriginValidation: true },
      });
      expect(result.trusted).toBe(true);
      expect(result.level).toBe("trusted");
    });
    it("should return partial when origin not in allowlist (strict mode)", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
        receiptOriginHost: "malicious.com",
        allowedDomains: ["example.com"],
        options: { strictOriginValidation: true },
      });
      expect(result.trusted).toBe(false);
      expect(result.level).toBe("partial");
      expect(result.reason).toBe("invalid_origin");
    });
    it("should match subdomains", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
        receiptOriginHost: "www.example.com",
        allowedDomains: ["example.com"],
        options: { strictOriginValidation: true },
      });
      expect(result.trusted).toBe(true);
    });
  });
});

describe("isSendAllowedByTrust", () => {
  const trustedResult = { trusted: true, level: "trusted" as const };
  const partialResult = { trusted: false, level: "partial" as const, reason: "missing_checkout_token" as const };
  const untrustedResult = { trusted: false, level: "untrusted" as const, reason: "checkout_token_mismatch" as const };
  describe("strict strategy", () => {
    it("should allow trusted for marketing platforms", () => {
      const result = isSendAllowedByTrust(trustedResult, "meta", "marketing", "strict");
      expect(result.allowed).toBe(true);
    });
    it("should deny partial for marketing platforms", () => {
      const result = isSendAllowedByTrust(partialResult, "meta", "marketing", "strict");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("strict_mode_requires_trust");
    });
    it("should deny untrusted for analytics platforms", () => {
      const result = isSendAllowedByTrust(untrustedResult, "google", "analytics", "strict");
      expect(result.allowed).toBe(false);
    });
  });
  describe("balanced strategy", () => {
    it("should allow partial for analytics platforms", () => {
      const result = isSendAllowedByTrust(partialResult, "google", "analytics", "balanced");
      expect(result.allowed).toBe(true);
    });
    it("should allow partial for marketing platforms", () => {
      const result = isSendAllowedByTrust(partialResult, "meta", "marketing", "balanced");
      expect(result.allowed).toBe(true);
    });
    it("should deny untrusted for marketing platforms", () => {
      const result = isSendAllowedByTrust(untrustedResult, "meta", "marketing", "balanced");
      expect(result.allowed).toBe(false);
    });
    it("should allow untrusted for analytics platforms (fallback)", () => {
      const result = isSendAllowedByTrust(untrustedResult, "google", "analytics", "balanced");
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("fallback");
    });
  });
  describe("weak strategy", () => {
    it("should always allow regardless of trust level", () => {
      expect(isSendAllowedByTrust(untrustedResult, "meta", "marketing", "weak").allowed).toBe(true);
      expect(isSendAllowedByTrust(untrustedResult, "google", "analytics", "weak").allowed).toBe(true);
    });
  });
});

describe("buildTrustMetadata", () => {
  it("should include trust level and verified timestamp", () => {
    const result = buildTrustMetadata({
      trusted: true,
      level: "trusted",
    });
    expect(result.trustLevel).toBe("trusted");
    expect(result.trusted).toBe(true);
    expect(result.verifiedAt).toBeDefined();
  });
  it("should include reason when not trusted", () => {
    const result = buildTrustMetadata({
      trusted: false,
      level: "untrusted",
      reason: "checkout_token_mismatch",
      details: "Token did not match",
    });
    expect(result.untrustedReason).toBe("checkout_token_mismatch");
    expect(result.trustDetails).toBe("Token did not match");
  });
  it("should merge additional context", () => {
    const result = buildTrustMetadata(
      { trusted: true, level: "trusted" },
      { shopId: "shop123", orderId: "order456" }
    );
    expect(result.shopId).toBe("shop123");
    expect(result.orderId).toBe("order456");
  });
});

describe("extractOriginHost", () => {
  it("should extract hostname from valid URL", () => {
    expect(extractOriginHost("https://example.com")).toBe("example.com");
    expect(extractOriginHost("https://test-shop.myshopify.com")).toBe("test-shop.myshopify.com");
    expect(extractOriginHost("https://subdomain.example.com")).toBe("subdomain.example.com");
    expect(extractOriginHost("https://example.com")).toBe("example.com");
    expect(extractOriginHost("https://test-shop.myshopify.com")).toBe("test-shop.myshopify.com");
    expect(extractOriginHost("https://subdomain.example.com")).toBe("subdomain.example.com");
    expect(extractOriginHost("https://example.com")).toBe("example.com");
    expect(extractOriginHost("https://test-shop.myshopify.com")).toBe("test-shop.myshopify.com");
    expect(extractOriginHost("https://subdomain.example.com")).toBe("subdomain.example.com");
  });
  it("should return null for sandbox origin", () => {
    expect(extractOriginHost("null")).toBeNull();
    expect(extractOriginHost(null)).toBeNull();
  });
  it("should return null for invalid origin", () => {
    expect(extractOriginHost("not-a-url")).toBeNull();
  });
});

describe("buildShopAllowedDomains", () => {
  it("should include myshopify domain", () => {
    const domains = buildShopAllowedDomains("mystore.myshopify.com");
    expect(domains).toContain("mystore.myshopify.com");
  });
  it("should include primary domain if provided", () => {
    const domains = buildShopAllowedDomains(
      "mystore.myshopify.com",
      "example.com"
    );
    expect(domains).toContain("mystore.myshopify.com");
    expect(domains).toContain("example.com");
  });
  it("should include custom domains", () => {
    const domains = buildShopAllowedDomains(
      "mystore.myshopify.com",
      "example.com",
      ["shop.example.com", "store.example.org"]
    );
    expect(domains).toContain("shop.example.com");
    expect(domains).toContain("store.example.org");
  });
  it("should not include Shopify platform hosts (only shop-specific domains)", () => {
    const domains = buildShopAllowedDomains("mystore.myshopify.com");
    expect(domains).not.toContain("checkout.shopify.com");
    expect(domains).toContain("mystore.myshopify.com");
  });
  it("should deduplicate domains", () => {
    const domains = buildShopAllowedDomains(
      "mystore.myshopify.com",
      "mystore.myshopify.com"
    );
    const count = domains.filter(d => d === "mystore.myshopify.com").length;
    expect(count).toBe(1);
  });
});
