import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findFirst: vi.fn(),
    },
    pixelEventReceipt: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    eventNonce: {
      create: vi.fn(),
    },
    pixelConfig: {
      findMany: vi.fn(),
    },
    conversionLog: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn().mockResolvedValue({
    lPush: vi.fn().mockResolvedValue(1),
    lTrim: vi.fn().mockResolvedValue(true),
    rPop: vi.fn().mockResolvedValue(null),
  }),
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
    metrics: {
      pixelEvent: vi.fn(),
      pixelRejection: vi.fn(),
      silentDrop: vi.fn(),
    },
  };
});

vi.mock("../../app/middleware/rate-limit.server", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: Date.now() + 60000,
  }),
  checkTokenBucketRateLimitAsync: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: Date.now() + 60000,
    tokens: 100,
  }),
  shopDomainIpKeyExtractor: vi.fn((req) => `shop-${req.headers.get("x-shopify-shop-domain") || "unknown"}`),
  shopScopedIpKeyExtractor: vi.fn((req, shopDomain) => `${shopDomain || "unknown"}:test-ip`),
  ipKeyExtractor: vi.fn(() => "test-ip"),
}));

vi.mock("../../app/utils/rate-limiter", () => ({
  trackAnomaly: vi.fn().mockReturnValue({
    shouldBlock: false,
    reason: "ok",
  }),
}));

vi.mock("../../app/lib/pixel-events/key-validation", () => ({
  getShopForPixelVerificationWithConfigs: vi.fn(),
}));

vi.mock("../../app/lib/pixel-events/hmac-validation", () => ({
  validatePixelEventHMAC: vi.fn(),
}));

vi.mock("../../app/utils/shop-access", () => ({
  verifyWithGraceWindowAsync: vi.fn(),
}));

vi.mock("../../app/lib/pixel-events/ingest-pipeline.server", () => ({
  validateEvents: vi.fn((events) => events),
  normalizeEvents: vi.fn((events) => events),
  deduplicateEvents: vi.fn((events) => events),
  distributeEvents: vi.fn((events) => events.map((e: any) => ({ ...e, destinations: [] }))),
}));

vi.mock("../../app/lib/pixel-events/ingest-queue.server", () => ({
  enqueueIngestBatch: vi.fn().mockResolvedValue(true),
  processIngestQueue: vi.fn(),
}));

vi.mock("../../app/services/events/pipeline.server", () => ({
  processBatchEvents: vi.fn().mockImplementation(async (_shopId: string, events: any[]) => {
    return events.map(() => ({ success: true }));
  }),
}));

import { action } from "../../app/routes/ingest";
import { getShopForPixelVerificationWithConfigs } from "../../app/lib/pixel-events/key-validation";
import { validatePixelEventHMAC } from "../../app/lib/pixel-events/hmac-validation";
import { verifyWithGraceWindowAsync } from "../../app/utils/shop-access";

const originalEnv = process.env;

function createValidEventPayload(shopDomain: string, timestamp?: number) {
  return {
    eventName: "checkout_completed",
    timestamp: timestamp || Date.now(),
    shopDomain,
    data: {
      orderId: "gid://shopify/Order/12345",
      value: 99.99,
      currency: "USD",
    },
  };
}

function createNonCriticalEventPayload(shopDomain: string, timestamp?: number) {
  return {
    eventName: "page_viewed",
    timestamp: timestamp || Date.now(),
    shopDomain,
    data: {
      url: "https://test-shop.myshopify.com/products/example",
      title: "Example",
    },
  };
}

