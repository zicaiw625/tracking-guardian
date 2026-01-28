import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    eventNonce: {
      deleteMany: vi.fn(),
    },
    migrationDraft: {
      deleteMany: vi.fn(),
    },
    gDPRJob: {
      deleteMany: vi.fn(),
    },
    shop: {
      findMany: vi.fn(),
    },
    surveyResponse: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    pixelEventReceipt: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    webhookLog: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    scanReport: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    deliveryAttempt: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { cleanupExpiredData } from "../../app/cron/tasks/cleanup";
import prisma from "../../app/db.server";
import { logger } from "../../app/utils/logger.server";

describe("Cleanup Task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.eventNonce.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (prisma.migrationDraft.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (prisma.gDPRJob.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (prisma.shop.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe("cleanupExpiredData", () => {
    it("should clean up expired event nonces", async () => {
      (prisma.eventNonce.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });
      const result = await cleanupExpiredData();
      expect(prisma.eventNonce.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
      expect(result.eventNoncesDeleted).toBe(5);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("5 expired event nonces")
      );
    });
    it("should clean up old GDPR jobs", async () => {
      (prisma.gDPRJob.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });
      const result = await cleanupExpiredData();
      expect(prisma.gDPRJob.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ["completed", "failed"] },
          createdAt: { lt: expect.any(Date) },
        },
      });
      expect(result.gdprJobsDeleted).toBe(3);
    });
    it("should return zero counts when no data to clean", async () => {
      const result = await cleanupExpiredData();
      expect(result.shopsProcessed).toBe(0);
      expect(result.surveyResponsesDeleted).toBe(0);
      expect(result.auditLogsDeleted).toBe(0);
    });
    it("should process shops with data retention configured", async () => {
      const mockShops = [
        { id: "shop1", shopDomain: "shop1.myshopify.com", dataRetentionDays: 90 },
        { id: "shop2", shopDomain: "shop2.myshopify.com", dataRetentionDays: 30 },
      ];
      (prisma.shop.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockShops);
      (prisma.surveyResponse.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.pixelEventReceipt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.webhookLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.scanReport.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.deliveryAttempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await cleanupExpiredData();
      expect(result.shopsProcessed).toBe(2);
      expect(prisma.shop.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          dataRetentionDays: { gt: 0 },
        },
        select: {
          id: true,
          shopDomain: true,
          dataRetentionDays: true,
        },
      });
    });
    it("should enforce minimum 180 day retention for audit logs", async () => {
      const mockShops = [{ id: "shop1", shopDomain: "shop1.myshopify.com", dataRetentionDays: 30 }];
      (prisma.shop.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockShops);
      (prisma.surveyResponse.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.pixelEventReceipt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.webhookLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.scanReport.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.deliveryAttempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await cleanupExpiredData();
      expect(prisma.auditLog.findMany).toHaveBeenCalled();
      const auditLogCall = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const cutoffDate = auditLogCall.where.createdAt.lt;
      const expectedMinCutoff = new Date();
      expectedMinCutoff.setDate(expectedMinCutoff.getDate() - 180);
      expect(cutoffDate.getTime()).toBeLessThanOrEqual(expectedMinCutoff.getTime() + 86400000);
    });
    it("should delete scan reports based on retention period", async () => {
      const mockShops = [{ id: "shop1", shopDomain: "shop1.myshopify.com", dataRetentionDays: 90 }];
      const oldScanReports = [{ id: "scan6" }, { id: "scan7" }];
      (prisma.shop.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockShops);
      (prisma.surveyResponse.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.pixelEventReceipt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.webhookLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.scanReport.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(oldScanReports);
      (prisma.scanReport.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
      (prisma.deliveryAttempt.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (prisma.eventLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await cleanupExpiredData();
      expect(result.scanReportsDeleted).toBe(2);
      expect(prisma.scanReport.findMany).toHaveBeenCalled();
      const scanReportCall = (prisma.scanReport.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(scanReportCall.where.shopId).toBe("shop1");
      expect(scanReportCall.where.createdAt).toBeDefined();
      expect(scanReportCall.select).toEqual({ id: true });
    });
  });
});
