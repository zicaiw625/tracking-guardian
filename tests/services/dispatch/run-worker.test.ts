import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../app/services/dispatch/queue", () => ({
  listPendingJobs: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
}));

vi.mock("~/services/destinations/ga4", () => ({ sendEvent: vi.fn() }));
vi.mock("~/services/destinations/meta", () => ({ sendEvent: vi.fn() }));
vi.mock("~/services/destinations/tiktok", () => ({ sendEvent: vi.fn() }));
vi.mock("~/services/credentials.server", () => ({ getValidCredentials: vi.fn() }));

import { runDispatchWorker } from "../../../app/services/dispatch/run-worker.server";
import { listPendingJobs, markFailed, markSent } from "../../../app/services/dispatch/queue";
import prisma from "../../../app/db.server";
import * as redisClient from "../../../app/utils/redis-client.server";

describe("runDispatchWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVER_SIDE_CONVERSIONS_ENABLED = "true";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    vi.spyOn(prisma.eventDispatchJob, "updateMany").mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.pixelConfig, "findMany").mockResolvedValue([]);
    vi.spyOn(redisClient, "getRedisClient").mockRejectedValue(new Error("redis down"));
  });

  it("pauses dispatch when redis is unavailable", async () => {
    vi.mocked(listPendingJobs).mockResolvedValue([
      {
        id: "job-1",
        internal_event_id: "ie-1",
        destination: "GA4",
        status: "PENDING",
        attempts: 0,
        next_retry_at: new Date(),
        InternalEvent: {
          id: "ie-1",
          shopId: "shop-1",
          source: "web_pixel",
          event_name: "purchase",
          event_id: "evt-1",
          client_id: null,
          timestamp: BigInt(Date.now()),
          occurred_at: new Date(),
          ip: null,
          user_agent: null,
          page_url: null,
          referrer: null,
          querystring: null,
          currency: "USD",
          value: 1,
          transaction_id: null,
          items: [],
          user_data_hashed: null,
          consent_purposes: null,
          environment: "live",
        },
      } as any,
    ]);

    const result = await runDispatchWorker();
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
    expect(markSent).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });
});
