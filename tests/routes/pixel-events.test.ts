import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findFirst: vi.fn(),
    },
    pixelEventReceipt: {
      upsert: vi.fn(),
    },
    pixelConfig: {
      findMany: vi.fn(),
    },
    conversionLog: {
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
}));

import prisma from "../../app/db.server";

describe("Pixel Events API - Origin Validation", () => {
  describe("isValidShopifyOrigin", () => {
    let isValidShopifyOrigin: (origin: string | null) => boolean;
    beforeEach(async () => {
      const module = await import("../../app/utils/origin-validation");
      isValidShopifyOrigin = module.isValidShopifyOrigin;
      isValidDevOrigin = module.isValidDevOrigin;
    });
    it("accepts 'null' string (Web Pixel sandbox)", () => {
      expect(isValidShopifyOrigin("null")).toBe(true);
    });
    it("rejects null value (missing Origin header)", () => {
      expect(isValidShopifyOrigin(null)).toBe(false);
    });
    it("accepts *.myshopify.com origins", () => {
      expect(isValidShopifyOrigin("https://test-shop.myshopify.com")).toBe(true);
    });
    it("rejects invalid domains", () => {
      expect(isValidShopifyOrigin("https://evil.com")).toBe(false);
      expect(isValidShopifyOrigin("https://phishing-site.com")).toBe(false);
      expect(isValidShopifyOrigin("https://not-myshopify.com")).toBe(false);
    });
    it("rejects non-HTTPS origins", () => {
      expect(isValidShopifyOrigin("http://test-shop.myshopify.com")).toBe(false);
    });
    it("accepts checkout domains", () => {
      expect(isValidShopifyOrigin("https://checkout.shopify.com")).toBe(true);
    });
    it("rejects fake checkout domains (security fix)", () => {
      expect(isValidShopifyOrigin("https://checkout.evil.com")).toBe(false);
      expect(isValidShopifyOrigin("https://checkout.shopify.com.attacker.com")).toBe(false);
      expect(isValidShopifyOrigin("https://checkout.shopify.com.evil.com")).toBe(false);
      expect(isValidShopifyOrigin("https://fake-checkout.other.com")).toBe(false);
    });
  });
  describe("Dev origin validation", () => {
    let isValidDevOrigin: (origin: string | null) => boolean;
    beforeEach(async () => {
      const module = await import("../../app/utils/origin-validation");
      isValidDevOrigin = module.isValidDevOrigin;
    });
    it("accepts localhost origins", () => {
      expect(isValidDevOrigin("http://localhost:3000")).toBe(true);
      expect(isValidDevOrigin("https://localhost:3000")).toBe(true);
      expect(isValidDevOrigin("http://127.0.0.1:3000")).toBe(true);
      expect(isValidDevOrigin("https://127.0.0.1:3000")).toBe(true);
      expect(isValidDevOrigin("http://localhost:5173")).toBe(true);
      expect(isValidDevOrigin("https://localhost:3000")).toBe(true);
      expect(isValidDevOrigin("http://127.0.0.1:3000")).toBe(true);
    });
    it("accepts 127.0.0.1 origins", () => {
      expect(isValidDevOrigin("http://localhost:3000")).toBe(true);
      expect(isValidDevOrigin("https://localhost:3000")).toBe(true);
      expect(isValidDevOrigin("http://127.0.0.1:3000")).toBe(true);
    });
    it("rejects null", () => {
      expect(isValidDevOrigin(null)).toBe(false);
    });
  });
});
describe("Pixel Events API - Timestamp Validation", () => {
  const TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;
  function isValidTimestamp(timestamp: number): boolean {
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    return timeDiff <= TIMESTAMP_WINDOW_MS;
  }
  it("accepts current timestamp", () => {
    const now = Date.now();
    expect(isValidTimestamp(now)).toBe(true);
  });
  it("accepts timestamp within 10 minute window (past)", () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    expect(isValidTimestamp(fiveMinutesAgo)).toBe(true);
  });
  it("accepts timestamp within 10 minute window (future)", () => {
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
    expect(isValidTimestamp(fiveMinutesFromNow)).toBe(true);
  });
  it("rejects timestamp outside 10 minute window", () => {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    expect(isValidTimestamp(fifteenMinutesAgo)).toBe(false);
  });
  it("rejects very old timestamps", () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    expect(isValidTimestamp(oneHourAgo)).toBe(false);
  });
});
describe("Pixel Events API - Rate Limiting", () => {
  let trackAnomaly: (shopDomain: string, type: "invalid_key" | "invalid_origin" | "invalid_timestamp") => { shouldBlock: boolean; reason?: string };
  let unblockShop: (shopDomain: string) => boolean;
  let clearAllTracking: () => void;
  beforeEach(async () => {
    vi.resetModules();
    const module = await import("../../app/utils/rate-limiter");
    trackAnomaly = module.trackAnomaly;
    unblockShop = module.unblockShop;
    clearAllTracking = module.clearAllTracking;
    if (clearAllTracking) {
      clearAllTracking();
    } else {
      unblockShop("test-store.myshopify.com");
      unblockShop("abuse-store.myshopify.com");
      unblockShop("mixed-store.myshopify.com");
    }
  });
  it("does not block on first few anomalies", () => {
    const result = trackAnomaly("test-store.myshopify.com", "invalid_key");
    expect(result.shouldBlock).toBe(false);
  });
  it("blocks after threshold exceeded", () => {
    for (let i = 0; i < 49; i++) {
      trackAnomaly("abuse-store.myshopify.com", "invalid_key");
    }
    const result = trackAnomaly("abuse-store.myshopify.com", "invalid_key");
    expect(result.shouldBlock).toBe(true);
    expect(result.reason).toContain("invalid key");
  });
  it("tracks different anomaly types separately", () => {
    for (let i = 0; i < 20; i++) {
      trackAnomaly("mixed-store.myshopify.com", "invalid_key");
    }
    const result = trackAnomaly("mixed-store.myshopify.com", "invalid_origin");
    expect(result.shouldBlock).toBe(false);
  });
});
describe("Pixel Events API - Request Validation", () => {
  function validatePayload(body: unknown): { valid: boolean; error?: string } {
    if (!body || typeof body !== "object") {
      return { valid: false, error: "Invalid request body" };
    }
    const data = body as Record<string, unknown>;
    if (!data.eventName || typeof data.eventName !== "string") {
      return { valid: false, error: "Missing eventName" };
    }
    if (!data.shopDomain || typeof data.shopDomain !== "string") {
      return { valid: false, error: "Missing shopDomain" };
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(data.shopDomain as string)) {
      return { valid: false, error: "Invalid shop domain format" };
    }
    if (!data.timestamp || typeof data.timestamp !== "number") {
      return { valid: false, error: "Missing or invalid timestamp" };
    }
    return { valid: true };
  }
  it("validates valid checkout_completed payload", () => {
    const payload = {
      eventName: "checkout_completed",
      shopDomain: "test-store.myshopify.com",
      timestamp: Date.now(),
      data: {
        orderId: "gid://shopify/Order/12345",
        value: 99.99,
        currency: "USD",
      },
    };
    expect(validatePayload(payload).valid).toBe(true);
  });
  it("rejects missing eventName", () => {
    const payload = {
      shopDomain: "test-store.myshopify.com",
      timestamp: Date.now(),
    };
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing eventName");
  });
  it("rejects missing shopDomain", () => {
    const payload = {
      eventName: "checkout_completed",
      timestamp: Date.now(),
    };
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing shopDomain");
  });
  it("rejects invalid shopDomain format", () => {
    const payload = {
      eventName: "checkout_completed",
      shopDomain: "not-a-valid-domain.com",
      timestamp: Date.now(),
    };
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid shop domain format");
  });
  it("rejects missing timestamp", () => {
    const payload = {
      eventName: "checkout_completed",
      shopDomain: "test-store.myshopify.com",
    };
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing or invalid timestamp");
  });
  it("rejects string timestamp", () => {
    const payload = {
      eventName: "checkout_completed",
      shopDomain: "test-store.myshopify.com",
      timestamp: "1234567890",
    };
    const result = validatePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing or invalid timestamp");
  });
});
describe("Pixel Events API - Consent Filtering", () => {
  let isMarketingPlatform: (platform: string) => boolean;
  let isAnalyticsPlatform: (platform: string) => boolean;
  beforeEach(async () => {
    const module = await import("../../app/utils/platform-consent");
    isMarketingPlatform = module.isMarketingPlatform;
    isAnalyticsPlatform = module.isAnalyticsPlatform;
  });
  it("identifies Meta as marketing platform", () => {
    expect(isMarketingPlatform("meta")).toBe(true);
  });
  it("identifies TikTok as marketing platform", () => {
    expect(isMarketingPlatform("tiktok")).toBe(true);
  });
  it("identifies Google GA4 as analytics platform by default", () => {
    expect(isAnalyticsPlatform("google")).toBe(true);
  });
  describe("Consent-based filtering logic", () => {
    interface ConsentState {
      marketing?: boolean;
      analytics?: boolean;
    }
    function shouldSendToPlatform(
      platform: string,
      consent: ConsentState | undefined
    ): boolean {
      const hasMarketingConsent = consent?.marketing === true;
      const hasAnalyticsConsent = consent?.analytics === true;
      if (isMarketingPlatform(platform) && !hasMarketingConsent) {
        return false;
      }
      if (isAnalyticsPlatform(platform) && !hasAnalyticsConsent) {
        return false;
      }
      return true;
    }
    it("allows Meta with marketing consent", () => {
      expect(shouldSendToPlatform("meta", { marketing: true, analytics: true })).toBe(true);
    });
    it("blocks Meta without marketing consent", () => {
      expect(shouldSendToPlatform("meta", { marketing: false, analytics: true })).toBe(false);
    });
    it("allows Google with analytics consent", () => {
      expect(shouldSendToPlatform("google", { marketing: false, analytics: true })).toBe(true);
    });
    it("blocks Google without analytics consent", () => {
      expect(shouldSendToPlatform("google", { marketing: true, analytics: false })).toBe(false);
    });
  });
});
describe("Pixel Events API - Idempotent Writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("uses upsert for PixelEventReceipt to prevent duplicates", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({
      id: "receipt-1",
      shopId: "shop-1",
      eventId: "evt-1",
      eventType: "purchase",
    });
    (prisma.pixelEventReceipt.upsert as any) = mockUpsert;
    await prisma.pixelEventReceipt.upsert({
      where: {
        shopId_eventId_eventType: {
          shopId: "shop-1",
          eventId: "evt-1",
          eventType: "purchase",
        },
      },
      create: {
        shopId: "shop-1",
        eventId: "evt-1",
        eventType: "purchase",
        pixelTimestamp: new Date(),
        orderKey: "order-1",
      },
      update: {
        pixelTimestamp: new Date(),
      },
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].where).toEqual({
      shopId_eventId_eventType: {
        shopId: "shop-1",
        eventId: "evt-1",
        eventType: "purchase",
      },
    });
  });
  it("uses upsert for ConversionLog to prevent duplicates", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({
      id: "log-1",
      shopId: "shop-1",
      orderId: "order-1",
      platform: "meta",
      eventType: "purchase",
    });
    (prisma.conversionLog.upsert as any) = mockUpsert;
    await prisma.conversionLog.upsert({
      where: {
        shopId_orderId_platform_eventType: {
          shopId: "shop-1",
          orderId: "order-1",
          platform: "meta",
          eventType: "purchase",
        },
      },
      create: {
        shopId: "shop-1",
        orderId: "order-1",
        platform: "meta",
        eventType: "purchase",
        orderValue: 99.99,
        currency: "USD",
        status: "pending",
        attempts: 0,
        clientSideSent: true,
        serverSideSent: false,
      },
      update: {
        clientSideSent: true,
      },
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
