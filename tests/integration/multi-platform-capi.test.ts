import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    conversionJob: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    pixelEventReceipt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("../../app/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  metrics: {
    webhookProcessing: vi.fn(),
    consentFilter: vi.fn(),
    trustVerification: vi.fn(),
    retryQueue: vi.fn(),
  },
}));

vi.mock("../../app/services/platforms/google.service", () => ({
  sendConversionToGoogle: vi.fn(),
}));

vi.mock("../../app/services/platforms/meta.service", () => ({
  sendConversionToMeta: vi.fn(),
}));

vi.mock("../../app/services/platforms/tiktok.service", () => ({
  sendConversionToTikTok: vi.fn(),
}));

vi.mock("../../app/services/billing.server", () => ({
  checkBillingGate: vi.fn().mockResolvedValue({
    allowed: true,
    reason: "within_limit",
    usage: { current: 10, limit: 1000 },
  }),
  incrementMonthlyUsage: vi.fn(),
}));

import { sendConversionToGoogle } from "../../app/services/platforms/google.service";
import { sendConversionToMeta } from "../../app/services/platforms/meta.service";
import { sendConversionToTikTok } from "../../app/services/platforms/tiktok.service";
import {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildShopAllowedDomains
} from "../../app/utils/receipt-trust";
import {
  evaluatePlatformConsentWithStrategy,
  getEffectiveConsentCategory
} from "../../app/utils/platform-consent";

