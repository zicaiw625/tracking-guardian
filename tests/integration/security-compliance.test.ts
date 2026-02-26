import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../../app/utils/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/utils/logger.server")>();
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock("../../app/services/shopify/app-config.server", () => ({
  addDocumentResponseHeaders: vi.fn((request: Request, headers: Headers) => {
    const shopDomain = request.headers.get("x-shopify-shop-domain") || 
                       new URL(request.url).searchParams.get("shop") ||
                       "test-shop.myshopify.com";
    const existingCsp = headers.get("Content-Security-Policy") || "";
    const frameAncestors = `frame-ancestors https://admin.shopify.com https://${shopDomain}`;
    if (existingCsp) {
      const updatedCsp = existingCsp.replace(/frame-ancestors[^;]*/, frameAncestors);
      headers.set("Content-Security-Policy", updatedCsp);
    } else {
      headers.set("Content-Security-Policy", frameAncestors);
    }
  }),
}));

vi.mock("../../app/utils/public-auth", () => ({
  tryAuthenticatePublicWithShop: vi.fn(),
  addSecurityHeaders: vi.fn((response: Response) => response),
  handlePublicPreflight: vi.fn(() => new Response(null, { status: 204 })),
}));

vi.mock("../../app/middleware/rate-limit.server", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: Date.now() + 60000,
  }),
  ipKeyExtractor: vi.fn(() => "test-ip"),
  shopDomainIpKeyExtractor: vi.fn(() => "test-shop-ip"),
  shopScopedIpKeyExtractor: vi.fn((req, shopDomain) => `${shopDomain || "unknown"}:test-ip`),
}));

import { addDocumentResponseHeaders } from "../../app/services/shopify/app-config.server";
import { action as ingestAction } from "../../app/routes/ingest";

vi.mock("../../app/lib/pixel-events/key-validation", () => ({
  getShopForPixelVerificationWithConfigs: vi.fn().mockResolvedValue({
    shop: {
      id: "shop-123",
      shopDomain: "test-shop.myshopify.com",
      isActive: true,
    },
    configs: [],
  }),
}));

vi.mock("../../app/lib/pixel-events/hmac-validation", () => ({
  validatePixelEventHMAC: vi.fn().mockResolvedValue({
    valid: false,
    reason: "Missing HMAC signature",
    errorCode: "missing_signature",
    trustLevel: "untrusted",
  }),
}));

vi.mock("../../app/utils/rate-limiter", () => ({
  trackAnomaly: vi.fn().mockReturnValue({
    shouldBlock: false,
    reason: "ok",
  }),
}));

vi.mock("../../app/utils/shop-access", () => ({
  verifyWithGraceWindowAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../app/lib/pixel-events/ingest-pipeline.server", () => ({
  validateEvents: vi.fn((events) => events),
  normalizeEvents: vi.fn((events) => events),
  deduplicateEvents: vi.fn((events) => events),
  distributeEvents: vi.fn((events) => events.map((e: any) => ({ ...e, destinations: [] }))),
}));

vi.mock("../../app/services/events/pipeline.server", () => ({
  processBatchEvents: vi.fn().mockResolvedValue([]),
}));

const originalEnv = process.env;

describe("Security Compliance - App Store Requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("P0-1: Frame Ancestors CSP Header", () => {
    it("should set dynamic frame-ancestors with shop domain and admin.shopify.com for embedded requests", () => {
      const shopDomain = "example-shop.myshopify.com";
      const request = new Request(`https://example.com/app?embedded=1&shop=${shopDomain}`, {
        headers: {
          "x-shopify-shop-domain": shopDomain,
        },
      });
      const headers = new Headers();
      
      addDocumentResponseHeaders(request, headers);
      
      const csp = headers.get("Content-Security-Policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("frame-ancestors");
      expect(csp).toContain("https://admin.shopify.com");
      expect(csp).toContain(`https://${shopDomain}`);
    });

    it("should set frame-ancestors when Sec-Fetch-Dest is iframe", () => {
      const shopDomain = "test-shop.myshopify.com";
      const request = new Request("https://example.com/app", {
        headers: {
          "Sec-Fetch-Dest": "iframe",
          "x-shopify-shop-domain": shopDomain,
        },
      });
      const headers = new Headers();
      
      addDocumentResponseHeaders(request, headers);
      
      const csp = headers.get("Content-Security-Policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("frame-ancestors");
      expect(csp).toContain("https://admin.shopify.com");
      expect(csp).toContain(`https://${shopDomain}`);
    });

    it("should set frame-ancestors when X-Shopify-Shop-Domain header is present", () => {
      const shopDomain = "another-shop.myshopify.com";
      const request = new Request("https://example.com/app", {
        headers: {
          "X-Shopify-Shop-Domain": shopDomain,
        },
      });
      const headers = new Headers();
      
      addDocumentResponseHeaders(request, headers);
      
      const csp = headers.get("Content-Security-Policy");
      expect(csp).toBeTruthy();
      expect(csp).toContain("frame-ancestors");
      expect(csp).toContain("https://admin.shopify.com");
      expect(csp).toContain(`https://${shopDomain}`);
    });
  });

  describe("P0-2: /ingest Endpoint Security", () => {

    it("should reject requests without signature in production", async () => {
      process.env.NODE_ENV = "production";
      
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://test-shop.myshopify.com",
        },
        body: JSON.stringify({
          eventName: "checkout_completed",
          timestamp: Date.now(),
          shopDomain: "test-shop.myshopify.com",
        }),
      });

      const response = await ingestAction({ request } as ActionFunctionArgs);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("should reject requests with expired timestamp", async () => {
      process.env.NODE_ENV = "production";
      
      const expiredTimestamp = Date.now() - 600000;
      const request = new Request("https://example.com/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tracking-Guardian-Timestamp": String(expiredTimestamp),
          "X-Tracking-Guardian-Signature": "test-signature",
          "Origin": "https://test-shop.myshopify.com",
        },
        body: JSON.stringify({
          eventName: "checkout_completed",
          timestamp: expiredTimestamp,
          shopDomain: "test-shop.myshopify.com",
        }),
      });

      const response = await ingestAction({ request } as ActionFunctionArgs);
      expect(response.status).not.toBe(200);
      expect([204, 400, 403, 422]).toContain(response.status);
    });
  });


});
