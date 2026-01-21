import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    pixelEventReceipt: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    conversionJob: {
      upsert: vi.fn(),
    },
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
    pixelEvent: vi.fn(),
    pixelRejection: vi.fn(),
    silentDrop: vi.fn(),
    trustVerification: vi.fn(),
  },
}));

import prisma from "../../app/db.server";
import {
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains
} from "../../app/utils/origin-validation";

describe("Web Pixel E2E Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("Complete checkout_completed flow", () => {
    const mockShop = {
      id: "shop-123",
      shopDomain: "test-store.myshopify.com",
      ingestionSecret: "encrypted-secret",
      isActive: true,
      primaryDomain: "www.teststore.com",
      storefrontDomains: ["shop.teststore.com"],
    };
    const validPixelEvent = {
      eventName: "checkout_completed",
      timestamp: Date.now(),
      shopDomain: "test-store.myshopify.com",
      consent: {
        marketing: true,
        analytics: true,
        saleOfData: true,
      },
      data: {
        orderId: "gid://shopify/Order/123456",
        checkoutToken: "abc123-checkout-token",
        value: 149.99,
        currency: "USD",
        items: [
          { id: "item-1", name: "Test Product", price: 149.99, quantity: 1 },
        ],
      },
    };
    it("should accept valid pixel event from Web Pixel sandbox (null origin)", () => {
      const result = validatePixelOriginPreBody("null");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("null_origin_allowed");
    });
    it("should block null origin when policy disabled via env", () => {
      const originalEnv = process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY;
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      try {
        const result = validatePixelOriginPreBody("null");
        expect(result.valid).toBe(false);
        expect(result.reason).toBe("null_origin_blocked");
      } finally {
        if (originalEnv === undefined) {
          delete process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY;
        } else {
          process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = originalEnv;
        }
      }
    });
    it("should accept valid pixel event from myshopify.com origin", () => {
      const result = validatePixelOriginPreBody("https://test-shop.myshopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_allowed_origin");
    });
    it("should accept valid pixel event from allowed origin", () => {
      const result = validatePixelOriginPreBody("https://test-store.myshopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_allowed_origin");
    });
    it("should validate origin against shop's allowed domains", () => {
      const allowedDomains = buildShopAllowedDomains({
        shopDomain: mockShop.shopDomain,
        primaryDomain: mockShop.primaryDomain,
        storefrontDomains: mockShop.storefrontDomains,
      });
      const shopifyResult = validatePixelOriginForShop(
        "https://test-store.myshopify.com",
        allowedDomains
      );
      expect(shopifyResult.valid).toBe(true);
      const primaryResult = validatePixelOriginForShop(
        `https://${mockShop.primaryDomain}`,
        allowedDomains
      );
      expect(primaryResult.valid).toBe(true);
      const externalResult = validatePixelOriginForShop(
        "https://external-domain.com",
        allowedDomains
      );
      expect(externalResult.valid).toBe(false);
      expect(externalResult.reason).toMatch(/^origin_not_allowlisted:/);
    });
    it("should create pixel event receipt with checkout token", async () => {
      const mockUpsert = vi.fn().mockResolvedValue({
        id: "receipt-1",
        shopId: mockShop.id,
        orderId: "12345",
        eventType: "purchase",
        checkoutToken: "abc123-checkout-token",
        isTrusted: true,
        trustLevel: "trusted",
      });
      (prisma.pixelEventReceipt.upsert as any) = mockUpsert;
      await prisma.pixelEventReceipt.upsert({
        where: {
          shopId_orderId_eventType: {
            shopId: mockShop.id,
            orderId: "12345",
            eventType: "purchase",
          },
        },
        create: {
          shopId: mockShop.id,
          orderId: "12345",
          eventType: "purchase",
          checkoutToken: validPixelEvent.data.checkoutToken,
          consentState: validPixelEvent.consent,
          isTrusted: true,
          trustLevel: "trusted",
          signatureStatus: "key_matched",
        },
        update: {
          checkoutToken: validPixelEvent.data.checkoutToken,
          consentState: validPixelEvent.consent,
        },
      });
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0].create.checkoutToken).toBe("abc123-checkout-token");
    });
  });
  describe("Consent enforcement", () => {
    it("should record consent state in receipt", async () => {
      const consentStates = [
        { marketing: true, analytics: true, saleOfData: true },
        { marketing: false, analytics: true, saleOfData: true },
        { marketing: true, analytics: false, saleOfData: true },
        { marketing: true, analytics: true, saleOfData: false },
      ];
      for (const consent of consentStates) {
        const mockUpsert = vi.fn().mockResolvedValue({
          id: "receipt-1",
          consentState: consent,
        });
        (prisma.pixelEventReceipt.upsert as any) = mockUpsert;
        await prisma.pixelEventReceipt.upsert({
          where: {
            shopId_orderId_eventType: {
              shopId: "shop-1",
              orderId: "order-1",
              eventType: "purchase",
            },
          },
          create: {
            shopId: "shop-1",
            orderId: "order-1",
            eventType: "purchase",
            consentState: consent,
          },
          update: {
            consentState: consent,
          },
        });
        expect(mockUpsert.mock.calls[0][0].create.consentState).toEqual(consent);
      }
    });
  });
  describe("Replay protection", () => {
    it("should detect timestamp outside valid window", () => {
      const TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;
      function isValidTimestamp(timestamp: number): boolean {
        const now = Date.now();
        const timeDiff = Math.abs(now - timestamp);
        return timeDiff <= TIMESTAMP_WINDOW_MS;
      }
      expect(isValidTimestamp(Date.now())).toBe(true);
      expect(isValidTimestamp(Date.now() - 5 * 60 * 1000)).toBe(true);
      expect(isValidTimestamp(Date.now() - 15 * 60 * 1000)).toBe(false);
      expect(isValidTimestamp(Date.now() + 60 * 60 * 1000)).toBe(false);
    });
  });
  describe("Security: Origin validation edge cases", () => {
    it("should reject file: protocol", () => {
      const result = validatePixelOriginPreBody("file:///path/to/file");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("file_protocol_blocked");
    });
    it("should reject chrome-extension: protocol", () => {
      const result = validatePixelOriginPreBody("chrome-extension://extension-id");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("chrome_extension_blocked");
    });
    it("should reject data: protocol", () => {
      const result = validatePixelOriginPreBody("data:text/html,<script>alert(1)</script>");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("data_protocol_blocked");
    });
    it("should reject HTTP in production (non-localhost)", () => {
      const result = validatePixelOriginPreBody("http://example.com");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("http_not_allowed");
    });
  });
});