function createRequest(body: any, headers: Record<string, string> = {}) {
  return new Request("https://example.com/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shopify-shop-domain": body.shopDomain || "test-shop.myshopify.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("/ingest Security Policy Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
    
    vi.mocked(getShopForPixelVerificationWithConfigs).mockResolvedValue({
      id: "shop-123",
      shopDomain: "test-shop.myshopify.com",
      isActive: true,
      primaryDomain: null,
      storefrontDomains: [],
      ingestionSecret: "test-secret",
      previousIngestionSecret: null,
      pixelConfigs: [],
    } as any);
    
    vi.mocked(validatePixelEventHMAC).mockResolvedValue({
      valid: true,
      trustLevel: "trusted",
    } as any);
    
    vi.mocked(verifyWithGraceWindowAsync).mockResolvedValue({
      matched: true,
      usedPreviousSecret: false,
    } as any);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Origin = null + signature match → 200", () => {
    it("should accept null origin with valid signature", async () => {
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "null",
        "X-Tracking-Guardian-Signature": "valid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.accepted_count).toBeDefined();
    });
  });

  describe("Origin = null + signature missing (production) → 403", () => {
    it("should reject null origin without signature in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "null",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Origin missing + Referer missing → 403 (P0 fix)", () => {
    it("should reject request with missing Origin and Referer in production", async () => {
      process.env.NODE_ENV = "production";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        "X-Tracking-Guardian-Signature": "valid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Invalid request");
    });

    it("should allow request with missing Origin but valid Referer in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Referer: "https://test-shop.myshopify.com/checkout",
        "X-Tracking-Guardian-Signature": "valid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).not.toBe(403);
    });
  });

  describe("Origin not in allowlist + signature match (production) → 403", () => {
    it("should reject non-allowlisted origin even with signature in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_STRICT_ORIGIN = "true";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "https://evil.com",
        "X-Tracking-Guardian-Signature": "valid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Invalid request");
    });
  });

  describe("Timestamp outside window → 204", () => {
    it("should return 204 for timestamp outside window", async () => {
      const oldTimestamp = Date.now() - 15 * 60 * 1000;
      const payload = createValidEventPayload("test-shop.myshopify.com", oldTimestamp);
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Timestamp": String(oldTimestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(204);
    });

    it("should return 204 for future timestamp outside window", async () => {
      const futureTimestamp = Date.now() + 15 * 60 * 1000;
      const payload = createValidEventPayload("test-shop.myshopify.com", futureTimestamp);
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Timestamp": String(futureTimestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(204);
    });
  });

  describe("Signature missing or invalid → 403", () => {
    it("should reject request without signature", async () => {
      process.env.NODE_ENV = "production";
      process.env.SECURITY_ENFORCEMENT = "strict";
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should reject request with invalid signature", async () => {
      process.env.NODE_ENV = "production";
      process.env.SECURITY_ENFORCEMENT = "strict";
      vi.mocked(verifyWithGraceWindowAsync).mockResolvedValue({
        matched: false,
        usedPreviousSecret: false,
      } as any);
      vi.mocked(validatePixelEventHMAC).mockResolvedValue({
        valid: false,
        trustLevel: "untrusted",
      } as any);
      
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Signature": "invalid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Production: non-critical event without signature → 403", () => {
    it("should reject non-critical event without signature when shop has ingestion secret", async () => {
      process.env.NODE_ENV = "production";
      const payload = createNonCriticalEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Valid request → 200", () => {
    it("should accept valid request with proper origin and signature", async () => {
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const request = createRequest(payload, {
        Origin: "https://test-shop.myshopify.com",
        "X-Tracking-Guardian-Signature": "valid-signature",
        "X-Tracking-Guardian-Timestamp": String(payload.timestamp),
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.accepted_count).toBeDefined();
    });

    it("should accept valid request with body signature only", async () => {
      const payload = createValidEventPayload("test-shop.myshopify.com");
      const signedPayload = {
        ...payload,
        signature: "valid-signature",
        signatureTimestamp: payload.timestamp,
        signatureShopDomain: payload.shopDomain,
      };
      const request = createRequest(signedPayload, {
        Origin: "https://test-shop.myshopify.com",
      });

      const response = await action({ request, params: {}, context: {} });
      expect(response.status).toBe(202);
      const data = await response.json();
      expect(data.accepted_count).toBeDefined();
    });
  });
});
