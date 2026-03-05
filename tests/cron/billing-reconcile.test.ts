import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest } from "../setup";

const syncSubscriptionStatusMock = vi.fn();
const createAdminClientForShopMock = vi.fn();

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/cron/auth", () => ({
  validateCronAuth: vi.fn(() => null),
  verifyReplayProtection: vi.fn(async () => ({ valid: true })),
}));

vi.mock("../../app/utils/cron-lock", () => ({
  withCronLock: vi.fn(async (_key: string, _instance: string, handler: () => Promise<unknown>) => ({
    executed: true,
    result: await handler(),
  })),
}));

vi.mock("../../app/cron/tasks/cleanup", () => ({
  cleanupExpiredData: vi.fn(async () => ({ shopsProcessed: 0 })),
  downgradeExpiredEntitlements: vi.fn(async () => 0),
}));

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findMany: vi.fn(async () => [
        { shopDomain: "shop-a.myshopify.com" },
        { shopDomain: "shop-b.myshopify.com" },
      ]),
    },
  },
}));

vi.mock("../../app/shopify.server", () => ({
  createAdminClientForShop: createAdminClientForShopMock,
}));

vi.mock("../../app/services/billing/subscription.server", () => ({
  syncSubscriptionStatus: syncSubscriptionStatusMock,
}));

vi.mock("../../app/lib/pixel-events/ingest-queue.server", () => ({
  processIngestQueue: vi.fn(async () => ({ processed: 0 })),
  recoverStuckProcessingItems: vi.fn(async () => 0),
}));

vi.mock("../../app/services/dispatch/run-worker.server", () => ({
  runDispatchWorker: vi.fn(async () => ({ processed: 0 })),
}));

vi.mock("../../app/services/gdpr/job-processor", () => ({
  processGDPRJobs: vi.fn(async () => ({ processed: 0 })),
}));

vi.mock("../../app/services/dashboard-aggregation.server", () => ({
  batchAggregateMetrics: vi.fn(async () => 0),
}));

vi.mock("../../app/services/alert-detection.server", () => ({
  runAlertDetectionForAllShops: vi.fn(async () => ({ processed: 0 })),
}));

describe("/api/cron billing_reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAdminClientForShopMock
      .mockResolvedValueOnce({ graphql: vi.fn() })
      .mockResolvedValueOnce(null);
    syncSubscriptionStatusMock.mockResolvedValue(undefined);
  });

  it("执行 billing_reconcile 并返回同步统计", async () => {
    const { loader } = await import("../../app/lib/api-routes/api.cron");
    const request = createMockRequest("https://test.example.com/api/cron?task=billing_reconcile", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
    });

    const response = await loader({ request } as unknown as { request: Request });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.billing_reconcile).toEqual({
      shops: 2,
      synced: 1,
      skippedNoAdmin: 1,
      failed: 0,
    });
    expect(syncSubscriptionStatusMock).toHaveBeenCalledTimes(1);
    expect(createAdminClientForShopMock).toHaveBeenCalledTimes(2);
  });
});
