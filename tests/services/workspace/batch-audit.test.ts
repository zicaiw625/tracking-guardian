import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  startBatchAudit,
  getBatchAuditStatus,
  getBatchAuditHistory,
  getBatchAuditStatistics,
  cleanupOldJobs,
} from "../../../app/services/batch-audit.server";

// Mock prisma
vi.mock("../../../app/db.server", () => {
  return {
    default: {
      batchAuditJob: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
      }
    }
  }
});

import prisma from "../../../app/db.server";

describe("Batch Audit Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startBatchAudit", () => {
    it("returns a jobId for any options", async () => {
      // Mock findFirst to return null (no existing job)
      (prisma.batchAuditJob.findFirst as any).mockResolvedValue(null);
      // Mock create to return a job
      (prisma.batchAuditJob.create as any).mockResolvedValue({ id: "new-job-id" });

      const result = await startBatchAudit({
        groupId: "group-1",
        requesterId: "user-1",
      });
      
      expect("error" in result).toBe(false);
      expect("jobId" in result).toBe(true);
      if (!("error" in result)) {
        expect(typeof result.jobId).toBe("string");
        expect(result.jobId.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getBatchAuditStatus", () => {
    it("returns null for non-existent job", async () => {
      (prisma.batchAuditJob.findUnique as any).mockResolvedValue(null);
      expect(await getBatchAuditStatus("any-id")).toBeNull();
    });
  });

  describe("getBatchAuditHistory", () => {
    it("returns an array", async () => {
      (prisma.batchAuditJob.findMany as any).mockResolvedValue([]);
      const history = await getBatchAuditHistory(10);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    });
  });

  describe("getBatchAuditStatistics", () => {
    it("returns numeric stats", async () => {
      (prisma.batchAuditJob.count as any).mockResolvedValue(0);
      const stats = await getBatchAuditStatistics();
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
    it("returns a number", async () => {
      (prisma.batchAuditJob.deleteMany as any).mockResolvedValue({ count: 5 });
      const cleaned = await cleanupOldJobs(0);
      expect(typeof cleaned).toBe("number");
      expect(cleaned).toBe(5);
    });
  });
});
