import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = {
  rPopLPush: vi.fn(),
  lRem: vi.fn(),
  lPush: vi.fn(),
  lTrim: vi.fn(),
  lIndex: vi.fn(),
  hSet: vi.fn(),
  hGetAll: vi.fn(),
  hMSet: vi.fn(),
  del: vi.fn(),
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
    redisMock.lRem.mockReset();
    redisMock.lPush.mockReset();
    redisMock.lTrim.mockReset();
    redisMock.lIndex.mockReset();
    redisMock.hSet.mockReset();
    redisMock.hGetAll.mockReset();
    redisMock.hMSet.mockReset();
    redisMock.del.mockReset();
    redisMock.hGetAll.mockResolvedValue({});
    redisMock.del.mockResolvedValue(1);
    redisMock.hMSet.mockResolvedValue(undefined);
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
    redisMock.hSet.mockResolvedValue(1);
    redisMock.lRem.mockResolvedValue(1);
    redisMock.lPush.mockResolvedValue(1);
    redisMock.hGetAll.mockResolvedValueOnce({ req_1: JSON.stringify(entry) }).mockResolvedValueOnce({});

    const result = await processIngestQueue({ maxBatches: 1 });

    expect(result.processed).toBe(1);
    expect(redisMock.hSet).toHaveBeenCalledTimes(1);
    expect(redisMock.hSet.mock.calls[0][0]).toBe("ingest:processing:entries");
    expect(redisMock.hSet.mock.calls[0][1]).toBe("req_1");
    const updated = JSON.parse(redisMock.hSet.mock.calls[0][2] as string) as IngestQueueEntry;
    expect(typeof updated.processingStartedAt).toBe("number");
  });
});

describe("ingest queue stuck recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.rPopLPush.mockReset();
    redisMock.lRem.mockReset();
    redisMock.lPush.mockReset();
    redisMock.lTrim.mockReset();
    redisMock.lIndex.mockReset();
    redisMock.hSet.mockReset();
    redisMock.hGetAll.mockReset();
    redisMock.hMSet.mockReset();
    redisMock.del.mockReset();
    redisMock.hGetAll.mockResolvedValue({});
    redisMock.del.mockResolvedValue(1);
    redisMock.hMSet.mockResolvedValue(undefined);
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

  it("recovers hash-based stale entries by requestId", async () => {
    const now = Date.now();
    const requestId = "req_hash_1";
    const stale = {
      requestId,
      enqueuedAt: now - 60 * 60 * 1000,
      processingStartedAt: now - 10 * 60 * 1000,
    };
    redisMock.lIndex.mockResolvedValueOnce(requestId).mockResolvedValueOnce(null);
    redisMock.hGetAll
      .mockResolvedValueOnce({ [requestId]: JSON.stringify(stale) })
      .mockResolvedValueOnce({ [requestId]: JSON.stringify(stale) });
    redisMock.lPush.mockResolvedValue(1);
    redisMock.lRem.mockResolvedValue(1);

    const recovered = await recoverStuckProcessingItems(10, 60 * 1000);

    expect(recovered).toBe(1);
    expect(redisMock.lPush).toHaveBeenCalledWith("ingest:queue", JSON.stringify(stale));
    expect(redisMock.lRem).toHaveBeenCalledWith("ingest:processing", 1, requestId);
    expect(redisMock.del).toHaveBeenCalledWith("ingest:processing:entries");
  });
});
