import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = {
  rPopLPush: vi.fn(),
  lSet: vi.fn(),
  lRem: vi.fn(),
  lPush: vi.fn(),
  lTrim: vi.fn(),
  lIndex: vi.fn(),
};

vi.mock("../../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn(async () => redisMock),
}));

vi.mock("../../../app/utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  metrics: {
    silentDrop: vi.fn(),
  },
}));

vi.mock("../../../app/lib/pixel-events/ingest-pipeline.server", () => ({
  normalizeEvents: vi.fn(() => []),
  deduplicateEvents: vi.fn(async () => []),
  distributeEvents: vi.fn(async () => []),
}));

vi.mock("../../../app/services/dispatch/internal-event-write.server", () => ({
  persistInternalEventsAndDispatchJobs: vi.fn(async () => undefined),
}));

import {
  processIngestQueue,
  recoverStuckProcessingItems,
  type IngestQueueEntry,
} from "../../../app/lib/pixel-events/ingest-queue.server";

describe("ingest queue processing timestamps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.rPopLPush.mockReset();
    redisMock.lSet.mockReset();
    redisMock.lRem.mockReset();
    redisMock.lPush.mockReset();
    redisMock.lTrim.mockReset();
    redisMock.lIndex.mockReset();
  });

  it("persists processingStartedAt when batch starts", async () => {
    const entry: IngestQueueEntry = {
      requestId: "req_1",
      shopId: "shop_1",
      shopDomain: "test-shop.myshopify.com",
      environment: "live",
      mode: "purchase_only",
      validatedEvents: [],
      keyValidation: { matched: true, reason: "ok", trustLevel: "trusted" },
      origin: "https://test-shop.myshopify.com",
    };
    redisMock.rPopLPush.mockResolvedValueOnce(JSON.stringify(entry)).mockResolvedValueOnce(null);
    redisMock.lSet.mockResolvedValue(undefined);
    redisMock.lRem.mockResolvedValue(1);

    const result = await processIngestQueue({ maxBatches: 1 });

    expect(result.processed).toBe(1);
    expect(redisMock.lSet).toHaveBeenCalledTimes(1);
    expect(redisMock.lSet.mock.calls[0][0]).toBe("ingest:processing");
    expect(redisMock.lSet.mock.calls[0][1]).toBe(0);
    const updated = JSON.parse(redisMock.lSet.mock.calls[0][2] as string) as IngestQueueEntry;
    expect(typeof updated.processingStartedAt).toBe("number");
  });
});

describe("ingest queue stuck recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.rPopLPush.mockReset();
    redisMock.lSet.mockReset();
    redisMock.lRem.mockReset();
    redisMock.lPush.mockReset();
    redisMock.lTrim.mockReset();
    redisMock.lIndex.mockReset();
  });

  it("does not recover when processingStartedAt is recent", async () => {
    const now = Date.now();
    const entry = {
      enqueuedAt: now - 60 * 60 * 1000,
      processingStartedAt: now - 5 * 1000,
    };
    redisMock.lIndex.mockResolvedValueOnce(JSON.stringify(entry));

    const recovered = await recoverStuckProcessingItems(10, 60 * 1000);

    expect(recovered).toBe(0);
    expect(redisMock.rPopLPush).not.toHaveBeenCalled();
  });

  it("recovers when processingStartedAt is stale", async () => {
    const now = Date.now();
    const stale = {
      enqueuedAt: now - 60 * 60 * 1000,
      processingStartedAt: now - 10 * 60 * 1000,
    };
    redisMock.lIndex.mockResolvedValueOnce(JSON.stringify(stale)).mockResolvedValueOnce(null);
    redisMock.rPopLPush.mockResolvedValueOnce("moved");

    const recovered = await recoverStuckProcessingItems(10, 60 * 1000);

    expect(recovered).toBe(1);
    expect(redisMock.rPopLPush).toHaveBeenCalledWith("ingest:processing", "ingest:queue");
  });
});
