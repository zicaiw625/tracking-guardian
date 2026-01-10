import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    conversionLog: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    reconciliationReport: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    alertConfig: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
  apiVersion: "2025-07",
}));

vi.mock("../../app/services/notification.server", () => ({
  sendAlert: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../app/utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import prisma from "../../app/db.server";
import {
  getReconciliationHistory,
  getReconciliationSummary,
} from "../../app/services/reconciliation.server";

describe("Reconciliation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("getReconciliationHistory", () => {
    it("should return formatted reconciliation history", async () => {
      const mockReports = [
        {
          id: "report1",
          platform: "meta",
          reportDate: new Date("2024-01-15"),
          shopifyOrders: 100,
          shopifyRevenue: { toString: () => "5000.00" },
          platformConversions: 95,
          platformRevenue: { toString: () => "4750.00" },
          orderDiscrepancy: 0.05,
          revenueDiscrepancy: 0.05,
          alertSent: false,
        },
      ];
      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue(mockReports as any);
      const result = await getReconciliationHistory("shop1", 30);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "report1",
        platform: "meta",
        reportDate: mockReports[0].reportDate,
        shopifyOrders: 100,
        shopifyRevenue: 5000,
        platformConversions: 95,
        platformRevenue: 4750,
        orderDiscrepancy: 0.05,
        revenueDiscrepancy: 0.05,
        alertSent: false,
      });
    });
    it("should query with correct date range", async () => {
      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue([]);
      await getReconciliationHistory("shop1", 7);
      expect(prisma.reconciliationReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: "shop1",
            reportDate: expect.objectContaining({
              gte: expect.any(Date),
            }),
          },
          orderBy: { reportDate: "desc" },
        })
      );
    });
  });
  describe("getReconciliationSummary", () => {
    it("should return summary grouped by platform", async () => {
      const mockReports = [
        {
          id: "r1",
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 50,
          shopifyRevenue: { toString: () => "2500.00" },
          platformConversions: 48,
          platformRevenue: { toString: () => "2400.00" },
          orderDiscrepancy: 0.04,
          revenueDiscrepancy: 0.04,
          alertSent: false,
        },
        {
          id: "r2",
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 60,
          shopifyRevenue: { toString: () => "3000.00" },
          platformConversions: 55,
          platformRevenue: { toString: () => "2750.00" },
          orderDiscrepancy: 0.083,
          revenueDiscrepancy: 0.083,
          alertSent: false,
        },
        {
          id: "r3",
          platform: "google",
          reportDate: new Date(),
          shopifyOrders: 30,
          shopifyRevenue: { toString: () => "1500.00" },
          platformConversions: 29,
          platformRevenue: { toString: () => "1450.00" },
          orderDiscrepancy: 0.033,
          revenueDiscrepancy: 0.033,
          alertSent: false,
        },
      ];
      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue(mockReports as any);
      const result = await getReconciliationSummary("shop1");
      expect(result.meta).toBeDefined();
      expect(result.google).toBeDefined();
      expect(result.meta.totalShopifyOrders).toBe(110);
      expect(result.meta.totalPlatformConversions).toBe(103);
      expect(result.meta.reports).toHaveLength(2);
      expect(result.google.totalShopifyOrders).toBe(30);
    });
    it("should calculate average discrepancy correctly", async () => {
      const mockReports = [
        {
          id: "r1",
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 100,
          shopifyRevenue: { toString: () => "5000.00" },
          platformConversions: 90,
          platformRevenue: { toString: () => "4500.00" },
          orderDiscrepancy: 0.10,
          revenueDiscrepancy: 0.10,
          alertSent: false,
        },
        {
          id: "r2",
          platform: "meta",
          reportDate: new Date(),
          shopifyOrders: 100,
          shopifyRevenue: { toString: () => "5000.00" },
          platformConversions: 80,
          platformRevenue: { toString: () => "4000.00" },
          orderDiscrepancy: 0.20,
          revenueDiscrepancy: 0.20,
          alertSent: false,
        },
      ];
      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue(mockReports as any);
      const result = await getReconciliationSummary("shop1");
      expect(result.meta.avgDiscrepancy).toBeCloseTo(0.15, 2);
    });
    it("should return empty object when no reports exist", async () => {
      vi.mocked(prisma.reconciliationReport.findMany).mockResolvedValue([]);
      const result = await getReconciliationSummary("shop1");
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
