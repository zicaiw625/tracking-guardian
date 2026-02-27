import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    gDPRJob: { 
      findUnique: vi.fn(), 
      findMany: vi.fn().mockResolvedValue([]), 
      update: vi.fn(), 
      count: vi.fn().mockResolvedValue(0), 
      create: vi.fn(),
      upsert: vi.fn(),
    },
    shop: { findUnique: vi.fn(), delete: vi.fn() },
    session: { deleteMany: vi.fn() },
    conversionLog: { findMany: vi.fn(), deleteMany: vi.fn() },
    conversionJob: { deleteMany: vi.fn() },
    pixelEventReceipt: { findMany: vi.fn(), deleteMany: vi.fn() },
    auditLog: { deleteMany: vi.fn(), create: vi.fn() },
    webhookLog: { deleteMany: vi.fn() },
    scanReport: { deleteMany: vi.fn() },
    reconciliationReport: { deleteMany: vi.fn() },
    alertConfig: { deleteMany: vi.fn() },
    pixelConfig: { deleteMany: vi.fn() },
    monthlyUsage: { deleteMany: vi.fn() },
    eventNonce: { deleteMany: vi.fn() },
  },
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../app/services/audit.server", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { processGDPRJob, processGDPRJobs, getGDPRJobStatus } from "../../app/services/gdpr/job-processor";

const DEPRECATED_MSG = "Use processGDPRJobs";

describe("GDPR Job Processor Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processGDPRJob (Single - Deprecated)", () => {
    it("should return deprecated message", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
  });

  describe("processGDPRJobs (Batch)", () => {
    it("should process no jobs when queue is empty", async () => {
      const result = await processGDPRJobs();
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe("getGDPRJobStatus", () => {
    it("should return empty status and recent jobs when DB is empty", async () => {
      const status = await getGDPRJobStatus();
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
      expect(status.recentJobs).toHaveLength(0);
    });
  });
});

