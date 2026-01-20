import { describe, it, expect, beforeEach, vi } from "vitest";
import { getEventSuccessRate } from "../../../app/services/monitoring/event-success-rate.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    pixelEventReceipt: {
      findMany: vi.fn(),
    },
  },
}));

describe("Event Success Rate Monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEventSuccessRate", () => {
    it("should calculate success rate for each platform", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        {
          payloadJson: {
            platform: "google",
            data: { value: 10, currency: "USD" },
          },
        },
        {
          payloadJson: {
            platform: "google",
            data: { value: 20, currency: "EUR" },
          },
        },
        {
          payloadJson: {
            destination: "meta",
            data: { value: 15, currency: "GBP" },
          },
        },
        {
          payloadJson: {
            platform: "meta",
            data: {}, // missing value/currency -> failure
          },
        },
      ] as any);
      const result = await getEventSuccessRate(shopId, 24);
      expect(result).toBeDefined();
      expect(result.total).toBe(4);
      expect(result.success).toBe(3);
      expect(result.failure).toBe(1);
      expect(result.successRate).toBe(75);
      expect(result.failureRate).toBe(25);
      expect(result.byPlatform).toBeDefined();
      expect(result.byPlatform.google).toBeDefined();
      expect(result.byPlatform.google.total).toBe(2);
      expect(result.byPlatform.google.success).toBe(2);
      expect(result.byPlatform.google.successRate).toBe(100);
      expect(result.byPlatform.meta).toBeDefined();
      expect(result.byPlatform.meta.total).toBe(2);
      expect(result.byPlatform.meta.success).toBe(1);
      expect(result.byPlatform.meta.failure).toBe(1);
      expect(result.byPlatform.meta.successRate).toBe(50);
    });

    it("should handle zero events gracefully", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      const result = await getEventSuccessRate(shopId, 24);
      expect(result).toBeDefined();
      expect(result.total).toBe(0);
      expect(result.success).toBe(0);
      expect(result.failure).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.failureRate).toBe(0);
      expect(result.byPlatform).toEqual({});
    });

    it("should use unknown platform when payload has no platform or destination", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        {
          payloadJson: {
            data: { value: 5, currency: "USD" },
          },
        },
      ] as any);
      const result = await getEventSuccessRate(shopId, 24);
      expect(result.byPlatform.unknown).toBeDefined();
      expect(result.byPlatform.unknown.total).toBe(1);
      expect(result.byPlatform.unknown.success).toBe(1);
    });

    it("should treat missing or null value as failure", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { payloadJson: { platform: "google", data: { value: null, currency: "USD" } } },
        { payloadJson: { platform: "google", data: { currency: "USD" } } },
        { payloadJson: { platform: "google", data: { value: 0, currency: "USD" } } }, // 0 is valid
      ] as any);
      const result = await getEventSuccessRate(shopId, 24);
      expect(result.success).toBe(1); // only value: 0
      expect(result.failure).toBe(2);
    });
  });
});
