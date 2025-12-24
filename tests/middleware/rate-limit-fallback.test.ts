/**
 * Rate Limit Fallback Tests
 * 
 * Tests for the in-memory fallback rate limiting when Redis is unavailable.
 * This ensures rate limiting continues to work even during Redis outages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock redis-client before importing rate-limit
vi.mock("../../app/utils/redis-client", () => {
  let mockConnected = true;
  let mockShouldFail = false;
  
  return {
    getRedisClient: vi.fn().mockImplementation(async () => {
      if (mockShouldFail) {
        throw new Error("Redis connection failed");
      }
      return {
        incr: vi.fn().mockImplementation(async () => {
          if (mockShouldFail) {
            throw new Error("Redis incr failed");
          }
          return 1;
        }),
        expire: vi.fn().mockResolvedValue(true),
        ttl: vi.fn().mockResolvedValue(60),
        keys: vi.fn().mockResolvedValue([]),
        del: vi.fn().mockResolvedValue(1),
      };
    }),
    getRedisClientSync: vi.fn().mockImplementation(() => {
      if (mockShouldFail) {
        throw new Error("Redis connection failed");
      }
      return {
        incr: vi.fn().mockImplementation(async () => {
          if (mockShouldFail) {
            throw new Error("Redis incr failed");
          }
          return Promise.resolve(1);
        }),
        expire: vi.fn().mockResolvedValue(true),
      };
    }),
    getRedisConnectionInfo: vi.fn().mockImplementation(() => ({
      mode: mockConnected ? "redis" : "memory",
      connected: mockConnected,
    })),
    __setMockConnected: (connected: boolean) => {
      mockConnected = connected;
    },
    __setMockShouldFail: (shouldFail: boolean) => {
      mockShouldFail = shouldFail;
    },
  };
});

// Mock logger to avoid noise in tests
vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config
vi.mock("../../app/utils/config", () => ({
  RATE_LIMIT_CONFIG: {
    PIXEL_EVENTS: { maxRequests: 50, windowMs: 60000 },
    SURVEY: { maxRequests: 10, windowMs: 60000 },
    TRACKING: { maxRequests: 30, windowMs: 60000 },
    WEBHOOKS: { maxRequests: 100, windowMs: 60000 },
    MAX_KEYS: 1000,
    CLEANUP_INTERVAL_MS: 60000,
  },
}));

describe("Rate Limit Memory Fallback", () => {
  let rateLimitModule: typeof import("../../app/middleware/rate-limit");
  let redisClientModule: typeof import("../../app/utils/redis-client") & {
    __setMockConnected: (connected: boolean) => void;
    __setMockShouldFail: (shouldFail: boolean) => void;
  };

  beforeEach(async () => {
    vi.resetModules();
    
    // Re-import modules after reset
    redisClientModule = await import("../../app/utils/redis-client") as typeof redisClientModule;
    rateLimitModule = await import("../../app/middleware/rate-limit");
    
    // Reset mock state
    redisClientModule.__setMockConnected(true);
    redisClientModule.__setMockShouldFail(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("checkRateLimitAsync with memory fallback", () => {
    it("should use memory store when Redis fails", async () => {
      // Simulate Redis failure
      redisClientModule.__setMockShouldFail(true);
      
      const result1 = await rateLimitModule.checkRateLimitAsync("test-key", 5, 60000);
      
      // Should still return a valid result (from memory store)
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4); // 5 - 1
    });

    it("should enforce rate limits using memory store when Redis fails", async () => {
      redisClientModule.__setMockShouldFail(true);
      
      const maxRequests = 3;
      
      // Make requests up to the limit
      for (let i = 0; i < maxRequests; i++) {
        await rateLimitModule.checkRateLimitAsync("limit-test-key", maxRequests, 60000);
      }
      
      // Next request should be blocked
      const result = await rateLimitModule.checkRateLimitAsync("limit-test-key", maxRequests, 60000);
      
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should track different keys independently in memory store", async () => {
      redisClientModule.__setMockShouldFail(true);
      
      const maxRequests = 2;
      
      // Exhaust limit for key1
      await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      const key1Result = await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      
      // key2 should still have its own limit
      const key2Result = await rateLimitModule.checkRateLimitAsync("key2", maxRequests, 60000);
      
      expect(key1Result.allowed).toBe(false);
      expect(key2Result.allowed).toBe(true);
    });
  });

  describe("checkRateLimitSync with memory fallback", () => {
    it("should use memory store for sync checks", () => {
      // Even with Redis available, sync check uses memory as safety net
      const result = rateLimitModule.checkRateLimitSync("sync-test-key", 10, 60000);
      
      expect(result.allowed).toBe(true);
      expect(typeof result.remaining).toBe("number");
      expect(typeof result.resetAt).toBe("number");
    });

    it("should fall back to memory when Redis throws in sync mode", () => {
      redisClientModule.__setMockShouldFail(true);
      
      const result = rateLimitModule.checkRateLimitSync("sync-fail-key", 10, 60000);
      
      // Should still return a valid result
      expect(result.allowed).toBe(true);
    });
  });

  describe("getRateLimitBackendInfo", () => {
    it("should include usingFallback status", () => {
      const info = rateLimitModule.getRateLimitBackendInfo();
      
      expect(info).toHaveProperty("mode");
      expect(info).toHaveProperty("connected");
      expect(info).toHaveProperty("usingFallback");
    });
  });

  describe("getMemoryRateLimitStoreSize", () => {
    it("should return memory store size", async () => {
      redisClientModule.__setMockShouldFail(true);
      
      // Add some entries to memory store
      await rateLimitModule.checkRateLimitAsync("mem-key-1", 10, 60000);
      await rateLimitModule.checkRateLimitAsync("mem-key-2", 10, 60000);
      
      const size = rateLimitModule.getMemoryRateLimitStoreSize();
      
      expect(size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("clearRateLimitStore", () => {
    it("should clear both Redis and memory stores", async () => {
      redisClientModule.__setMockShouldFail(true);
      
      // Add entries
      await rateLimitModule.checkRateLimitAsync("clear-key", 10, 60000);
      
      // Clear
      await rateLimitModule.clearRateLimitStore();
      
      // Memory store should be cleared
      const size = rateLimitModule.getMemoryRateLimitStoreSize();
      expect(size).toBe(0);
    });
  });

  describe("Window expiration in memory store", () => {
    it("should reset count after window expires", async () => {
      redisClientModule.__setMockShouldFail(true);
      
      const windowMs = 100; // 100ms window for testing
      const maxRequests = 2;
      
      // Exhaust limit
      await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      const blockedResult = await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      expect(blockedResult.allowed).toBe(false);
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));
      
      // Should be allowed again
      const allowedResult = await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      expect(allowedResult.allowed).toBe(true);
    });
  });
});

