import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkRateLimit,
  createRateLimitResponse,
  resetRateLimit,
  getRateLimitStats,
} from "../../app/utils/rate-limiter";

function createMockRequest(
  url: string = "http://localhost/test",
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
  beforeEach(() => {
    
    const request = createMockRequest();
    resetRateLimit(request, "test");
    resetRateLimit(request, "api");
    resetRateLimit(request, "cron");
  });

  describe("checkRateLimit", () => {
    it("should allow requests within limit", () => {
      const request = createMockRequest();

      const result = checkRateLimit(request, "api");
      
      expect(result.isLimited).toBe(false);
      expect(result.remaining).toBeLessThanOrEqual(100);
    });

    it("should block requests over limit", () => {
      const request = createMockRequest();

      const customConfig = { maxRequests: 3, windowMs: 60000 };
      
      for (let i = 0; i < 3; i++) {
        checkRateLimit(request, "test", customConfig);
      }

      const result = checkRateLimit(request, "test", customConfig);
      
      expect(result.isLimited).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should use shop domain when available", () => {
      const request1 = createMockRequest("http://localhost/test", {
        "x-shopify-shop-domain": "shop1.myshopify.com",
        "x-forwarded-for": "1.1.1.1",
      });
      const request2 = createMockRequest("http://localhost/test", {
        "x-shopify-shop-domain": "shop2.myshopify.com",
        "x-forwarded-for": "1.1.1.1",
      });

      const customConfig = { maxRequests: 2, windowMs: 60000 };

      checkRateLimit(request1, "test", customConfig);
      checkRateLimit(request1, "test", customConfig);
      const result1 = checkRateLimit(request1, "test", customConfig);

      const result2 = checkRateLimit(request2, "test", customConfig);

      expect(result1.isLimited).toBe(true);
      expect(result2.isLimited).toBe(false);
    });

    it("should use different limits for different endpoints", () => {
      const request = createMockRequest();

      const cronConfig = { maxRequests: 2, windowMs: 3600000 };
      
      checkRateLimit(request, "cron", cronConfig);
      checkRateLimit(request, "cron", cronConfig);
      const cronResult = checkRateLimit(request, "cron", cronConfig);

      const apiResult = checkRateLimit(request, "api");

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
    it("should return current rate limit statistics", () => {
      const request = createMockRequest();

      checkRateLimit(request, "api");
      checkRateLimit(request, "api");

      const stats = getRateLimitStats();

      expect(stats.totalKeys).toBeGreaterThanOrEqual(1);
      expect(stats.entries).toBeInstanceOf(Array);
    });
  });

  describe("resetRateLimit", () => {
    it("should reset rate limit for a specific key", () => {
      const request = createMockRequest();
      const customConfig = { maxRequests: 2, windowMs: 60000 };

      checkRateLimit(request, "test", customConfig);
      checkRateLimit(request, "test", customConfig);
      const beforeReset = checkRateLimit(request, "test", customConfig);
      expect(beforeReset.isLimited).toBe(true);

      resetRateLimit(request, "test");

      const afterReset = checkRateLimit(request, "test", customConfig);
      expect(afterReset.isLimited).toBe(false);
    });
  });
});
