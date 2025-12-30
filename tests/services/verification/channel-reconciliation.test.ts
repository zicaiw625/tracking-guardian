
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  performEnhancedChannelReconciliation,
  getOrderCrossPlatformComparison,
  type MultiPlatformReconciliationResult,
} from "../../../app/services/verification/channel-reconciliation.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    reconciliationReport: {
      findMany: vi.fn(),
    },
    conversionLog: {
      findMany: vi.fn(),
    },
  },
}));

describe("Channel Reconciliation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("performEnhancedChannelReconciliation", () => {
    it("should reconcile multiple platforms", async () => {
      const shopId = "shop-1";
      const hours = 24;

      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue([
        {
          id: "report-1",
          shopId,
          platform: "google",
          reportDate: new Date(),
          shopifyOrders: 100,
          platformConversions: 95,
          valueDiscrepancy: 0,
        },
        {
          id: "report-2",
          shopId,
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 100,
          platformConversions: 90,
          valueDiscrepancy: 100,
        },
      ] as any);

      const result = await performEnhancedChannelReconciliation(shopId, hours);

      expect(result).toBeDefined();
      expect(result.platforms).toBeDefined();
      expect(Array.isArray(result.platforms)).toBe(true);
    });

    it("should detect missing orders", async () => {
      const shopId = "shop-1";
      const hours = 24;

      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue([
        {
          id: "report-1",
          shopId,
          platform: "google",
          reportDate: new Date(),
          shopifyOrders: 100,
          platformConversions: 80,
          valueDiscrepancy: 0,
        },
      ] as any);

      const result = await performEnhancedChannelReconciliation(shopId, hours);

      expect(result).toBeDefined();
      expect(result.discrepancies).toBeDefined();
      expect(result.discrepancies.missingOrders).toBeGreaterThan(0);
    });

    it("should detect value discrepancies", async () => {
      const shopId = "shop-1";
      const hours = 24;

      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue([
        {
          id: "report-1",
          shopId,
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 100,
          platformConversions: 100,
          valueDiscrepancy: 500,
        },
      ] as any);

      const result = await performEnhancedChannelReconciliation(shopId, hours);

      expect(result).toBeDefined();
      expect(result.discrepancies.valueDiscrepancies).toBeDefined();
    });
  });

  describe("getOrderCrossPlatformComparison", () => {
    it("should compare order across platforms", async () => {
      const shopId = "shop-1";
      const orderId = "order-123";

      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          shopId,
          orderId,
          destination: "google",
          status: "sent",
          orderValue: 100,
        },
        {
          id: "log-2",
          shopId,
          orderId,
          destination: "meta",
          status: "sent",
          orderValue: 100,
        },
      ] as any);

      const result = await getOrderCrossPlatformComparison(shopId, orderId);

      expect(result).toBeDefined();
      expect(result.orderId).toBe(orderId);
      expect(result.platforms).toBeDefined();
      expect(Array.isArray(result.platforms)).toBe(true);
    });

    it("should detect inconsistencies across platforms", async () => {
      const shopId = "shop-1";
      const orderId = "order-123";

      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          shopId,
          orderId,
          destination: "google",
          status: "sent",
          orderValue: 100,
        },
        {
          id: "log-2",
          shopId,
          orderId,
          destination: "meta",
          status: "failed",
          orderValue: 100,
        },
      ] as any);

      const result = await getOrderCrossPlatformComparison(shopId, orderId);

      expect(result).toBeDefined();
      expect(result.consistent).toBe(false);
    });
  });
});

