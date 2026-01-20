import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    gDPRJob: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn() },
    shop: { findUnique: vi.fn(), delete: vi.fn() },
    session: { deleteMany: vi.fn() },
    conversionLog: { findMany: vi.fn(), deleteMany: vi.fn() },
    conversionJob: { deleteMany: vi.fn() },
    pixelEventReceipt: { findMany: vi.fn(), deleteMany: vi.fn() },
    surveyResponse: { findMany: vi.fn(), deleteMany: vi.fn() },
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

const DEPRECATED_MSG = "GDPR job queue is no longer supported";

describe("GDPR Job Processor Integration (deprecated – processed via webhooks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processGDPRJob - Job Lifecycle", () => {
    it("should return deprecated when job would transition queued -> processing -> completed", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
    it("should return deprecated when job not found", async () => {
      const result = await processGDPRJob("non-existent-job");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
    it("should return deprecated when job already completed", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
    it("should return deprecated on error (no DB or error message)", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
  });

  describe("processGDPRJob - Data Request", () => {
    it("should return deprecated for data_request job", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
  });

  describe("processGDPRJob - Customer Redact", () => {
    it("should return deprecated for customer_redact job", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
    it("should return deprecated for linked checkout tokens path", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
  });

  describe("processGDPRJob - Shop Redact", () => {
    it("should return deprecated for shop_redact job", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
    it("should return deprecated when shop not found", async () => {
      const result = await processGDPRJob("job-123");
      expect(result.success).toBe(false);
      expect(result.error).toBe(DEPRECATED_MSG);
    });
  });
});

describe("GDPR Batch Processing (deprecated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processGDPRJobs", () => {
    it("should return zero processed when batch would run", async () => {
      const result = await processGDPRJobs();
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
    it("should return zero counts when no pending jobs", async () => {
      const result = await processGDPRJobs();
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
    it("should return zero counts when one would fail", async () => {
      const result = await processGDPRJobs();
      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
    it("should return zero counts (no batch processing)", async () => {
      const result = await processGDPRJobs();
      expect(result.processed).toBe(0);
    });
  });
});

describe("GDPR Job Status (deprecated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getGDPRJobStatus", () => {
    it("should return empty status and recent jobs", async () => {
      const status = await getGDPRJobStatus();
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
      expect(status.recentJobs).toHaveLength(0);
    });
    it("should return empty when filtering by shop domain", async () => {
      const status = await getGDPRJobStatus("specific-shop.myshopify.com");
      expect(status.queued).toBe(0);
      expect(status.recentJobs).toHaveLength(0);
    });
  });
});

describe("GDPR Processing Edge Cases (deprecated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return deprecated for unknown job type", async () => {
    const result = await processGDPRJob("job-123");
    expect(result.success).toBe(false);
    expect(result.error).toBe(DEPRECATED_MSG);
  });
  it("should return deprecated for empty order lists", async () => {
    const result = await processGDPRJob("job-123");
    expect(result.success).toBe(false);
    expect(result.error).toBe(DEPRECATED_MSG);
  });
  it("should return deprecated for null payload fields", async () => {
    const result = await processGDPRJob("job-123");
    expect(result.success).toBe(false);
    expect(result.error).toBe(DEPRECATED_MSG);
  });
  it("should return deprecated (no payload clear – no processing)", async () => {
    const result = await processGDPRJob("job-123");
    expect(result.success).toBe(false);
    expect(result.error).toBe(DEPRECATED_MSG);
  });
});
