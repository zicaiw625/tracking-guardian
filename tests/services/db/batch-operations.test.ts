import { describe, it, expect, beforeEach, vi } from "vitest";
import { batchCompleteJobs, batchInsertReceipts, batchUpdateShops } from "../../../app/services/db/batch-operations.server";

vi.mock("../../../app/container", () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockDb = {
  $transaction: vi.fn(),
  conversionJob: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  pixelEventReceipt: {
    upsert: vi.fn(),
  },
  shop: {
    update: vi.fn(),
  },
};

describe("Batch Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe("batchCompleteJobs", () => {
    it("should handle partial failures correctly", async () => {
      const completions = [
        { jobId: "job1", shopId: "shop1", orderId: "order1", status: "completed" as const },
        { jobId: "job2", shopId: "shop2", orderId: "order2", status: "completed" as const },
        { jobId: "job3", shopId: "shop3", orderId: "order3", status: "completed" as const },
      ];
      mockDb.$transaction.mockImplementation(async (callback) => {
        const tx = {
          conversionJob: {
            update: vi.fn()
              .mockResolvedValueOnce({ id: "job1" })
              .mockRejectedValueOnce(new Error("Update failed"))
              .mockResolvedValueOnce({ id: "job3" }),
          },
        };
        return callback(tx);
      });
      const result = await batchCompleteJobs(completions);
      expect(result.success).toBe(true);
      expect(result.processed).toBe(2); 
      expect(result.failed).toBe(1); 
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].id).toBe("job2");
    });
    it("should handle array index safety correctly", async () => {
      const completions = [
        { jobId: "job1", shopId: "shop1", orderId: "order1", status: "completed" as const },
      ];
      mockDb.$transaction.mockImplementation(async (callback) => {
        const tx = {
          conversionJob: {
            update: vi.fn().mockResolvedValue({ id: "job1" }),
          },
        };
        return callback(tx);
      });
      const result = await batchCompleteJobs(completions);
      expect(result.processed).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
    it("should handle empty array", async () => {
      const result = await batchCompleteJobs([]);
      expect(result.success).toBe(true);
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
  describe("batchInsertReceipts", () => {
    it("should handle partial failures with Promise.allSettled", async () => {
      const receipts = [
        { shopId: "shop1", eventId: "evt1", orderId: "order1", eventType: "purchase" },
        { shopId: "shop2", eventId: "evt2", orderId: "order2", eventType: "purchase" },
      ];
      mockDb.$transaction.mockImplementation(async (callback) => {
        const tx = {
          pixelEventReceipt: {
            upsert: vi.fn()
              .mockResolvedValueOnce({ id: "receipt1" })
              .mockRejectedValueOnce(new Error("Insert failed")),
          },
        };
        return callback(tx);
      });
      const result = await batchInsertReceipts(receipts);
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].id).toContain("shop2:order2");
    });
    it("should handle transaction failure correctly", async () => {
      const receipts = [
        { shopId: "shop1", eventId: "evt1", orderId: "order1", eventType: "purchase" },
      ];
      mockDb.$transaction.mockRejectedValue(new Error("Transaction failed"));
      const result = await batchInsertReceipts(receipts);
      expect(result.success).toBe(false);
      expect(result.processed).toBe(0);
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
  describe("batchUpdateShops", () => {
    it("should provide detailed error information for each failed shop", async () => {
      const updates = [
        { shopId: "shop1", data: { isActive: true } },
        { shopId: "shop2", data: { isActive: false } },
        { shopId: "shop3", data: { isActive: true } },
      ];
      mockDb.$transaction.mockImplementation(async (callback) => {
        const tx = {
          shop: {
            update: vi.fn()
              .mockResolvedValueOnce({ id: "shop1" })
              .mockRejectedValueOnce(new Error("Shop not found"))
              .mockResolvedValueOnce({ id: "shop3" }),
          },
        };
        return callback(tx);
      });
      const result = await batchUpdateShops(updates);
      expect(result.processed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].id).toBe("shop2");
      expect(result.errors[0].error).toContain("Shop not found");
    });
    it("should handle all shops failing", async () => {
      const updates = [
        { shopId: "shop1", data: { isActive: true } },
      ];
      mockDb.$transaction.mockImplementation(async (callback) => {
        const tx = {
          shop: {
            update: vi.fn().mockRejectedValue(new Error("Update failed")),
          },
        };
        return callback(tx);
      });
      const result = await batchUpdateShops(updates);
      expect(result.success).toBe(true); 
      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
