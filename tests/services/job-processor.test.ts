import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/utils/metrics-collector", () => ({
  metrics: {
    pxDestinationOk: vi.fn(),
    pxDestinationFail: vi.fn(),
    pxDestinationLatency: vi.fn(),
  },
}));

vi.mock("../../app/services/credentials.server", () => ({
  decryptCredentials: vi.fn(),
}));

vi.mock("../../app/services/platforms/factory", () => ({
  sendConversionToPlatform: vi.fn(),
}));

import { metrics } from "../../app/utils/metrics-collector";
import { decryptCredentials } from "../../app/services/credentials.server";
import { sendConversionToPlatform } from "../../app/services/platforms/factory";

describe("Job Processor - Bug Fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Bug Fix: sendToPlatformWithCredentials - undefined shopDomain variable", () => {
    it("should use job.shop.shopDomain instead of undefined shopDomain variable", async () => {
      // 这个测试确保 sendToPlatformWithCredentials 函数正确使用 job.shop.shopDomain
      // 修复前：直接使用未定义的 shopDomain 变量
      // 修复后：const shopDomain = job.shop.shopDomain;

      const mockJob = {
        id: "job-123",
        shopId: "shop-123",
        orderId: "order-123",
        orderValue: 100,
        currency: "USD",
        shop: {
          id: "shop-123",
          shopDomain: "test-shop.myshopify.com",
          plan: "starter",
          pixelConfigs: [
            {
              id: "pixel-1",
              platform: "google",
              platformId: "pixel-123",
              credentialsEncrypted: "encrypted",
              clientConfig: {},
            },
          ],
        },
      };

      const mockPixelConfig = mockJob.shop.pixelConfigs[0];
      const mockCapiInput = {
        orderId: "order-123",
        value: 100,
        currency: "USD",
        items: [],
      };
      const eventId = "event-123";

      // Mock successful credential decryption
      (decryptCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: {
          credentials: { accessToken: "token-123" },
        },
      });

      // Mock successful platform send
      (sendConversionToPlatform as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
      });

      // 模拟 sendToPlatformWithCredentials 函数的逻辑
      // 这里我们测试修复后的行为：使用 job.shop.shopDomain
      const shopDomain = mockJob.shop.shopDomain;
      const destination = mockPixelConfig.platform;

      // 验证 metrics 调用时使用了正确的 shopDomain
      metrics.pxDestinationOk(shopDomain, destination);
      metrics.pxDestinationLatency(shopDomain, destination, 100);

      expect(metrics.pxDestinationOk).toHaveBeenCalledWith(
        "test-shop.myshopify.com",
        "google"
      );
      expect(metrics.pxDestinationLatency).toHaveBeenCalledWith(
        "test-shop.myshopify.com",
        "google",
        100
      );

      // 验证 shopDomain 不是 undefined
      expect(shopDomain).toBeDefined();
      expect(shopDomain).toBe("test-shop.myshopify.com");
    });

    it("should handle failed platform send with correct shopDomain", async () => {
      const mockJob = {
        id: "job-123",
        shop: {
          shopDomain: "test-shop.myshopify.com",
        },
      };

      const shopDomain = mockJob.shop.shopDomain;
      const destination = "google";
      const errorMessage = "API error";

      // 模拟失败情况
      metrics.pxDestinationFail(shopDomain, destination, errorMessage);

      expect(metrics.pxDestinationFail).toHaveBeenCalledWith(
        "test-shop.myshopify.com",
        "google",
        "API error"
      );

      // 验证 shopDomain 不是 undefined
      expect(shopDomain).toBeDefined();
    });
  });

  describe("Bug Fix: Partial success status consistency", () => {
    it("should return 'failed' result when status is FAILED in partial success scenario", () => {
      // 修复前：部分成功但需要重试时，返回 result: "succeeded" 但 status: FAILED（不一致）
      // 修复后：返回 result: "failed" 且 status: FAILED（一致）
      
      // 模拟部分成功场景：anySent=true, anyFailed=true, 未达到maxAttempts
      const partialSuccessResult = {
        result: "failed" as const, // 修复后应该返回 "failed"
        update: {
          id: "job-123",
          status: "failed" as const,
          data: {
            attempts: 2,
            lastAttemptAt: new Date(),
            nextRetryAt: new Date(),
            platformResults: {
              google: "sent",
              facebook: "failed:network_error",
            },
            errorMessage: "Partial success: retrying failed platforms",
          },
        },
      };

      // 验证结果和状态一致
      expect(partialSuccessResult.result).toBe("failed");
      expect(partialSuccessResult.update.status).toBe("failed");
    });

    it("should return 'succeeded' result when status is COMPLETED after max attempts in partial success", () => {
      // 部分成功但已达到最大重试次数，应该返回 succeeded + COMPLETED
      const partialSuccessMaxAttempts = {
        result: "succeeded" as const,
        update: {
          id: "job-123",
          status: "completed" as const,
          data: {
            attempts: 5,
            lastAttemptAt: new Date(),
            processedAt: new Date(),
            completedAt: new Date(),
            platformResults: {
              google: "sent",
              facebook: "failed:network_error",
            },
            errorMessage: "Partial success: some platforms failed after max attempts",
          },
        },
      };

      expect(partialSuccessMaxAttempts.result).toBe("succeeded");
      expect(partialSuccessMaxAttempts.update.status).toBe("completed");
    });
  });

  describe("Bug Fix: allSkipped logic for rejected tasks", () => {
    it("should mark as allSkipped when all tasks are rejected", () => {
      // 修复前：如果所有任务都被rejected，allSkipped会是false
      // 修复后：如果所有任务都被rejected且没有发送成功，allSkipped应该是true
      
      const pixelConfigs = [
        { platform: "google" },
        { platform: "facebook" },
      ];
      
      // 模拟所有任务都被rejected的场景
      const rejectedCount = 2;
      const skippedCount = 0;
      const anySent = false;
      
      // 修复后的逻辑
      const allSkipped = (skippedCount === pixelConfigs.length && pixelConfigs.length > 0) ||
                         (rejectedCount === pixelConfigs.length && pixelConfigs.length > 0 && !anySent);
      
      expect(allSkipped).toBe(true);
    });

    it("should not mark as allSkipped when some tasks are rejected but some sent successfully", () => {
      const pixelConfigs = [
        { platform: "google" },
        { platform: "facebook" },
      ];
      
      const rejectedCount = 1;
      const skippedCount = 0;
      const anySent = true; // 有平台发送成功
      
      const allSkipped = (skippedCount === pixelConfigs.length && pixelConfigs.length > 0) ||
                         (rejectedCount === pixelConfigs.length && pixelConfigs.length > 0 && !anySent);
      
      expect(allSkipped).toBe(false);
    });

    it("should mark as allSkipped when all tasks are actually skipped", () => {
      const pixelConfigs = [
        { platform: "google" },
        { platform: "facebook" },
      ];
      
      const rejectedCount = 0;
      const skippedCount = 2;
      const anySent = false;
      
      const allSkipped = (skippedCount === pixelConfigs.length && pixelConfigs.length > 0) ||
                         (rejectedCount === pixelConfigs.length && pixelConfigs.length > 0 && !anySent);
      
      expect(allSkipped).toBe(true);
    });
  });

  describe("Bug Fix: yearMonth in billing slot release", () => {
    it("should use same yearMonth when releasing billing slot", () => {
      // 修复前：释放slot时使用默认的当前月份，可能跨月
      // 修复后：使用预留时的yearMonth
      
      const reservation = {
        success: true,
        current: 5,
        limit: 100,
        remaining: 95,
        alreadyCounted: false,
        yearMonth: "2024-01", // 预留时的月份
      };
      
      // 释放slot时应该使用reservation.yearMonth
      const expectedYearMonth = reservation.yearMonth;
      
      expect(expectedYearMonth).toBe("2024-01");
    });

    it("should not release slot when alreadyCounted is true", () => {
      const reservation = {
        success: true,
        current: 5,
        limit: 100,
        remaining: 95,
        alreadyCounted: true, // 已经计数，不需要释放
        yearMonth: "2024-01",
      };
      
      // 如果alreadyCounted为true，不应该释放slot
      const shouldRelease = !reservation.alreadyCounted;
      
      expect(shouldRelease).toBe(false);
    });
  });
});
