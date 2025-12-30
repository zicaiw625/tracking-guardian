
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectMissingParams,
  getMissingParamsStats,
  checkMissingParamsAlerts,
  type MissingParamsStats,
} from "../../../app/services/monitoring/missing-params.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    conversionLog: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("Missing Parameters Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectMissingParams", () => {
    it("should detect missing value parameter", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          destination: "google",
          _count: { id: 100 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count).mockResolvedValue(120);

      const result = await detectMissingParams(shopId, since, ["value"]);

      expect(result).toBeDefined();
      expect(result.missingValue).toBeDefined();
    });

    it("should detect missing currency parameter", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          destination: "meta",
          _count: { id: 80 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count).mockResolvedValue(100);

      const result = await detectMissingParams(shopId, since, ["currency"]);

      expect(result).toBeDefined();
      expect(result.missingCurrency).toBeDefined();
    });

    it("should detect multiple missing parameters", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          destination: "google",
          _count: { id: 50 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count).mockResolvedValue(100);

      const result = await detectMissingParams(shopId, since, ["value", "currency", "items"]);

      expect(result).toBeDefined();
      expect(result.missingValue).toBeDefined();
      expect(result.missingCurrency).toBeDefined();
      expect(result.missingItems).toBeDefined();
    });
  });

  describe("getMissingParamsStats", () => {
    it("should return statistics by platform", async () => {
      const shopId = "shop-1";
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      vi.mocked(prisma.conversionLog.groupBy).mockResolvedValue([
        {
          destination: "google",
          _count: { id: 90 },
        },
        {
          destination: "meta",
          _count: { id: 75 },
        },
      ] as any);

      vi.mocked(prisma.conversionLog.count).mockResolvedValue(100);

      const result = await getMissingParamsStats(shopId, since, ["value"]);

      expect(result).toBeDefined();
      expect(result.byPlatform).toBeDefined();
      expect(Array.isArray(result.byPlatform)).toBe(true);
    });
  });

  describe("checkMissingParamsAlerts", () => {
    it("should trigger alert when threshold is exceeded", () => {
      const stats: MissingParamsStats = {
        overall: {
          totalEvents: 100,
          missingValue: 30,
          missingCurrency: 20,
          missingItems: 10,
          missingEventId: 5,
        },
        byPlatform: [],
        byEventType: [],
      };

      const result = checkMissingParamsAlerts(stats, {
        overallThreshold: 0.2,
        criticalThreshold: 0.5,
      });

      expect(result.hasAlert).toBe(true);
      expect(result.alertLevel).toBe("warning");
    });

    it("should trigger critical alert when critical threshold is exceeded", () => {
      const stats: MissingParamsStats = {
        overall: {
          totalEvents: 100,
          missingValue: 60,
          missingCurrency: 50,
          missingItems: 30,
          missingEventId: 10,
        },
        byPlatform: [],
        byEventType: [],
      };

      const result = checkMissingParamsAlerts(stats, {
        overallThreshold: 0.2,
        criticalThreshold: 0.5,
      });

      expect(result.hasAlert).toBe(true);
      expect(result.alertLevel).toBe("critical");
    });

    it("should not trigger alert when below threshold", () => {
      const stats: MissingParamsStats = {
        overall: {
          totalEvents: 100,
          missingValue: 10,
          missingCurrency: 5,
          missingItems: 2,
          missingEventId: 1,
        },
        byPlatform: [],
        byEventType: [],
      };

      const result = checkMissingParamsAlerts(stats, {
        overallThreshold: 0.2,
        criticalThreshold: 0.5,
      });

      expect(result.hasAlert).toBe(false);
    });
  });
});

