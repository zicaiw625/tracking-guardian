/**
 * GDPR Processing Integration Tests
 *
 * Tests the complete GDPR job processing flow including:
 * - Job creation and queueing
 * - Job lifecycle management (queued -> processing -> completed/failed)
 * - Data request, customer redact, and shop redact workflows
 * - Error handling and recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =============================================================================
// Mock Setup (Must be before imports)
// =============================================================================

// Mock Prisma - define mocks inline to avoid hoisting issues
vi.mock("../../app/db.server", () => ({
  default: {
    gDPRJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
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

vi.mock("../../app/services/audit.server", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are defined
import prisma from "../../app/db.server";
import { processGDPRJob, processGDPRJobs, getGDPRJobStatus } from "../../app/services/gdpr/job-processor";

// Get typed mock references
const mockPrisma = vi.mocked(prisma);

// Helper to reset all mocks
function resetMocks() {
  vi.clearAllMocks();
}


// =============================================================================
// Test Fixtures
// =============================================================================

const createMockJob = (overrides: Partial<{
  id: string;
  shopDomain: string;
  jobType: string;
  status: string;
  payload: object;
  result: object | null;
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}> = {}) => ({
  id: "job-123",
  shopDomain: "test-shop.myshopify.com",
  jobType: "data_request",
  status: "queued",
  payload: { customer_id: 123, orders_requested: [1001, 1002] },
  result: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  processedAt: null,
  completedAt: null,
  errorMessage: null,
  ...overrides,
});

const mockShop = {
  id: "shop-123",
  shopDomain: "test-shop.myshopify.com",
};

// =============================================================================
// Single Job Processing Tests
// =============================================================================

describe("GDPR Job Processor Integration", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("processGDPRJob - Job Lifecycle", () => {
    it("should transition job from queued -> processing -> completed", async () => {
      const mockJob = createMockJob();
      let currentStatus = "queued";

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockImplementation((args) => {
        if (args.data.status) {
          currentStatus = args.data.status;
        }
        return Promise.resolve({ ...mockJob, status: currentStatus });
      });

      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
      mockPrisma.conversionLog.findMany.mockResolvedValue([]);
      mockPrisma.surveyResponse.findMany.mockResolvedValue([]);
      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);

      // Verify job status transitions
      const updateCalls = mockPrisma.gDPRJob.update.mock.calls;
      expect(updateCalls[0][0].data.status).toBe("processing");
      expect(updateCalls[1][0].data.status).toBe("completed");
      expect(updateCalls[1][0].data.payload).toEqual({}); // Payload cleared for privacy
      expect(updateCalls[1][0].data.processedAt).toBeDefined();
      expect(updateCalls[1][0].data.completedAt).toBeDefined();
    });

    it("should handle job not found", async () => {
      mockPrisma.gDPRJob.findUnique.mockResolvedValue(null);

      const result = await processGDPRJob("non-existent-job");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Job not found");
    });

    it("should skip already completed jobs", async () => {
      const completedJob = createMockJob({
        status: "completed",
        result: { dataRequestId: 456 },
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(completedJob);

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);
      expect(mockPrisma.gDPRJob.update).not.toHaveBeenCalled();
    });

    it("should mark job as failed on error and record error message", async () => {
      const mockJob = createMockJob({ jobType: "data_request" });
      const errorMessage = "Database connection failed";

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockImplementation(() => Promise.resolve(mockJob));
      mockPrisma.shop.findUnique.mockRejectedValue(new Error(errorMessage));

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);

      // Verify failed status update
      const failedUpdate = mockPrisma.gDPRJob.update.mock.calls.find(
        (call) => call[0].data.status === "failed"
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate[0].data.errorMessage).toBe(errorMessage);
      expect(failedUpdate[0].data.processedAt).toBeDefined();
    });
  });

  describe("processGDPRJob - Data Request", () => {
    it("should export customer data for data_request job", async () => {
      const mockJob = createMockJob({
        jobType: "data_request",
        payload: {
          customer_id: 123,
          orders_requested: [1001, 1002],
          data_request_id: 456,
        },
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);

      mockPrisma.conversionLog.findMany.mockResolvedValue([
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
      ]);
      mockPrisma.surveyResponse.findMany.mockResolvedValue([
        {
          id: "survey-1",
          orderId: "1001",
          orderNumber: "1001",
          rating: 5,
          source: "email",
          feedback: "Great!",
          createdAt: new Date("2024-01-02"),
        },
      ]);
      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        dataRequestId: 456,
        customerId: 123,
        ordersIncluded: [1001, 1002],
        dataLocated: {
          conversionLogs: { count: 1 },
          surveyResponses: { count: 1 },
        },
        exportFormat: "json",
        exportVersion: "1.0",
      });
    });
  });

  describe("processGDPRJob - Customer Redact", () => {
    it("should delete customer data for customer_redact job", async () => {
      const mockJob = createMockJob({
        jobType: "customer_redact",
        payload: {
          customer_id: 123,
          orders_to_redact: [1001, 1002],
        },
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);

      mockPrisma.conversionLog.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.conversionJob.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.pixelEventReceipt.deleteMany.mockResolvedValue({ count: 4 });
      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);
      mockPrisma.surveyResponse.deleteMany.mockResolvedValue({ count: 1 });

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        customerId: 123,
        ordersRedacted: [1001, 1002],
        deletedCounts: {
          conversionLogs: 3,
          conversionJobs: 2,
        },
      });
    });

    it("should follow linked checkout tokens for complete deletion", async () => {
      const mockJob = createMockJob({
        jobType: "customer_redact",
        payload: {
          customer_id: 123,
          orders_to_redact: [1001],
        },
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);

      mockPrisma.conversionLog.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.conversionJob.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.surveyResponse.deleteMany.mockResolvedValue({ count: 0 });

      // First call returns receipts with checkout tokens
      mockPrisma.pixelEventReceipt.deleteMany
        .mockResolvedValueOnce({ count: 1 }) // By order ID
        .mockResolvedValueOnce({ count: 2 }); // By checkout token

      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([
        { checkoutToken: "checkout-abc" },
        { checkoutToken: "checkout-xyz" },
      ]);

      await processGDPRJob("job-123");

      // Should have deleted by both order ID and checkout token
      expect(mockPrisma.pixelEventReceipt.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe("processGDPRJob - Shop Redact", () => {
    it("should delete all shop data for shop_redact job", async () => {
      const mockJob = createMockJob({
        jobType: "shop_redact",
        payload: {},
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
      mockPrisma.shop.delete.mockResolvedValue(mockShop);

      mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.webhookLog.deleteMany.mockResolvedValue({ count: 100 });
      mockPrisma.conversionLog.deleteMany.mockResolvedValue({ count: 500 });
      mockPrisma.conversionJob.deleteMany.mockResolvedValue({ count: 50 });
      mockPrisma.pixelEventReceipt.deleteMany.mockResolvedValue({ count: 1000 });
      mockPrisma.surveyResponse.deleteMany.mockResolvedValue({ count: 100 });
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 2000 });
      mockPrisma.scanReport.deleteMany.mockResolvedValue({ count: 10 });
      mockPrisma.reconciliationReport.deleteMany.mockResolvedValue({ count: 30 });
      mockPrisma.alertConfig.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.pixelConfig.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.monthlyUsage.deleteMany.mockResolvedValue({ count: 12 });

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        shopDomain: "test-shop.myshopify.com",
        deletedCounts: {
          sessions: 5,
          conversionLogs: 500,
          shop: 1,
        },
      });

      // Verify shop was deleted
      expect(mockPrisma.shop.delete).toHaveBeenCalledWith({
        where: { id: mockShop.id },
      });
    });

    it("should handle shop not found but still clean up related data", async () => {
      const mockJob = createMockJob({
        jobType: "shop_redact",
        payload: {},
      });

      mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
      mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
      mockPrisma.shop.findUnique.mockResolvedValue(null); // Shop not found
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.webhookLog.deleteMany.mockResolvedValue({ count: 0 });

      const result = await processGDPRJob("job-123");

      expect(result.success).toBe(true);
      // Should still try to delete sessions by domain
      expect(mockPrisma.session.deleteMany).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Batch Job Processing Tests
// =============================================================================

describe("GDPR Batch Processing", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("processGDPRJobs", () => {
    it("should process multiple pending jobs in order", async () => {
      const pendingJobs = [
        createMockJob({ id: "job-1", status: "queued" }),
        createMockJob({ id: "job-2", status: "queued", jobType: "customer_redact" }),
        createMockJob({ id: "job-3", status: "failed" }), // Failed jobs are also retried
      ];

      mockPrisma.gDPRJob.findMany.mockResolvedValue(pendingJobs);
      mockPrisma.gDPRJob.findUnique.mockImplementation((args) => {
        const job = pendingJobs.find((j) => j.id === args.where.id);
        return Promise.resolve(job || null);
      });
      mockPrisma.gDPRJob.update.mockResolvedValue(pendingJobs[0]);

      mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
      mockPrisma.conversionLog.findMany.mockResolvedValue([]);
      mockPrisma.surveyResponse.findMany.mockResolvedValue([]);
      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);
      mockPrisma.conversionLog.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.conversionJob.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.pixelEventReceipt.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.surveyResponse.deleteMany.mockResolvedValue({ count: 0 });

      const result = await processGDPRJobs();

      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    it("should return zero counts when no pending jobs", async () => {
      mockPrisma.gDPRJob.findMany.mockResolvedValue([]);

      const result = await processGDPRJobs();

      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("should continue processing remaining jobs when one fails", async () => {
      const pendingJobs = [
        createMockJob({ id: "job-1", status: "queued" }),
        createMockJob({ id: "job-2", status: "queued" }),
        createMockJob({ id: "job-3", status: "queued" }),
      ];

      mockPrisma.gDPRJob.findMany.mockResolvedValue(pendingJobs);
      mockPrisma.gDPRJob.findUnique.mockImplementation((args) => {
        const job = pendingJobs.find((j) => j.id === args.where.id);
        return Promise.resolve(job || null);
      });
      mockPrisma.gDPRJob.update.mockResolvedValue(pendingJobs[0]);

      // First and third succeed, second fails
      let callCount = 0;
      mockPrisma.shop.findUnique.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error("Database timeout"));
        }
        return Promise.resolve(mockShop);
      });

      mockPrisma.conversionLog.findMany.mockResolvedValue([]);
      mockPrisma.surveyResponse.findMany.mockResolvedValue([]);
      mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

      const result = await processGDPRJobs();

      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
    });

    it("should respect batch size limit of 10 jobs", async () => {
      mockPrisma.gDPRJob.findMany.mockResolvedValue([]);

      await processGDPRJobs();

      // Verify the findMany was called with take: 10
      expect(mockPrisma.gDPRJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          orderBy: { createdAt: "asc" },
          where: {
            status: { in: ["queued", "failed"] },
          },
        })
      );
    });
  });
});

// =============================================================================
// Job Status Tests
// =============================================================================

describe("GDPR Job Status", () => {
  beforeEach(() => {
    resetMocks();
  });

  describe("getGDPRJobStatus", () => {
    it("should return status counts and recent jobs", async () => {
      mockPrisma.gDPRJob.count
        .mockResolvedValueOnce(5) // queued
        .mockResolvedValueOnce(1) // processing
        .mockResolvedValueOnce(100) // completed
        .mockResolvedValueOnce(3); // failed

      mockPrisma.gDPRJob.findMany.mockResolvedValue([
        {
          id: "job-1",
          shopDomain: "shop1.myshopify.com",
          jobType: "data_request",
          status: "completed",
          createdAt: new Date("2024-01-15"),
          completedAt: new Date("2024-01-15"),
        },
        {
          id: "job-2",
          shopDomain: "shop2.myshopify.com",
          jobType: "customer_redact",
          status: "queued",
          createdAt: new Date("2024-01-16"),
          completedAt: null,
        },
      ]);

      const status = await getGDPRJobStatus();

      expect(status.queued).toBe(5);
      expect(status.processing).toBe(1);
      expect(status.completed).toBe(100);
      expect(status.failed).toBe(3);
      expect(status.recentJobs).toHaveLength(2);
    });

    it("should filter by shop domain when provided", async () => {
      mockPrisma.gDPRJob.count.mockResolvedValue(0);
      mockPrisma.gDPRJob.findMany.mockResolvedValue([]);

      await getGDPRJobStatus("specific-shop.myshopify.com");

      // All count queries should include shopDomain filter
      expect(mockPrisma.gDPRJob.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopDomain: "specific-shop.myshopify.com",
          }),
        })
      );
    });
  });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe("GDPR Processing Edge Cases", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("should handle unknown job type gracefully", async () => {
    const mockJob = createMockJob({
      jobType: "unknown_type" as string,
    });

    mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
    mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);

    const result = await processGDPRJob("job-123");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown GDPR job type");
  });

  it("should handle empty order lists gracefully", async () => {
    const mockJob = createMockJob({
      jobType: "data_request",
      payload: {
        customer_id: 123,
        orders_requested: [],
      },
    });

    mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
    mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
    mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
    mockPrisma.conversionLog.findMany.mockResolvedValue([]);
    mockPrisma.surveyResponse.findMany.mockResolvedValue([]);
    mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

    const result = await processGDPRJob("job-123");

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      ordersIncluded: [],
      dataLocated: {
        conversionLogs: { count: 0 },
        surveyResponses: { count: 0 },
        pixelEventReceipts: { count: 0 },
      },
    });
  });

  it("should handle null payload fields", async () => {
    const mockJob = createMockJob({
      jobType: "customer_redact",
      payload: {
        customer_id: null,
        orders_to_redact: undefined,
      },
    });

    mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
    mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
    mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
    mockPrisma.conversionLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.conversionJob.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.pixelEventReceipt.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);
    mockPrisma.surveyResponse.deleteMany.mockResolvedValue({ count: 0 });

    const result = await processGDPRJob("job-123");

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      customerId: null,
      ordersRedacted: [],
    });
  });

  it("should clear payload after successful processing for privacy", async () => {
    const mockJob = createMockJob({
      jobType: "data_request",
      payload: {
        customer_id: 123,
        orders_requested: [1001],
        data_request_id: 456,
      },
    });

    mockPrisma.gDPRJob.findUnique.mockResolvedValue(mockJob);
    mockPrisma.gDPRJob.update.mockResolvedValue(mockJob);
    mockPrisma.shop.findUnique.mockResolvedValue(mockShop);
    mockPrisma.conversionLog.findMany.mockResolvedValue([]);
    mockPrisma.surveyResponse.findMany.mockResolvedValue([]);
    mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

    await processGDPRJob("job-123");

    // Verify payload was cleared in the completion update
    const completionUpdate = mockPrisma.gDPRJob.update.mock.calls.find(
      (call) => call[0].data.status === "completed"
    );
    expect(completionUpdate[0].data.payload).toEqual({});
  });
});

