/**
 * 验收服务测试 - Verification Service Tests
 * 对应设计方案 4.5 Verification：事件对账与验收
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    verificationRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    conversionLog: {
      findMany: vi.fn(),
    },
    pixelEventReceipt: {
      findMany: vi.fn(),
    },
    pixelConfig: {
      findMany: vi.fn(),
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

import prisma from "../../app/db.server";
import {
  createVerificationRun,
  startVerificationRun,
  getVerificationRun,
  analyzeRecentEvents,
  getVerificationHistory,
  generateTestOrderGuide,
  exportVerificationReport,
  VERIFICATION_TEST_ITEMS,
  type VerificationSummary,
} from "../../app/services/verification.server";

describe("Verification Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("VERIFICATION_TEST_ITEMS", () => {
    it("should have test items defined", () => {
      expect(VERIFICATION_TEST_ITEMS).toBeDefined();
      expect(VERIFICATION_TEST_ITEMS.length).toBeGreaterThan(0);
    });

    it("should have purchase test item as required", () => {
      const purchaseItem = VERIFICATION_TEST_ITEMS.find((item) => item.id === "purchase");
      expect(purchaseItem).toBeDefined();
      expect(purchaseItem?.required).toBe(true);
    });
  });

  describe("createVerificationRun", () => {
    it("should create verification run with default options", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "验收测试",
        runType: "quick",
        status: "pending",
        platforms: [],
        summaryJson: {
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          missingParamTests: 0,
        },
        eventsJson: [],
        createdAt: new Date(),
      };

      vi.mocked(prisma.pixelConfig.findMany).mockResolvedValue([]);
      vi.mocked(prisma.verificationRun.create).mockResolvedValue(mockRun as any);

      const runId = await createVerificationRun("shop-1", {});

      expect(runId).toBe("run-1");
      expect(prisma.verificationRun.create).toHaveBeenCalledWith({
        data: {
          shopId: "shop-1",
          runName: "验收测试",
          runType: "quick",
          status: "pending",
          platforms: [],
          summaryJson: {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            missingParamTests: 0,
          },
          eventsJson: [],
        },
      });
    });

    it("should use configured platforms when none provided", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        platforms: ["google", "meta"],
        createdAt: new Date(),
      };

      vi.mocked(prisma.pixelConfig.findMany).mockResolvedValue([
        { platform: "google" },
        { platform: "meta" },
      ] as any);
      vi.mocked(prisma.verificationRun.create).mockResolvedValue(mockRun as any);

      await createVerificationRun("shop-1", {});

      expect(prisma.pixelConfig.findMany).toHaveBeenCalledWith({
        where: { shopId: "shop-1", isActive: true, serverSideEnabled: true },
        select: { platform: true },
      });

      const createCall = vi.mocked(prisma.verificationRun.create).mock.calls[0][0];
      expect(createCall.data.platforms).toEqual(["google", "meta"]);
    });

    it("should use provided platforms when specified", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        platforms: ["tiktok"],
        createdAt: new Date(),
      };

      vi.mocked(prisma.verificationRun.create).mockResolvedValue(mockRun as any);

      await createVerificationRun("shop-1", {
        platforms: ["tiktok"],
        runName: "自定义测试",
        runType: "full",
      });

      expect(prisma.pixelConfig.findMany).not.toHaveBeenCalled();
      const createCall = vi.mocked(prisma.verificationRun.create).mock.calls[0][0];
      expect(createCall.data.platforms).toEqual(["tiktok"]);
      expect(createCall.data.runName).toBe("自定义测试");
      expect(createCall.data.runType).toBe("full");
    });
  });

  describe("startVerificationRun", () => {
    it("should update run status to running", async () => {
      vi.mocked(prisma.verificationRun.update).mockResolvedValue({
        id: "run-1",
        status: "running",
      } as any);

      await startVerificationRun("run-1");

      expect(prisma.verificationRun.update).toHaveBeenCalledWith({
        where: { id: "run-1" },
        data: {
          status: "running",
          startedAt: expect.any(Date),
        },
      });
    });
  });

  describe("getVerificationRun", () => {
    it("should return null when run not found", async () => {
      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(null);

      const result = await getVerificationRun("non-existent");

      expect(result).toBeNull();
    });

    it("should return verification summary when run exists", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "测试运行",
        runType: "quick",
        status: "completed",
        platforms: ["google", "meta"],
        startedAt: new Date("2024-01-01"),
        completedAt: new Date("2024-01-02"),
        summaryJson: {
          totalTests: 10,
          passedTests: 8,
          failedTests: 1,
          missingParamTests: 1,
          parameterCompleteness: 90,
          valueAccuracy: 95,
        },
        eventsJson: [
          {
            testItemId: "purchase",
            eventType: "purchase",
            platform: "google",
            status: "success",
          },
        ],
        shop: {
          shopDomain: "test-shop.myshopify.com",
        },
      };

      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(mockRun as any);

      const result = await getVerificationRun("run-1");

      expect(result).toBeDefined();
      expect(result?.runId).toBe("run-1");
      expect(result?.shopId).toBe("shop-1");
      expect(result?.totalTests).toBe(10);
      expect(result?.passedTests).toBe(8);
      expect(result?.failedTests).toBe(1);
      expect(result?.missingParamTests).toBe(1);
      expect(result?.parameterCompleteness).toBe(90);
      expect(result?.valueAccuracy).toBe(95);
      expect(result?.results).toHaveLength(1);
    });
  });

  describe("analyzeRecentEvents", () => {
    it("should throw error when run not found", async () => {
      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(null);

      await expect(
        analyzeRecentEvents("shop-1", "non-existent", {})
      ).rejects.toThrow("Verification run not found");
    });

    it("should analyze conversion logs and generate summary", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "测试运行",
        runType: "quick",
        platforms: ["google", "meta"],
        summaryJson: {},
        eventsJson: [],
      };

      const mockConversionLogs = [
        {
          id: "log-1",
          orderId: "order-1",
          orderNumber: "1001",
          orderValue: 100.0,
          currency: "USD",
          platform: "google",
          eventType: "purchase",
          status: "sent",
          eventId: "event-1",
          sentAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: "log-2",
          orderId: "order-2",
          orderNumber: "1002",
          orderValue: 200.0,
          currency: "USD",
          platform: "meta",
          eventType: "purchase",
          status: "failed",
          errorMessage: "API error",
          createdAt: new Date(),
        },
      ];

      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(mockRun as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue(mockConversionLogs as any);
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      vi.mocked(prisma.verificationRun.update).mockResolvedValue({
        ...mockRun,
        status: "completed",
        completedAt: new Date(),
      } as any);

      const result = await analyzeRecentEvents("shop-1", "run-1", {});

      expect(result).toBeDefined();
      expect(result.status).toBe("completed");
      // analyzeRecentEvents 按订单分组，相同 orderId 的多个日志会被合并
      expect(result.totalTests).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
      expect(prisma.verificationRun.update).toHaveBeenCalled();
    });

    it("should identify missing parameters", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "测试运行",
        runType: "quick",
        platforms: ["google"],
        summaryJson: {},
        eventsJson: [],
      };

      const mockConversionLogs = [
        {
          id: "log-1",
          orderId: "order-1",
          orderValue: null,
          currency: "USD",
          platform: "google",
          eventType: "purchase",
          status: "sent",
          createdAt: new Date(),
        },
        {
          id: "log-2",
          orderId: "order-2",
          orderValue: 100.0,
          currency: null,
          platform: "google",
          eventType: "purchase",
          status: "sent",
          createdAt: new Date(),
        },
      ];

      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(mockRun as any);
      vi.mocked(prisma.conversionLog.findMany).mockResolvedValue(mockConversionLogs as any);
      vi.mocked(prisma.pixelEventReceipt.findMany).mockResolvedValue([]);
      vi.mocked(prisma.verificationRun.update).mockResolvedValue({
        ...mockRun,
        status: "completed",
      } as any);

      const result = await analyzeRecentEvents("shop-1", "run-1", {});

      expect(result.missingParamTests).toBe(2);
      expect(result.passedTests).toBe(0);
    });
  });

  describe("getVerificationHistory", () => {
    it("should return verification history", async () => {
      const mockRuns = [
        {
          id: "run-1",
          shopId: "shop-1",
          runName: "测试1",
          runType: "quick",
          status: "completed",
          platforms: ["google"],
          startedAt: new Date(),
          completedAt: new Date(),
          summaryJson: {
            totalTests: 5,
            passedTests: 5,
            failedTests: 0,
            missingParamTests: 0,
          },
          createdAt: new Date("2024-01-02"),
        },
        {
          id: "run-2",
          shopId: "shop-1",
          runName: "测试2",
          runType: "full",
          status: "completed",
          platforms: ["google", "meta"],
          startedAt: new Date(),
          completedAt: new Date(),
          summaryJson: {
            totalTests: 10,
            passedTests: 8,
            failedTests: 1,
            missingParamTests: 1,
          },
          createdAt: new Date("2024-01-01"),
        },
      ];

      vi.mocked(prisma.verificationRun.findMany).mockResolvedValue(mockRuns as any);

      const history = await getVerificationHistory("shop-1", 10);

      expect(history).toHaveLength(2);
      expect(history[0].runId).toBe("run-1");
      expect(history[0].totalTests).toBe(5);
      expect(history[1].runId).toBe("run-2");
      expect(history[1].totalTests).toBe(10);
      expect(prisma.verificationRun.findMany).toHaveBeenCalledWith({
        where: { shopId: "shop-1" },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    });
  });

  describe("generateTestOrderGuide", () => {
    it("should generate quick test guide", () => {
      const guide = generateTestOrderGuide("quick");

      expect(guide.steps).toBeDefined();
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.estimatedTime).toBeDefined();
      expect(guide.tips).toBeDefined();
      expect(guide.estimatedTime).toContain("分钟");
    });

    it("should generate full test guide with more steps", () => {
      const quickGuide = generateTestOrderGuide("quick");
      const fullGuide = generateTestOrderGuide("full");

      expect(fullGuide.steps.length).toBeGreaterThan(quickGuide.steps.length);
      expect(fullGuide.estimatedTime).toContain("分钟");
    });

    it("should include test item IDs in steps", () => {
      const guide = generateTestOrderGuide("quick");

      guide.steps.forEach((step) => {
        expect(step.testItemId).toBeDefined();
        expect(step.title).toBeDefined();
        expect(step.description).toBeDefined();
      });
    });
  });

  describe("exportVerificationReport", () => {
    it("should throw error when run not found", async () => {
      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(null);

      await expect(exportVerificationReport("non-existent", "json")).rejects.toThrow(
        "Verification run not found"
      );
    });

    it("should export JSON report", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "测试运行",
        runType: "quick",
        status: "completed",
        platforms: ["google"],
        summaryJson: {
          totalTests: 5,
          passedTests: 5,
        },
        eventsJson: [],
        shop: {
          shopDomain: "test-shop.myshopify.com",
        },
      };

      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(mockRun as any);

      const result = await exportVerificationReport("run-1", "json");

      expect(result.filename).toContain(".json");
      expect(result.mimeType).toBe("application/json");
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it("should export CSV report", async () => {
      const mockRun = {
        id: "run-1",
        shopId: "shop-1",
        runName: "测试运行",
        runType: "quick",
        status: "completed",
        platforms: ["google"],
        summaryJson: {
          totalTests: 2,
          passedTests: 1,
          failedTests: 1,
        },
        eventsJson: [
          {
            testItemId: "purchase",
            eventType: "purchase",
            platform: "google",
            orderId: "order-1",
            status: "success",
            params: { value: 100, currency: "USD" },
          },
          {
            testItemId: "purchase",
            eventType: "purchase",
            platform: "google",
            orderId: "order-2",
            status: "failed",
            errors: ["API error"],
          },
        ],
        shop: {
          shopDomain: "test-shop.myshopify.com",
        },
      };

      vi.mocked(prisma.verificationRun.findUnique).mockResolvedValue(mockRun as any);

      const result = await exportVerificationReport("run-1", "csv");

      expect(result.filename).toContain(".csv");
      expect(result.mimeType).toBe("text/csv");
      expect(result.content).toContain("测试项");
      expect(result.content).toContain("事件类型");
      expect(result.content).toContain("平台");
      expect(result.content).toContain("order-1");
      expect(result.content).toContain("order-2");
    });
  });
});

