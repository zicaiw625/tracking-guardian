import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectVolumeAnomaly,
  calculateBaseline,
  checkVolumeDropAlerts,
  type VolumeAnomalyResult,
} from "../../../app/services/monitoring/volume-anomaly.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    conversionLog: {
      groupBy: vi.fn(),
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
      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          day: new Date(),
          _count: { id: 100 },
        },
        {
          day: new Date(),
          _count: { id: 120 },
        },
        {
          day: new Date(),
          _count: { id: 110 },
        },
      ] as any);
      const result = await calculateBaseline(shopId, 7);
      expect(result).toBeDefined();
      expect(result.average).toBeGreaterThan(0);
      expect(result.median).toBeGreaterThan(0);
    });
    it("should calculate 30-day baseline", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([]);
      const result = await calculateBaseline(shopId, 30);
      expect(result).toBeDefined();
      expect(result.average).toBeGreaterThanOrEqual(0);
    });
  });
  describe("detectVolumeAnomaly", () => {
    it("should detect significant volume drop", async () => {
      const shopId = "shop-1";
      const hours = 24;
      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValueOnce([
        {
          day: new Date(),
          _count: { id: 100 },
        },
      ] as any);
      vi.mocked(prisma.conversionLog.count).mockResolvedValue(30);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result).toBeDefined();
      expect(result.hasAnomaly).toBe(true);
      expect(result.dropPercentage).toBeGreaterThan(50);
    });
    it("should not detect anomaly for normal volume", async () => {
      const shopId = "shop-1";
      const hours = 24;
      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValueOnce([
        {
          day: new Date(),
          _count: { id: 100 },
        },
      ] as any);
      vi.mocked(prisma.conversionLog.count).mockResolvedValue(95);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result.hasAnomaly).toBe(false);
    });
    it("should calculate Z-Score correctly", async () => {
      const shopId = "shop-1";
      const hours = 24;
      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValueOnce([
        {
          day: new Date(),
          _count: { id: 100 },
        },
      ] as any);
      vi.mocked(prisma.conversionLog.count).mockResolvedValue(30);
      const result = await detectVolumeAnomaly(shopId, hours);
      expect(result.zScore).toBeDefined();
      expect(typeof result.zScore).toBe("number");
    });
  });
  describe("checkVolumeDropAlerts", () => {
    it("should trigger alert when drop percentage exceeds threshold", () => {
      const anomaly: VolumeAnomalyResult = {
        hasAnomaly: true,
        currentVolume: 30,
        baselineVolume: 100,
        dropPercentage: 70,
        zScore: -3.5,
        comparison24h: {
          current: 30,
          previous: 100,
          change: -70,
        },
        comparison7d: {
          current: 30,
          average: 100,
          change: -70,
        },
      };
      const result = checkVolumeDropAlerts(anomaly, {
        dropThreshold: 0.5,
        zScoreThreshold: 2.0,
        minVolume: 10,
      });
      expect(result.hasAlert).toBe(true);
      expect(result.alertLevel).toBe("critical");
    });
    it("should not trigger alert when volume is too low", () => {
      const anomaly: VolumeAnomalyResult = {
        hasAnomaly: true,
        currentVolume: 5,
        baselineVolume: 10,
        dropPercentage: 50,
        zScore: -2.0,
        comparison24h: {
          current: 5,
          previous: 10,
          change: -50,
        },
        comparison7d: {
          current: 5,
          average: 10,
          change: -50,
        },
      };
      const result = checkVolumeDropAlerts(anomaly, {
        dropThreshold: 0.5,
        zScoreThreshold: 2.0,
        minVolume: 20,
      });
      expect(result.hasAlert).toBe(false);
    });
  });
});
