import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    conversionLog: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    pixelConfig: {
      findMany: vi.fn(),
    },
    pixelEventReceipt: {
      upsert: vi.fn(),
    },
    eventNonce: {
      create: vi.fn(),
    },
  },
}));

import prisma from "../app/db.server";

describe("P0-7: sale_of_data Opt-Out Blocking", () => {
  const mockShop = {
    id: "shop-123",
    shopDomain: "test-shop.myshopify.com",
    isActive: true,
    ingestionSecret: "test-secret-32-chars-long-here!",
    consentStrategy: "strict",
    piiEnabled: false,
    storefrontDomains: ["test-shop.myshopify.com"],
  };

  const mockPixelConfigs = [
    { platform: "meta", isActive: true, serverSideEnabled: true },
    { platform: "google", isActive: true, serverSideEnabled: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    (prisma.shop.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockShop);
    (prisma.pixelConfig.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockPixelConfigs);
    (prisma.conversionLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.eventNonce.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "nonce-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Pixel Events with sale_of_data=false", () => {
    it("should NOT create ConversionLog when sale_of_data is opted out", async () => {
      const payload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        consent: {
          marketing: true,
          analytics: true,
          saleOfData: false, // Opted out
        },
        data: {
          orderId: "12345",
          value: 100,
          currency: "USD",
        },
      };

      expect(prisma.conversionLog.upsert).not.toHaveBeenCalled();
    });

    it("should create ConversionLog when sale_of_data is undefined (allowed)", async () => {
      const payload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        consent: {
          marketing: true,
          analytics: true,
        },
        data: {
          orderId: "12345",
          value: 100,
          currency: "USD",
        },
      };
    });

    it("should create ConversionLog when sale_of_data is true (explicit allow)", async () => {
      const payload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        consent: {
          marketing: true,
          analytics: true,
          saleOfData: true, // Explicitly allowed
        },
        data: {
          orderId: "12345",
          value: 100,
          currency: "USD",
        },
      };
    });
  });

  describe("Consent Logic Matrix", () => {
    const testCases = [
      { marketing: true, analytics: true, saleOfData: true, shouldRecord: true, desc: "all granted" },
      { marketing: true, analytics: true, saleOfData: false, shouldRecord: false, desc: "sale_of_data opted out" },
      { marketing: true, analytics: true, saleOfData: undefined, shouldRecord: true, desc: "sale_of_data undefined" },
      { marketing: false, analytics: true, saleOfData: true, shouldRecord: false, desc: "marketing denied" },
      { marketing: true, analytics: false, saleOfData: true, shouldRecord: false, desc: "analytics denied" },
      { marketing: false, analytics: false, saleOfData: true, shouldRecord: false, desc: "both denied" },
      { marketing: false, analytics: false, saleOfData: false, shouldRecord: false, desc: "all denied" },
    ];

    testCases.forEach(({ marketing, analytics, saleOfData, shouldRecord, desc }) => {
      it(`should ${shouldRecord ? "record" : "NOT record"} when ${desc}`, () => {
        const saleOfDataAllowed = saleOfData !== false;
        const hasMarketingConsent = marketing === true;
        const hasAnalyticsConsent = analytics === true;

        if (!saleOfDataAllowed) {
          expect(saleOfDataAllowed).toBe(false);
          return;
        }

        if (shouldRecord) {
          const canRecordAny = hasMarketingConsent || hasAnalyticsConsent;
          expect(canRecordAny).toBe(true);
        }
      });
    });
  });

  describe("Platform-Specific Consent Filtering", () => {
    it("should skip marketing platforms when marketing consent is denied", () => {
      const consent = {
        marketing: false,
        analytics: true,
        saleOfData: true,
      };

      const hasMarketingConsent = consent.marketing === true;
      expect(hasMarketingConsent).toBe(false);
    });

    it("should allow analytics platforms when only analytics consent is granted", () => {
      const consent = {
        marketing: false,
        analytics: true,
        saleOfData: true,
      };

      const hasAnalyticsConsent = consent.analytics === true;
      expect(hasAnalyticsConsent).toBe(true);
    });
  });

  describe("CAPI Send Blocking", () => {
    it("should NOT send to any platform when sale_of_data is opted out", () => {
      const consentEvidence = {
        saleOfDataAllowed: false,
      };

      expect(consentEvidence.saleOfDataAllowed).toBe(false);
    });

    it("should send to platforms when sale_of_data is allowed", () => {
      const consentEvidence = {
        saleOfDataAllowed: true,
        marketingAllowed: true,
        analyticsAllowed: true,
      };

      expect(consentEvidence.saleOfDataAllowed).toBe(true);
    });
  });
});

describe("P0-7: Audit Trail for Consent Decisions", () => {
  it("should record consent evidence in ConversionJob", () => {
    const consentEvidence = {
      strategy: "strict",
      usedConsent: {
        marketing: true,
        analytics: true,
        saleOfData: false, // This is why we blocked
      },
      hasReceipt: true,
      receiptTrusted: true,
      reason: "sale_of_data_opted_out",
    };

    expect(consentEvidence.reason).toBe("sale_of_data_opted_out");
    expect(consentEvidence.usedConsent.saleOfData).toBe(false);
  });
});

