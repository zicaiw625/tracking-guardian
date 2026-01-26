import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest } from "../setup";

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/services/alert-dispatcher.server", () => ({
  runAllShopAlertChecks: vi.fn(),
}));

vi.mock("../../app/cron/tasks/cleanup", () => ({
  cleanupExpiredData: vi.fn(async () => ({ shopsProcessed: 0 })),
}));

vi.mock("../../app/services/conversion-job.server", () => ({
  processConversionJobs: vi.fn(async () => ({ processed: 0, succeeded: 0, failed: 0, errors: [] })),
}));

vi.mock("../../app/services/delivery-health.server", () => ({
  runAllShopsDeliveryHealthCheck: vi.fn(async () => []),
}));

vi.mock("../../app/services/reconciliation.server", () => ({
  runAllShopsReconciliation: vi.fn(async () => ({ processed: 0, succeeded: 0, failed: 0, results: [] })),
}));

describe("/api/cron Redis strict unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when unable to acquire lock", async () => {
    const { loader } = await import("../../app/lib/api-routes/api.cron");
    const request = createMockRequest("https://test.example.com/api/cron?task=alerts", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
    });
    const response = await loader({ request } as unknown as { request: Request });
    expect(response.status).toBe(503);
  });
});

