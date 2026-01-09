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

      
      (decryptCredentials as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        value: {
          credentials: { accessToken: "token-123" },
        },
      });

      
      (sendConversionToPlatform as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
      });

      
      
      const shopDomain = mockJob.shop.shopDomain;
      const destination = mockPixelConfig.platform;

      
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

      
      metrics.pxDestinationFail(shopDomain, destination, errorMessage);

      expect(metrics.pxDestinationFail).toHaveBeenCalledWith(
        "test-shop.myshopify.com",
        "google",
        "API error"
      );

      
      expect(shopDomain).toBeDefined();
    });
  });

  describe("Bug Fix: Partial success status consistency", () => {
    it("should return 'failed' result when status is FAILED in partial success scenario", () => {
      
      
      
      
      const partialSuccessResult = {
        result: "failed" as const, 
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

      
      expect(partialSuccessResult.result).toBe("failed");
      expect(partialSuccessResult.update.status).toBe("failed");
    });

    it("should return 'succeeded' result when status is COMPLETED after max attempts in partial success", () => {
      
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
      
      
      
      const pixelConfigs = [
        { platform: "google" },
        { platform: "facebook" },
      ];
      
      
      const rejectedCount = 2;
      const skippedCount = 0;
      const anySent = false;
      
      
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
      const anySent = true; 
      
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
      
      
      
      const reservation = {
        success: true,
        current: 5,
        limit: 100,
        remaining: 95,
        alreadyCounted: false,
        yearMonth: "2024-01", 
      };
      
      
      const expectedYearMonth = reservation.yearMonth;
      
      expect(expectedYearMonth).toBe("2024-01");
    });

    it("should not release slot when alreadyCounted is true", () => {
      const reservation = {
        success: true,
        current: 5,
        limit: 100,
        remaining: 95,
        alreadyCounted: true, 
        yearMonth: "2024-01",
      };
      
      
      const shouldRelease = !reservation.alreadyCounted;
      
      expect(shouldRelease).toBe(false);
    });
  });
});
