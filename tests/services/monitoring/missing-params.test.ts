import { describe, it, expect, beforeEach, vi } from "vitest";
import { getMissingParamsRate } from "../../../app/services/monitoring/missing-params.server";
import prisma from "../../../app/db.server";

vi.mock("../../../app/db.server", () => ({
  default: {
    pixelEventReceipt: {
      findMany: vi.fn(),
    },
  },
}));

describe("Missing Parameters Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getMissingParamsRate", () => {
    it("should detect missing parameters (value, currency, or items)", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { payloadJson: { platform: "google", data: { value: 10, currency: "USD", items: [{}] } } },
        { payloadJson: { platform: "google", data: { currency: "USD", items: [{}] } } }, // missing value
        { payloadJson: { platform: "google", data: { value: 20, items: [{}] } } }, // missing currency
        { payloadJson: { platform: "google", data: { value: 30, currency: "USD" } } }, // missing items
        { payloadJson: { platform: "google", data: { value: 40, currency: "USD", items: [] } } }, // empty items
      ] as any);
      const result = await getMissingParamsRate(shopId, 24);
      expect(result).toBeDefined();
      expect(result.total).toBe(5);
      expect(result.missing).toBe(4);
      expect(result.rate).toBe(80);
      expect(result.byPlatform).toBeDefined();
      expect(result.byPlatform.google).toBeDefined();
      expect(result.byPlatform.google.total).toBe(5);
      expect(result.byPlatform.google.missing).toBe(4);
      expect(result.byPlatform.google.rate).toBe(80);
    });

    it("should skip receipts without platform or destination", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { payloadJson: { data: { value: 10, currency: "USD", items: [{}] } } }, // no platform
        { payloadJson: { platform: "meta", data: { value: 20, currency: "USD", items: [{}] } } },
      ] as any);
      const result = await getMissingParamsRate(shopId, 24);
      expect(result.total).toBe(2);
      expect(result.byPlatform.meta).toBeDefined();
      expect(result.byPlatform.meta.total).toBe(1);
      // Receipts without platform are skipped in the missing count loop, but total uses receipts.length
      expect(result.missing).toBe(0); // only meta has platform, and it has all params
    });

    it("should return zero rate when all params present", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { payloadJson: { platform: "google", data: { value: 10, currency: "USD", items: [{}] } } },
        { payloadJson: { platform: "meta", data: { value: 20, currency: "EUR", items: [{ id: "1" }] } } },
      ] as any);
      const result = await getMissingParamsRate(shopId, 24);
      expect(result.total).toBe(2);
      expect(result.missing).toBe(0);
      expect(result.rate).toBe(0);
      expect(result.byPlatform.google.rate).toBe(0);
      expect(result.byPlatform.meta.rate).toBe(0);
    });

    it("should handle empty receipts", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      const result = await getMissingParamsRate(shopId, 24);
      expect(result.total).toBe(0);
      expect(result.missing).toBe(0);
      expect(result.rate).toBe(0);
      expect(result.byPlatform).toEqual({});
    });

    it("should compute rate per platform", async () => {
      const shopId = "shop-1";
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([
        { payloadJson: { platform: "google", data: { value: 10, currency: "USD", items: [{}] } } },
        { payloadJson: { platform: "google", data: {} } }, // missing all
        { payloadJson: { platform: "meta", data: {} } },
        { payloadJson: { platform: "meta", data: {} } },
      ] as any);
      const result = await getMissingParamsRate(shopId, 24);
      expect(result.byPlatform.google.total).toBe(2);
      expect(result.byPlatform.google.missing).toBe(1);
      expect(result.byPlatform.google.rate).toBe(50);
      expect(result.byPlatform.meta.total).toBe(2);
      expect(result.byPlatform.meta.missing).toBe(2);
      expect(result.byPlatform.meta.rate).toBe(100);
    });
  });
});
