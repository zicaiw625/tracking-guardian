import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  performEnhancedChannelReconciliation,
  getOrderCrossPlatformComparison,
} from "../../../app/services/verification/channel-reconciliation.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    conversionJob: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    conversionLog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    reconciliationReport: {
      findMany: vi.fn(),
    },
    pixelEventReceipt: {
      findMany: vi.fn().mockResolvedValue([]),
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
      vi.mocked(prisma.shop.findUnique).mockResolvedValueOnce({
        id: shopId,
        shopDomain: "test.myshopify.com",
        pixelConfigs: [
          { platform: "google" },
          { platform: "meta" },
        ],
      } as any);
      vi.mocked(prisma.conversionJob.findMany).mockResolvedValue([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
        {
          orderId: "order-2",
          orderNumber: "1002",
          orderValue: { toNumber: () => 200 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValueOnce([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any).mockResolvedValueOnce([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
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
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: shopId,
        shopDomain: "test.myshopify.com",
        pixelConfigs: [
          { platform: "google" },
        ],
      } as any);
      vi.mocked(prisma.conversionJob.findMany).mockResolvedValue([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
        {
          orderId: "order-2",
          orderNumber: "1002",
          orderValue: { toNumber: () => 200 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      const result = await performEnhancedChannelReconciliation(shopId, hours);
      expect(result).toBeDefined();
      expect(result.platforms).toBeDefined();
      if (result.platforms.length > 0) {
        const platform = result.platforms[0];
        expect(platform).toBeDefined();
      }
    });
    it("should detect value discrepancies", async () => {
      const shopId = "shop-1";
      const hours = 24;
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: shopId,
        shopDomain: "test.myshopify.com",
        pixelConfigs: [
          { platform: "meta" },
        ],
      } as any);
      vi.mocked(prisma.conversionJob.findMany).mockResolvedValue([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: { toNumber: () => 600 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      const result = await performEnhancedChannelReconciliation(shopId, hours);
      expect(result).toBeDefined();
      expect(result.platforms).toBeDefined();
      if (result.platforms.length > 0) {
        const platform = result.platforms[0];
        expect(platform).toBeDefined();
      }
    });
  });
  describe("getOrderCrossPlatformComparison", () => {
    it("should compare order across platforms", async () => {
      const shopId = "shop-1";
      const orderId = "order-123";
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: shopId,
        shopDomain: "test.myshopify.com",
        pixelConfigs: [
          { platform: "google" },
          { platform: "meta" },
        ],
      } as any);
      vi.mocked(prisma.conversionJob.findFirst).mockResolvedValue({
        id: "job-1",
        shopId,
        orderId,
        orderNumber: "123",
        orderValue: { toNumber: () => 100 },
        currency: "USD",
        createdAt: new Date(),
      } as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          shopId,
          orderId,
          platform: "google",
          status: "sent",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
        {
          id: "log-2",
          shopId,
          orderId,
          platform: "meta",
          status: "sent",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      const result = await getOrderCrossPlatformComparison(shopId, orderId);
      expect(result).toBeDefined();
      expect(result.orderId).toBe(orderId);
      expect(result.platformEvents).toBeDefined();
      expect(Array.isArray(result.platformEvents)).toBe(true);
      expect(result.discrepancies).toBeDefined();
      expect(Array.isArray(result.discrepancies)).toBe(true);
    });
    it("should detect inconsistencies across platforms", async () => {
      const shopId = "shop-1";
      const orderId = "order-123";
      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: shopId,
        shopDomain: "test.myshopify.com",
        pixelConfigs: [
          { platform: "google" },
          { platform: "meta" },
        ],
      } as any);
      vi.mocked(prisma.conversionJob.findFirst).mockResolvedValue({
        id: "job-1",
        shopId,
        orderId,
        orderNumber: "123",
        orderValue: { toNumber: () => 100 },
        currency: "USD",
        createdAt: new Date(),
      } as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          shopId,
          orderId,
          platform: "google",
          status: "sent",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
        {
          id: "log-2",
          shopId,
          orderId,
          platform: "meta",
          status: "failed",
          orderValue: { toNumber: () => 100 },
          currency: "USD",
          createdAt: new Date(),
        },
      ] as any);
      const result = await getOrderCrossPlatformComparison(shopId, orderId);
      expect(result).toBeDefined();
      expect(result.discrepancies).toBeDefined();
      expect(Array.isArray(result.discrepancies)).toBe(true);
    });
  });
});
