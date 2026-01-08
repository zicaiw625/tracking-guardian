import { describe, it, expect, beforeEach, vi } from "vitest";
import { tryReserveUsageSlot } from "../../../../app/services/billing/usage.server";
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

      // 模拟使用 upsert 创建记录，然后原子更新
      prisma.$transaction.mockImplementation(async (callback, options) => {
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
              .mockResolvedValueOnce(null) // 第一次查找不存在
              .mockResolvedValueOnce({ sentCount: 10 }), // 更新后查找返回新值
            $executeRaw: vi.fn().mockResolvedValue(1), // 成功更新
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
      prisma.$transaction.mockImplementation(async (callback, options) => {
        attemptCount++;
        if (attemptCount < 2) {
          // 第一次尝试失败(模拟序列化错误)
          const error = new Error("Serialization failure");
          (error as any).code = "P40001";
          throw error;
        }
        
        // 第二次尝试成功
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

      // 模拟usage已达到限制
      prisma.$transaction.mockImplementation(async (callback, options) => {
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
              .mockResolvedValueOnce({ sentCount: 10 }) // 更新前查找
              .mockResolvedValueOnce({ sentCount: 10 }), // 更新失败后查找
            $executeRaw: vi.fn().mockResolvedValue(0), // 更新失败(因为WHERE条件)
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

      prisma.$transaction.mockImplementation(async (callback, options) => {
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

      // 模拟并发场景：记录不存在，先upsert创建，然后原子更新
      prisma.$transaction.mockImplementation(async (callback, options) => {
        // 验证使用了正确的隔离级别
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
              .mockResolvedValueOnce(null) // 初始查找不存在
              .mockResolvedValueOnce({ sentCount: 5 }), // 更新后查找
            $executeRaw: vi.fn().mockResolvedValue(1), // 成功更新
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

      prisma.$transaction.mockImplementation(async (callback, options) => {
        // 验证使用了正确的隔离级别
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
              .mockResolvedValueOnce(null) // 初始查找不存在
              .mockResolvedValueOnce({ sentCount: 6 }), // 更新后查找
            $executeRaw: vi.fn().mockResolvedValue(1), // 原子更新成功
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
      prisma.$transaction.mockImplementation(async (callback, options) => {
        attemptCount++;
        if (attemptCount < 2) {
          // 第一次尝试失败(模拟序列化错误)
          const error = new Error("Serialization failure");
          (error as any).code = "P40001";
          throw error;
        }
        
        // 第二次尝试成功
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

      prisma.$transaction.mockImplementation(async (callback, options) => {
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
            $executeRaw: vi.fn().mockResolvedValue(0), // 更新失败
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
