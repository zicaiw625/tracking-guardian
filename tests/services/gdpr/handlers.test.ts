

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    conversionLog: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversionJob: {
      deleteMany: vi.fn(),
    },
    pixelEventReceipt: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    surveyResponse: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    webhookLog: {
      deleteMany: vi.fn(),
    },
    scanReport: {
      deleteMany: vi.fn(),
    },
    reconciliationReport: {
      deleteMany: vi.fn(),
    },
    alertConfig: {
      deleteMany: vi.fn(),
    },
    pixelConfig: {
      deleteMany: vi.fn(),
    },
    monthlyUsage: {
      deleteMany: vi.fn(),
    },
    eventNonce: {
      deleteMany: vi.fn(),
    },
    pixelEventNonce: {
      deleteMany: vi.fn(),
    },
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

vi.mock("../../../app/services/audit.server", () => ({
  createAuditLog: vi.fn(),
}));

import prisma from "../../../app/db.server";
import {
  processDataRequest,
  processCustomerRedact,
  processShopRedact,
} from "../../../app/services/gdpr/handlers";

describe("GDPR Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processDataRequest", () => {
    const mockShop = {
      id: "shop-123",
      shopDomain: "test-shop.myshopify.com",
    };

    it("should export customer data for specified orders", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(mockShop as never);

      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          orderId: "1001",
          orderNumber: "1001",
          orderValue: 100,
          currency: "USD",
          platform: "meta",
          eventType: "purchase",
          status: "sent",
          clientSideSent: true,
          serverSideSent: true,
          createdAt: new Date("2024-01-01"),
          sentAt: new Date("2024-01-01"),
        },
      ] as never);

      vi.mocked(prisma.surveyResponse.findMany).mockResolvedValue([]);
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);

      const result = await processDataRequest("test-shop.myshopify.com", {
        customer_id: 123,
        orders_requested: [1001],
        data_request_id: 456,
      });

      expect(result.dataRequestId).toBe(456);
      expect(result.customerId).toBe(123);
      expect(result.ordersIncluded).toEqual([1001]);
      expect(result.dataLocated.conversionLogs.count).toBe(1);
      expect(result.exportedData.conversionLogs).toHaveLength(1);
      expect(result.exportFormat).toBe("json");
      expect(result.exportVersion).toBe("1.0");
    });

    it("should return empty result when shop not found", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);

      const result = await processDataRequest("unknown-shop.myshopify.com", {
        customer_id: 123,
        orders_requested: [1001],
      });

      expect(result.ordersIncluded).toEqual([]);
      expect(result.dataLocated.conversionLogs.count).toBe(0);
      expect(result.exportedData.conversionLogs).toHaveLength(0);
    });

    it("should handle empty orders_requested", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(mockShop as never);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([]);
      vi.mocked(prisma.surveyResponse.findMany).mockResolvedValue([]);
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);

      const result = await processDataRequest("test-shop.myshopify.com", {
        customer_id: 123,
      });

      expect(result.ordersIncluded).toEqual([]);
    });
  });

  describe("processCustomerRedact", () => {
    const mockShop = {
      id: "shop-123",
      shopDomain: "test-shop.myshopify.com",
    };

    it("should delete customer data for specified orders", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(mockShop as never);
      vi.mocked(prisma.conversionLog.deleteMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.conversionJob.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.pixelEventReceipt.deleteMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      vi.mocked(prisma.surveyResponse.deleteMany).mockResolvedValue({ count: 1 });

      const result = await processCustomerRedact("test-shop.myshopify.com", {
        customer_id: 123,
        orders_to_redact: [1001, 1002],
      });

      expect(result.customerId).toBe(123);
      expect(result.ordersRedacted).toEqual([1001, 1002]);
      expect(result.deletedCounts.conversionLogs).toBe(2);
      expect(result.deletedCounts.conversionJobs).toBe(1);
    });

    it("should return zero counts when shop not found", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);

      const result = await processCustomerRedact("unknown-shop.myshopify.com", {
        customer_id: 123,
        orders_to_redact: [1001],
      });

      expect(result.ordersRedacted).toEqual([]);
      expect(result.deletedCounts.conversionLogs).toBe(0);
    });

    it("should handle linked checkout tokens", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(mockShop as never);
      vi.mocked(prisma.conversionLog.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.conversionJob.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.pixelEventReceipt.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.surveyResponse.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { checkoutToken: "token-123" },
      ] as never);

      const result = await processCustomerRedact("test-shop.myshopify.com", {
        customer_id: 123,
        orders_to_redact: [1001],
      });

      expect(prisma.pixelEventReceipt.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("processShopRedact", () => {
    const mockShop = {
      id: "shop-123",
      shopDomain: "test-shop.myshopify.com",
    };

    it("should delete all shop data", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(mockShop as never);
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.webhookLog.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(prisma.conversionLog.deleteMany).mockResolvedValue({ count: 100 });
      vi.mocked(prisma.conversionJob.deleteMany).mockResolvedValue({ count: 50 });
      vi.mocked(prisma.pixelEventReceipt.deleteMany).mockResolvedValue({ count: 200 });
      vi.mocked(prisma.surveyResponse.deleteMany).mockResolvedValue({ count: 20 });
      vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 500 });
      vi.mocked(prisma.scanReport.deleteMany).mockResolvedValue({ count: 5 });
      vi.mocked(prisma.reconciliationReport.deleteMany).mockResolvedValue({ count: 30 });
      vi.mocked(prisma.alertConfig.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.pixelConfig.deleteMany).mockResolvedValue({ count: 3 });
      vi.mocked(prisma.monthlyUsage.deleteMany).mockResolvedValue({ count: 12 });
      vi.mocked(prisma.shop.delete).mockResolvedValue(mockShop as never);

      const result = await processShopRedact("test-shop.myshopify.com", {});

      expect(result.shopDomain).toBe("test-shop.myshopify.com");
      expect(result.deletedCounts.sessions).toBe(2);
      expect(result.deletedCounts.conversionLogs).toBe(100);
      expect(result.deletedCounts.shop).toBe(1);
    });

    it("should handle shop not found gracefully", async () => {
      vi.mocked(prisma.shop.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.webhookLog.deleteMany).mockResolvedValue({ count: 0 });

      const result = await processShopRedact("unknown-shop.myshopify.com", {});

      expect(result.shopDomain).toBe("unknown-shop.myshopify.com");
      expect(result.deletedCounts.shop).toBe(0);

      expect(prisma.session.deleteMany).toHaveBeenCalled();
      expect(prisma.webhookLog.deleteMany).toHaveBeenCalled();
    });
  });
});

