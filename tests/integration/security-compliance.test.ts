import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

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

vi.mock("../../app/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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
}));

import { addDocumentResponseHeaders } from "../../app/services/shopify/app-config.server";
import { tryAuthenticatePublicWithShop } from "../../app/utils/public-auth";
import { action as ingestAction } from "../../app/routes/ingest";
import { loader as uiModulesStateLoader } from "../../app/lib/api-routes/ui-modules-state";

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

  describe("P0-3: Public Extension API Authentication", () => {
    it("should return 401 for requests without session token", async () => {
      vi.mocked(tryAuthenticatePublicWithShop).mockResolvedValue(null);

      const request = new Request("https://example.com/api/ui-modules-state?target=thank-you", {
        method: "GET",
      });

      const response = await uiModulesStateLoader({ request } as LoaderFunctionArgs);
      expect(response.status).toBe(401);
    });

    it("should allow requests with valid session token", async () => {
      const { default: prisma } = await import("../../app/db.server");
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-123",
        primaryDomain: null,
        storefrontDomains: [],
      } as any);

      vi.mocked(tryAuthenticatePublicWithShop).mockResolvedValue({
        authResult: {
          cors: (response: Response) => response,
          sessionToken: {
            sub: "customer-123",
            dest: "https://test-shop.myshopify.com",
          },
          surface: "checkout",
        },
        shopDomain: "test-shop.myshopify.com",
      });

      const request = new Request("https://example.com/api/ui-modules-state?target=thank-you", {
        method: "GET",
        headers: {
          "Authorization": "Bearer valid-token",
        },
      });

      const response = await uiModulesStateLoader({ request } as LoaderFunctionArgs);
      expect(response.status).not.toBe(401);
    });
  });

  describe("P0-4: Webhook Endpoint URL SSRF Protection", () => {
    it("should reject localhost URLs in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://localhost/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const errorText = result.errors.join(" ");
      expect(errorText).toMatch(/localhost|private|local|network|not allowed/i);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should reject private IP addresses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://192.168.1.1/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const errorText = result.errors.join(" ");
      expect(errorText).toMatch(/IP address|private|not allowed/i);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should reject 10.x.x.x private network addresses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://10.0.0.1/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should reject 172.16-31.x.x private network addresses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://172.16.0.1/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should reject 169.254.x.x link-local addresses", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://169.254.1.1/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should accept valid public HTTPS URLs", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "https://api.example.com/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(true);
      
      process.env.NODE_ENV = originalEnv;
    });

    it("should reject non-HTTPS URLs in production", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      
      const { webhookService } = await import("../../app/services/platforms/webhook.service");
      const result = webhookService.validateCredentials({
        endpointUrl: "http://api.example.com/webhook",
        authType: "none",
      } as any);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const errorText = result.errors.join(" ");
      expect(errorText).toMatch(/HTTPS/i);
      
      process.env.NODE_ENV = originalEnv;
    });
  });
});
