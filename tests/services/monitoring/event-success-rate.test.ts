
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateSuccessRateByDestination,
  calculateSuccessRateByEventType,
  getSuccessRateHistory,
  type SuccessRateStats,
} from "../../../app/services/monitoring/event-success-rate.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    conversionLog: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Event Success Rate Monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateSuccessRateByDestination", () => {
    it("should calculate success rate for each platform", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          destination: "google",
          _count: { id: 100 },
          _sum: { orderValue: 10000 },
        },
        {
          destination: "meta",
          _count: { id: 80 },
          _sum: { orderValue: 8000 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count)
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(100);

      const result = await calculateSuccessRateByDestination(shopId, since);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle zero events gracefully", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.conversionLog.count).mockResolvedValue(0);

      const result = await calculateSuccessRateByDestination(shopId, since);

      expect(result).toEqual([]);
    });
  });

  describe("calculateSuccessRateByEventType", () => {
    it("should calculate success rate for each event type", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          eventType: "purchase",
          _count: { id: 100 },
          _sum: { orderValue: 10000 },
        },
        {
          eventType: "add_to_cart",
          _count: { id: 50 },
          _sum: { orderValue: 5000 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count)
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(60);

      const result = await calculateSuccessRateByEventType(shopId, since);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getSuccessRateHistory", () => {
    it("should return hourly success rate data", async () => {
      const shopId = "shop-1";
      const hours = 24;

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          hour: new Date(),
          destination: "google",
          _count: { id: 10 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count).mockResolvedValue(12);

      const result = await getSuccessRateHistory(shopId, hours);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

