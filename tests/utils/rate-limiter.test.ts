import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkRateLimitAsync,
  createRateLimitResponse,
  resetRateLimit,
  getRateLimitStats,
} from "../../app/utils/rate-limiter";

function createMockRequest(
  url: string = "http:
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    headers: new Headers({
      "x-forwarded-for": "127.0.0.1",
      ...headers,
    }),
  });
}

describe("Rate Limiter", () => {
  beforeEach(async () => {
    const request = createMockRequest();
    await resetRateLimit(request, "test");
    await resetRateLimit(request, "api");
    await resetRateLimit(request, "cron");
  });

  describe("checkRateLimitAsync", () => {
    it("should allow requests within limit", async () => {
      const request = createMockRequest();

      const result = await checkRateLimitAsync(request, "api");

      expect(result.isLimited).toBe(false);
      expect(result.remaining).toBeLessThanOrEqual(100);
    });

    it("should block requests over limit", async () => {
      const request = createMockRequest();

      const customConfig = { maxRequests: 3, windowMs: 60000 };

      for (let i = 0; i < 3; i++) {
        await checkRateLimitAsync(request, "test", customConfig);
      }

      const result = await checkRateLimitAsync(request, "test", customConfig);

      expect(result.isLimited).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should use shop domain when available", async () => {
      const request1 = createMockRequest("http:
        "x-shopify-shop-domain": "shop1.myshopify.com",
        "x-forwarded-for": "1.1.1.1",
      });
      const request2 = createMockRequest("http:
        "x-shopify-shop-domain": "shop2.myshopify.com",
        "x-forwarded-for": "1.1.1.1",
      });

      const customConfig = { maxRequests: 2, windowMs: 60000 };

      await checkRateLimitAsync(request1, "test", customConfig);
      await checkRateLimitAsync(request1, "test", customConfig);
      const result1 = await checkRateLimitAsync(request1, "test", customConfig);

      const result2 = await checkRateLimitAsync(request2, "test", customConfig);

      expect(result1.isLimited).toBe(true);
      expect(result2.isLimited).toBe(false);
    });

    it("should use different limits for different endpoints", async () => {
      const request = createMockRequest();

      const cronConfig = { maxRequests: 2, windowMs: 3600000 };

      await checkRateLimitAsync(request, "cron", cronConfig);
      await checkRateLimitAsync(request, "cron", cronConfig);
      const cronResult = await checkRateLimitAsync(request, "cron", cronConfig);

      const apiResult = await checkRateLimitAsync(request, "api");

      expect(cronResult.isLimited).toBe(true);
      expect(apiResult.isLimited).toBe(false);
    });
  });

  describe("createRateLimitResponse", () => {
    it("should create 429 response with correct headers", async () => {
      const response = createRateLimitResponse(30);

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("30");
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json();
      expect(body.error).toBe("Too Many Requests");
      expect(body.retryAfter).toBe(30);
    });
  });

  describe("getRateLimitStats", () => {
    it("should return current rate limit statistics", async () => {
      const request = createMockRequest();

      await checkRateLimitAsync(request, "api");
      await checkRateLimitAsync(request, "api");

      const stats = await getRateLimitStats();

      expect(stats.totalKeys).toBeGreaterThanOrEqual(0);
      expect(stats.blockedShops).toBeGreaterThanOrEqual(0);
      expect(stats.anomalyTrackers).toBeGreaterThanOrEqual(0);
    });
  });

  describe("resetRateLimit", () => {
    it("should reset rate limit for a specific key", async () => {
      const request = createMockRequest();
      const customConfig = { maxRequests: 2, windowMs: 60000 };

      await checkRateLimitAsync(request, "test", customConfig);
      await checkRateLimitAsync(request, "test", customConfig);
      const beforeReset = await checkRateLimitAsync(request, "test", customConfig);
      expect(beforeReset.isLimited).toBe(true);

      await resetRateLimit(request, "test");

      const afterReset = await checkRateLimitAsync(request, "test", customConfig);
      expect(afterReset.isLimited).toBe(false);
    });
  });
});
