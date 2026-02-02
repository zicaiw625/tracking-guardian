import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../app/utils/cache", () => ({
  billingCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../../app/db.server", () => ({
  default: {
    monthlyUsage: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
    conversionJob: {
      findUnique: vi.fn(),
    },
    conversionLog: {
      findFirst: vi.fn(),
    },
    pixelEventReceipt: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from "../../../app/db.server";
import { billingCache } from "../../../app/utils/cache";
import {
  getCurrentYearMonth,
  getMonthDateRange,
  getOrCreateMonthlyUsage,
  getMonthlyUsageCount,
  isOrderAlreadyCounted,
  incrementMonthlyUsage,
  incrementMonthlyUsageIdempotent,
  tryReserveUsageSlot,
  decrementMonthlyUsage,
} from "../../../app/services/billing/usage.server";

describe("Usage Tracking Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  describe("getCurrentYearMonth", () => {
    it("should return current year-month in YYYY-MM format", () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      const result = getCurrentYearMonth();
      expect(result).toBe("2025-06");
    });
    it("should pad single-digit months with zero", () => {
      vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));
      const result = getCurrentYearMonth();
      expect(result).toBe("2025-01");
    });
    it("should handle December correctly", () => {
      vi.setSystemTime(new Date("2025-12-25T10:00:00Z"));
      const result = getCurrentYearMonth();
      expect(result).toBe("2025-12");
    });
  });
  describe("getMonthDateRange", () => {
    it("should return correct date range for a month", () => {
      const { start, end } = getMonthDateRange("2025-06");
      expect(start.toISOString()).toBe("2025-06-01T00:00:00.000Z");
      expect(end.toISOString()).toBe("2025-07-01T00:00:00.000Z");
    });
    it("should handle year boundary correctly", () => {
      const { start, end } = getMonthDateRange("2025-12");
      expect(start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
      expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
    it("should handle February correctly", () => {
      const { start, end } = getMonthDateRange("2025-02");
      expect(start.toISOString()).toBe("2025-02-01T00:00:00.000Z");
      expect(end.toISOString()).toBe("2025-03-01T00:00:00.000Z");
    });
  });
  describe("getOrCreateMonthlyUsage", () => {
    it("should create new usage record if not exists", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      const mockUsage = {
        id: "usage-1",
        shopId: "shop-123",
        yearMonth: "2025-06",
        sentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.monthlyUsage.create).mockResolvedValue(mockUsage as any);
      const result = await getOrCreateMonthlyUsage("shop-123");
      expect(result.id).toBe("usage-1");
      expect(result.sentCount).toBe(0);
      expect(prisma.monthlyUsage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: "shop-123",
            yearMonth: "2025-06",
            sentCount: 0,
          }),
        })
      );
    });
    it("should return existing usage record", async () => {
      const mockUsage = {
        id: "usage-1",
        shopId: "shop-123",
        yearMonth: "2025-05",
        sentCount: 150,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue(mockUsage as any);
      const result = await getOrCreateMonthlyUsage("shop-123", "2025-05");
      expect(result.sentCount).toBe(150);
      expect(prisma.monthlyUsage.create).not.toHaveBeenCalled();
    });
    it("should use provided year-month", async () => {
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.monthlyUsage.create).mockResolvedValue({ id: "1", shopId: "shop-123", yearMonth: "2025-03", sentCount: 0, createdAt: new Date(), updatedAt: new Date() } as any);
      await getOrCreateMonthlyUsage("shop-123", "2025-03");
      expect(prisma.monthlyUsage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: "shop-123",
            yearMonth: "2025-03",
          }),
        })
      );
    });
  });
  describe("getMonthlyUsageCount", () => {
    it("should return current count from database", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({
        sentCount: 250,
      } as any);
      const count = await getMonthlyUsageCount("shop-123");
      expect(count).toBe(250);
    });
    it("should return 0 when no record exists", async () => {
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue(null);
      const count = await getMonthlyUsageCount("shop-123");
      expect(count).toBe(0);
    });
  });
  describe("isOrderAlreadyCounted", () => {
    it("should return true when pixelEventReceipt exists with value and currency", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue({
        id: "receipt-1",
      } as any);
      const result = await isOrderAlreadyCounted("shop-123", "order-456");
      expect(result).toBe(true);
      expect(prisma.pixelEventReceipt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopId: "shop-123",
            orderKey: "order-456",
            hmacMatched: true,
            totalValue: { not: null },
            currency: { not: null },
          }),
        })
      );
    });
    it("should return false when no receipt", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      const result = await isOrderAlreadyCounted("shop-123", "order-456");
      expect(result).toBe(false);
    });
    it("should return false when receipt missing value or currency (filtered by DB)", async () => {
      // The DB query filters out records with null totalValue or currency, so we mock null return
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      const result = await isOrderAlreadyCounted("shop-123", "order-456");
      expect(result).toBe(false);
      expect(prisma.pixelEventReceipt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            totalValue: { not: null },
            currency: { not: null },
          }),
        })
      );
    });
  });
  describe("incrementMonthlyUsage", () => {
    it("should increment and return new count", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 101 } as any);
      const count = await incrementMonthlyUsage("shop-123", "order-456");
      expect(count).toBe(101);
      expect(billingCache.delete).toHaveBeenCalledWith("billing:shop-123");
    });
  });
  describe("incrementMonthlyUsageIdempotent", () => {
    it("should return incremented=true for new order", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 51 } as any);
      const result = await incrementMonthlyUsageIdempotent("shop-123", "order-789");
      expect(result.incremented).toBe(true);
      expect(result.current).toBe(51);
    });
    it("should return incremented=false for duplicate order", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue({
        payloadJson: { hmacMatched: true, data: { value: 1, currency: "USD" } },
      } as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 50 } as any);
      const result = await incrementMonthlyUsageIdempotent("shop-123", "order-789");
      expect(result.incremented).toBe(false);
      expect(result.current).toBe(50);
    });
  });
  describe("tryReserveUsageSlot", () => {
    it("should reserve slot when under limit", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 51 } as any);
      const result = await tryReserveUsageSlot("shop-123", "order-100", 1000);
      expect(result.reserved).toBe(true);
      expect(result.current).toBe(51);
      expect(result.limit).toBe(1000);
      expect(result.remaining).toBe(948); // limit - current - 1 when reserved
    });
    it("should fail when at limit", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 1000 } as any);
      const result = await tryReserveUsageSlot("shop-123", "order-100", 1000);
      expect(result.reserved).toBe(false);
      expect(result.current).toBe(1000);
      expect(result.remaining).toBe(0);
    });
    it("should return reserved=false for duplicate order", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue({
        payloadJson: { hmacMatched: true, data: { value: 1, currency: "USD" } },
      } as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 500 } as any);
      const result = await tryReserveUsageSlot("shop-123", "order-100", 1000);
      expect(result.reserved).toBe(false);
      expect(result.current).toBe(500);
      expect(result.remaining).toBe(500);
    });
  });
  describe("decrementMonthlyUsage", () => {
    it("should decrement usage count", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 99 } as any);
      const count = await decrementMonthlyUsage("shop-123");
      expect(count).toBe(99);
      expect(billingCache.delete).toHaveBeenCalledWith("billing:shop-123");
    });
    it("should not go below zero", async () => {
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 0 } as any);
      const count = await decrementMonthlyUsage("shop-123");
      expect(count).toBe(0);
    });
    it("should return 0 when no record exists", async () => {
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue(null);
      const count = await decrementMonthlyUsage("shop-123");
      expect(count).toBe(0);
    });
  });
  describe("Cache Invalidation", () => {
    it("should invalidate cache when usage changes", async () => {
      vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));
      vi.mocked(prisma.monthlyUsage.upsert).mockResolvedValue(undefined as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 1 } as any);
      await incrementMonthlyUsage("shop-123", "order-new");
      expect(billingCache.delete).toHaveBeenCalledWith("billing:shop-123");
    });
    it("should invalidate cache for duplicate orders in incrementMonthlyUsageIdempotent", async () => {
      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue({
        payloadJson: { hmacMatched: true, data: { value: 1, currency: "USD" } },
      } as any);
      vi.mocked(prisma.monthlyUsage.findUnique).mockResolvedValue({ sentCount: 100 } as any);
      await incrementMonthlyUsageIdempotent("shop-123", "order-existing");
      expect(billingCache.delete).toHaveBeenCalledWith("billing:shop-123");
    });
  });
});
