import { describe, it, expect, beforeEach, vi } from "vitest";
/* eslint-disable-next-line import/no-unresolved -- ts resolution in test env */
import { tryReserveUsageSlot } from "../../../../app/services/billing/usage.server";
/* eslint-disable-next-line import/no-unresolved -- ts resolution in test env */
import { checkAndReserveBillingSlot } from "../../../../app/services/billing/gate.server";

vi.mock("../../../../app/db.server", () => ({
  default: {
    $transaction: vi.fn(),
    conversionJob: {
      findUnique: vi.fn(),
    },
    conversionLog: {
      findFirst: vi.fn(),
    },
    monthlyUsage: {
      findUnique: vi.fn(),
      create: vi.fn(),
      $executeRaw: vi.fn(),
    },
  },
}));

vi.mock("../../../../app/utils/logger.server", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../../app/utils/cache", () => ({
  billingCache: {
    delete: vi.fn(),
  },
}));

/* eslint-disable-next-line import/no-unresolved -- ts resolution in test env */
import prisma from "../../../../app/db.server";

describe("Billing Concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("tryReserveUsageSlot", () => {
    it("should prevent exceeding limit under concurrent access", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const limit = 10;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 0 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce(null) 
              .mockResolvedValueOnce({ sentCount: 10 }), 
            $executeRaw: vi.fn().mockResolvedValue(1), 
          },
        };
        return callback(tx);
      });
      const result = await tryReserveUsageSlot(shopId, orderId, limit);
      expect(result.reserved).toBe(true);
      expect(result.current).toBeLessThanOrEqual(limit);
    });
    it("should handle serialization errors with retries", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const limit = 10;
      let attemptCount = 0;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error("Serialization failure");
          (error as any).code = "P40001";
          throw error;
        }
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 0 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce(null)
              .mockResolvedValueOnce({ sentCount: 5 }),
            $executeRaw: vi.fn().mockResolvedValue(1),
          },
        };
        return callback(tx);
      });
      const result = await tryReserveUsageSlot(shopId, orderId, limit);
      expect(result.reserved).toBe(true);
      expect(attemptCount).toBe(2);
    });
    it("should reject reservation when limit is reached", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const limit = 10;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 10 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce({ sentCount: 10 }) 
              .mockResolvedValueOnce({ sentCount: 10 }), 
            $executeRaw: vi.fn().mockResolvedValue(0), 
          },
        };
        return callback(tx);
      });
      const result = await tryReserveUsageSlot(shopId, orderId, limit);
      expect(result.reserved).toBe(false);
      expect(result.current).toBe(10);
      expect(result.remaining).toBe(0);
    });
    it("should handle already counted orders", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const limit = 10;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue({ status: "completed" }),
          },
          monthlyUsage: {
            findUnique: vi.fn().mockResolvedValue({ sentCount: 5 }),
          },
        };
        return callback(tx);
      });
      const result = await tryReserveUsageSlot(shopId, orderId, limit);
      expect(result.reserved).toBe(false);
      expect(result.current).toBe(5);
    });
    it("should test concurrent reservations with upsert", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const limit = 10;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        expect(options?.isolationLevel).toBe("Serializable");
        expect(options?.maxWait).toBe(5000);
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 0 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce(null) 
              .mockResolvedValueOnce({ sentCount: 5 }), 
            $executeRaw: vi.fn().mockResolvedValue(1), 
          },
        };
        return callback(tx);
      });
      const result = await tryReserveUsageSlot(shopId, orderId, limit);
      expect(result.reserved).toBe(true);
      expect(result.current).toBe(5);
    });
  });
  describe("checkAndReserveBillingSlot", () => {
    it("should use atomic update to prevent race conditions", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const shopPlan = "starter" as const;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        expect(options?.isolationLevel).toBe("Serializable");
        expect(options?.maxWait).toBe(5000);
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 0 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce(null) 
              .mockResolvedValueOnce({ sentCount: 6 }), 
            $executeRaw: vi.fn().mockResolvedValue(1), 
          },
        };
        return callback(tx);
      });
      const result = await checkAndReserveBillingSlot(shopId, shopPlan, orderId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.current).toBeGreaterThan(0);
        expect(result.value.current).toBeLessThanOrEqual(result.value.limit);
      }
    });
    it("should handle serialization errors with retries", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const shopPlan = "starter" as const;
      let attemptCount = 0;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        attemptCount++;
        if (attemptCount < 2) {
          const error = new Error("Serialization failure");
          (error as any).code = "P40001";
          throw error;
        }
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 0 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce(null)
              .mockResolvedValueOnce({ sentCount: 5 }),
            $executeRaw: vi.fn().mockResolvedValue(1),
          },
        };
        return callback(tx);
      });
      const result = await checkAndReserveBillingSlot(shopId, shopPlan, orderId);
      expect(result.ok).toBe(true);
      expect(attemptCount).toBe(2);
    });
    it("should reject when limit is exceeded", async () => {
      const shopId = "shop1";
      const orderId = "order1";
      const shopPlan = "starter" as const;
      prisma.$transaction.mockImplementation(async (callback, _options) => {
        const tx = {
          conversionJob: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
          conversionLog: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          monthlyUsage: {
            upsert: vi.fn().mockResolvedValue({ sentCount: 1000 }),
            findUnique: vi.fn()
              .mockResolvedValueOnce({ sentCount: 1000 })
              .mockResolvedValueOnce({ sentCount: 1000 }),
            $executeRaw: vi.fn().mockResolvedValue(0), 
          },
        };
        return callback(tx);
      });
      const result = await checkAndReserveBillingSlot(shopId, shopPlan, orderId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.current).toBeGreaterThanOrEqual(result.value.limit);
      }
    });
  });
});
