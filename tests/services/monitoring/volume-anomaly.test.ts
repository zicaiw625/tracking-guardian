import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectVolumeAnomaly,
  calculateBaseline,
  checkVolumeDropAlerts,
} from "../../../app/services/monitoring/volume-anomaly.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    pixelEventReceipt: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Event Volume Anomaly Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("calculateBaseline", () => {
    it("should calculate 7-day average baseline", async () => {
      const shopId = "shop-1";
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { createdAt: new Date(base.getTime() - 1 * 86400000) },
        ...Array(99).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })),
      ] as any);
      const result = await calculateBaseline(shopId, 7);
      expect(result).toBeDefined();
      expect(result.average).toBeGreaterThanOrEqual(0);
      expect(result.median).toBeGreaterThanOrEqual(0);
    });
    it("should calculate 30-day baseline with no data", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      const result = await calculateBaseline(shopId, 30);
      expect(result).toBeDefined();
      expect(result.average).toBe(0);
      expect(result.median).toBe(0);
    });
  });
  describe("detectVolumeAnomaly", () => {
    it("should detect significant volume drop", async () => {
      const shopId = "shop-1";
      const hours = 24;
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })) as any
      );
      vi.mocked(prisma.pixelEventReceipt.count).mockResolvedValue(5);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result).toBeDefined();
      expect(result.isAnomaly).toBe(true);
      expect(result.deviationPercent).toBeLessThan(-20);
    });
    it("should not detect anomaly for normal volume", async () => {
      const shopId = "shop-1";
      const hours = 24;
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })) as any
      );
      vi.mocked(prisma.pixelEventReceipt.count).mockResolvedValue(15);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result).toBeDefined();
      expect(result.isAnomaly).toBe(false);
    });
    it("should return severity", async () => {
      const shopId = "shop-1";
      const hours = 24;
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })) as any
      );
      vi.mocked(prisma.pixelEventReceipt.count).mockResolvedValue(30);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result.severity).toBeDefined();
      expect(["low", "medium", "high"]).toContain(result.severity);
    });
  });
  describe("checkVolumeDropAlerts", () => {
    it("should trigger alert when drop percentage exceeds threshold", async () => {
      const shopId = "shop-1";
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })) as any
      );
      vi.mocked(prisma.pixelEventReceipt.count).mockResolvedValue(5);
      const result = await checkVolumeDropAlerts(shopId, 0.5);
      expect(result.alert).toBe(true);
      expect(result.dropPercent).toBeGreaterThan(50);
    });
    it("should not trigger alert when drop is below threshold", async () => {
      const shopId = "shop-1";
      const base = new Date();
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue(
        Array(100).fill(null).map((_, i) => ({ createdAt: new Date(base.getTime() - (i % 7) * 86400000) })) as any
      );
      vi.mocked(prisma.pixelEventReceipt.count).mockResolvedValue(85);
      const result = await checkVolumeDropAlerts(shopId, 0.5);
      expect(result.alert).toBe(false);
    });
  });
});