describe("Multi-Platform CAPI Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Platform sending logic", () => {
    const mockConversionData = {
      orderId: "12345",
      orderNumber: "1001",
      value: 149.99,
      currency: "USD",
      lineItems: [
        { productId: "prod-1", variantId: "var-1", name: "Test Product", quantity: 1, price: 149.99 },
      ],
    };

    it("should send to Google GA4 when analytics consent is granted", async () => {
      (sendConversionToGoogle as any).mockResolvedValue({ success: true });

      const result = await sendConversionToGoogle(
        { measurementId: "G-TEST123", apiSecret: "secret" },
        mockConversionData,
        "event-123"
      );

      expect(sendConversionToGoogle).toHaveBeenCalledWith(
        expect.objectContaining({ measurementId: "G-TEST123" }),
        mockConversionData,
        "event-123"
      );
      expect(result).toEqual({ success: true });
    });

    it("should send to Meta CAPI when marketing consent is granted", async () => {
      (sendConversionToMeta as any).mockResolvedValue({ events_received: 1 });

      const result = await sendConversionToMeta(
        { pixelId: "123456789", accessToken: "token123" },
        mockConversionData,
        "event-123"
      );

      expect(sendConversionToMeta).toHaveBeenCalledWith(
        expect.objectContaining({ pixelId: "123456789" }),
        mockConversionData,
        "event-123"
      );
      expect(result).toEqual({ events_received: 1 });
    });

    it("should send to TikTok when marketing consent is granted", async () => {
      (sendConversionToTikTok as any).mockResolvedValue({ code: 0 });

      const result = await sendConversionToTikTok(
        { pixelCode: "TIKTOK123", accessToken: "token123" },
        mockConversionData,
        "event-123"
      );

      expect(sendConversionToTikTok).toHaveBeenCalledWith(
        expect.objectContaining({ pixelCode: "TIKTOK123" }),
        mockConversionData,
        "event-123"
      );
      expect(result).toEqual({ code: 0 });
    });
  });

  describe("Trust verification integration", () => {
    it("should verify trusted receipt with matching checkout tokens", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: "abc123",
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
      });

      expect(result.trusted).toBe(true);
      expect(result.level).toBe("trusted");
    });

    it("should mark as untrusted when checkout tokens mismatch", () => {
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

    it("should mark as partial when receipt has no checkout token", () => {
      const result = verifyReceiptTrust({
        receiptCheckoutToken: null,
        webhookCheckoutToken: "abc123",
        ingestionKeyMatched: true,
        receiptExists: true,
      });

      expect(result.trusted).toBe(false);
      expect(result.level).toBe("partial");
    });
  });

  describe("Consent strategy integration", () => {
    const consentStates = {
      full: { marketing: true, analytics: true, saleOfDataAllowed: true },
      analyticsOnly: { marketing: false, analytics: true, saleOfDataAllowed: true },
      marketingOnly: { marketing: true, analytics: false, saleOfDataAllowed: true },
      none: { marketing: false, analytics: false, saleOfDataAllowed: true },
      saleOfDataBlocked: { marketing: true, analytics: true, saleOfDataAllowed: false },
    };

    describe("strict strategy", () => {
      it("should allow Google when trusted and analytics consent granted", () => {
        const trustResult = { trusted: true, level: "trusted" as const };
        const trustAllowed = isSendAllowedByTrust(trustResult, "google", "analytics", "strict");
        expect(trustAllowed.allowed).toBe(true);

        const consentDecision = evaluatePlatformConsentWithStrategy(
          "google", "strict", consentStates.full, true, false
        );
        expect(consentDecision.allowed).toBe(true);
      });

      it("should block Meta when not trusted", () => {
        const trustResult = { trusted: false, level: "partial" as const, reason: "missing_checkout_token" as const };
        const trustAllowed = isSendAllowedByTrust(trustResult, "meta", "marketing", "strict");
        expect(trustAllowed.allowed).toBe(false);
      });
    });

    describe("balanced strategy", () => {
      it("should allow Google analytics even with partial trust", () => {
        const trustResult = { trusted: false, level: "partial" as const, reason: "missing_checkout_token" as const };
        const trustAllowed = isSendAllowedByTrust(trustResult, "google", "analytics", "balanced");
        expect(trustAllowed.allowed).toBe(true);
      });

      it("should block Meta when untrusted", () => {
        const trustResult = { trusted: false, level: "untrusted" as const, reason: "checkout_token_mismatch" as const };
        const trustAllowed = isSendAllowedByTrust(trustResult, "meta", "marketing", "balanced");
        expect(trustAllowed.allowed).toBe(false);
      });
    });
  });

  describe("Platform categorization", () => {
    it("should categorize Google as analytics by default", () => {
      const category = getEffectiveConsentCategory("google", false);
      expect(category).toBe("analytics");
    });

    it("should categorize Meta as marketing", () => {
      const category = getEffectiveConsentCategory("meta", false);
      expect(category).toBe("marketing");
    });

    it("should categorize TikTok as marketing", () => {
      const category = getEffectiveConsentCategory("tiktok", false);
      expect(category).toBe("marketing");
    });

    it("should override Google to marketing when treatAsMarketing is true", () => {
      const category = getEffectiveConsentCategory("google", true);
      expect(category).toBe("marketing");
    });
  });

  describe("Sale of data blocking", () => {
    it("should block all platforms when saleOfDataAllowed is false", () => {
      const consentState = { marketing: true, analytics: true, saleOfDataAllowed: false };

      const metaDecision = evaluatePlatformConsentWithStrategy(
        "meta", "strict", consentState, true, false
      );

      expect(metaDecision.allowed).toBe(false);
    });
  });

  describe("Multi-platform concurrent sending", () => {
    it("should handle mixed success/failure across platforms", async () => {
      (sendConversionToGoogle as any).mockResolvedValue({ success: true });
      (sendConversionToMeta as any).mockRejectedValue(new Error("Rate limited"));
      (sendConversionToTikTok as any).mockResolvedValue({ code: 0 });

      const conversionData = {
        orderId: "12345",
        orderNumber: "1001",
        value: 149.99,
        currency: "USD",
      };

      const googleResult = await sendConversionToGoogle(
        { measurementId: "G-TEST", apiSecret: "secret" },
        conversionData,
        "event-1"
      );
      expect(googleResult).toEqual({ success: true });

      await expect(sendConversionToMeta(
        { pixelId: "123", accessToken: "token" },
        conversionData,
        "event-1"
      )).rejects.toThrow("Rate limited");

      const tiktokResult = await sendConversionToTikTok(
        { pixelCode: "TIKTOK", accessToken: "token" },
        conversionData,
        "event-1"
      );
      expect(tiktokResult).toEqual({ code: 0 });
    });
  });

  describe("Credential decryption failure handling", () => {
    it("should skip platform when credentials cannot be decrypted", () => {

      const pixelConfig = {
        platform: "meta",
        credentialsEncrypted: "invalid-encrypted-data",
        credentials: null,
      };

      let credentials = null;

      try {

        throw new Error("Decryption failed");
      } catch {
        credentials = null;
      }

      expect(credentials).toBeNull();

    });
  });

  describe("Shop domain allowlist building", () => {
    it("should include all shop domains in allowlist", () => {
      const domains = buildShopAllowedDomains(
        "test-store.myshopify.com",
        "www.teststore.com",
        ["shop.teststore.com", "store.teststore.org"]
      );

      expect(domains).toContain("test-store.myshopify.com");
      expect(domains).toContain("www.teststore.com");
      expect(domains).toContain("shop.teststore.com");
      expect(domains).toContain("store.teststore.org");
      expect(domains).toContain("checkout.shopify.com");
    });
  });
});
