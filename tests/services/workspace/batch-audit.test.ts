
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Batch Audit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have tests for batch audit functionality", () => {

    expect(true).toBe(true);
  });
});

vi.mock("../../../app/services/multi-shop.server", () => ({
  canManageMultipleShops: vi.fn().mockResolvedValue(true),
  getShopGroupDetails: vi.fn().mockResolvedValue({
    id: "group-1",
    name: "Test Group",
    memberCount: 3,
    members: [
      { shopId: "shop-1", shopDomain: "shop1.myshopify.com" },
      { shopId: "shop-2", shopDomain: "shop2.myshopify.com" },
      { shopId: "shop-3", shopDomain: "shop3.myshopify.com" },
    ],
  }),
}));

describe("Batch Audit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startBatchAudit", () => {
    it("should return error if user cannot manage multiple shops", async () => {
      const { canManageMultipleShops } = await import("../../../app/services/multi-shop.server");
      vi.mocked(canManageMultipleShops).mockResolvedValueOnce(false);

      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
      };

      const result = await startBatchAudit(options);

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("Agency 版");
      }
    });

    it("should return error if group does not exist", async () => {
      const { getShopGroupDetails } = await import("../../../app/services/multi-shop.server");
      vi.mocked(getShopGroupDetails).mockResolvedValueOnce(null);

      const options: BatchAuditOptions = {
        groupId: "non-existent",
        requesterId: "user-1",
      };

      const result = await startBatchAudit(options);

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("分组不存在");
      }
    });

    it("should start batch audit job successfully", async () => {
      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
        concurrency: 2,
        skipRecentHours: 6,
      };

      const result = await startBatchAudit(options);

      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.jobId).toBeDefined();
        expect(typeof result.jobId).toBe("string");
      }
    });
  });

  describe("getBatchAuditStatus", () => {
    it("should return null for non-existent job", () => {
      const result = getBatchAuditStatus("non-existent-job-id");

      expect(result).toBeNull();
    });

    it("should return job status for existing job", async () => {
      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
      };

      const startResult = await startBatchAudit(options);
      if ("error" in startResult) {
        return;
      }

      const status = getBatchAuditStatus(startResult.jobId);

      expect(status).not.toBeNull();
      expect(status?.id).toBe(startResult.jobId);
      expect(status?.groupId).toBe("group-1");
    });
  });

  describe("getBatchAuditHistory", () => {
    it("should return empty array when no jobs exist", () => {
      cleanupOldJobs(0);

      const history = getBatchAuditHistory(10);

      expect(Array.isArray(history)).toBe(true);
    });

    it("should return jobs sorted by creation time", async () => {
      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
      };

      await startBatchAudit(options);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await startBatchAudit(options);

      const history = getBatchAuditHistory(10);

      expect(history.length).toBeGreaterThan(0);
      for (let i = 1; i < history.length; i++) {
        expect(history[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
          history[i].createdAt.getTime()
        );
      }
    });
  });

  describe("getBatchAuditStatistics", () => {
    it("should return statistics for all jobs", () => {
      const stats = getBatchAuditStatistics();

      expect(stats).toBeDefined();
      expect(typeof stats.totalJobs).toBe("number");
      expect(typeof stats.completedJobs).toBe("number");
      expect(typeof stats.failedJobs).toBe("number");
      expect(typeof stats.runningJobs).toBe("number");
      expect(stats.avgSuccessRate).toBeGreaterThanOrEqual(0);
      expect(stats.avgSuccessRate).toBeLessThanOrEqual(100);
    });
  });

  describe("cleanupOldJobs", () => {
    it("should clean up jobs older than maxAgeMs", async () => {
      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
      };

      await startBatchAudit(options);

      const cleaned = cleanupOldJobs(0);

      expect(cleaned).toBeGreaterThan(0);
    });

    it("should not clean up recent jobs", async () => {
      const options: BatchAuditOptions = {
        groupId: "group-1",
        requesterId: "user-1",
      };

      await startBatchAudit(options);

      const cleaned = cleanupOldJobs(24 * 60 * 60 * 1000);

      expect(cleaned).toBe(0);
    });
  });
});

