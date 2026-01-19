import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../app/utils/config.server", () => ({
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
    redisClientModule = await import("../../app/utils/redis-client") as typeof redisClientModule;
    rateLimitModule = await import("../../app/middleware/rate-limit");
    redisClientModule.__setMockConnected(true);
    redisClientModule.__setMockShouldFail(false);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  describe("checkRateLimitAsync with memory fallback", () => {
    it("should use memory store when Redis fails", async () => {
      redisClientModule.__setMockShouldFail(true);
      const result1 = await rateLimitModule.checkRateLimitAsync("test-key", 5, 60000);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4);
    });
    it("should enforce rate limits using memory store when Redis fails", async () => {
      redisClientModule.__setMockShouldFail(true);
      const maxRequests = 3;
      for (let i = 0; i < maxRequests; i++) {
        await rateLimitModule.checkRateLimitAsync("limit-test-key", maxRequests, 60000);
      }
      const result = await rateLimitModule.checkRateLimitAsync("limit-test-key", maxRequests, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
    it("should track different keys independently in memory store", async () => {
      redisClientModule.__setMockShouldFail(true);
      const maxRequests = 2;
      await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      const key1Result = await rateLimitModule.checkRateLimitAsync("key1", maxRequests, 60000);
      const key2Result = await rateLimitModule.checkRateLimitAsync("key2", maxRequests, 60000);
      expect(key1Result.allowed).toBe(false);
      expect(key2Result.allowed).toBe(true);
    });
  });
  describe("checkRateLimitSync with memory fallback", () => {
    it("should use memory store for sync checks", () => {
      const result = rateLimitModule.checkRateLimitSync("sync-test-key", 10, 60000);
      expect(result.allowed).toBe(true);
      expect(typeof result.remaining).toBe("number");
      expect(typeof result.resetAt).toBe("number");
    });
    it("should fall back to memory when Redis throws in sync mode", () => {
      redisClientModule.__setMockShouldFail(true);
      const result = rateLimitModule.checkRateLimitSync("sync-fail-key", 10, 60000);
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
      await rateLimitModule.checkRateLimitAsync("mem-key-1", 10, 60000);
      await rateLimitModule.checkRateLimitAsync("mem-key-2", 10, 60000);
      const size = rateLimitModule.getMemoryRateLimitStoreSize();
      expect(size).toBeGreaterThanOrEqual(2);
    });
  });
  describe("clearRateLimitStore", () => {
    it("should clear both Redis and memory stores", async () => {
      redisClientModule.__setMockShouldFail(true);
      await rateLimitModule.checkRateLimitAsync("clear-key", 10, 60000);
      await rateLimitModule.clearRateLimitStore();
      const size = rateLimitModule.getMemoryRateLimitStoreSize();
      expect(size).toBe(0);
    });
  });
  describe("Window expiration in memory store", () => {
    it("should reset count after window expires", async () => {
      redisClientModule.__setMockShouldFail(true);
      const windowMs = 100;
      const maxRequests = 2;
      await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      const blockedResult = await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      expect(blockedResult.allowed).toBe(false);
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));
      const allowedResult = await rateLimitModule.checkRateLimitAsync("expire-key", maxRequests, windowMs);
      expect(allowedResult.allowed).toBe(true);
    });
  });
});
