import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = {
  rPopLPush: vi.fn(),
  lRem: vi.fn(),
  lPush: vi.fn(),
  lTrim: vi.fn(),
  lIndex: vi.fn(),
  hSet: vi.fn(),
  hGet: vi.fn(),
  hDel: vi.fn(),
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
  enqueueIngestBatch,
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
    redisMock.hGet.mockReset();
    redisMock.hDel.mockReset();
    redisMock.hGet.mockResolvedValue(null);
    redisMock.hDel.mockResolvedValue(1);
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
    redisMock.hDel.mockResolvedValueOnce(1);

    const result = await processIngestQueue({ maxBatches: 1 });

    expect(result.processed).toBe(1);
    expect(redisMock.hSet).toHaveBeenCalledTimes(1);
    expect(redisMock.hSet.mock.calls[0][0]).toBe("ingest:processing:entries");
    expect(redisMock.hSet.mock.calls[0][1]).toBe("req_1");
    const updated = JSON.parse(redisMock.hSet.mock.calls[0][2] as string) as IngestQueueEntry;
    expect(typeof updated.processingStartedAt).toBe("number");
  });

  it("routes purchase batches to purchase queue", async () => {
    const now = Date.now();
    const entry: IngestQueueEntry = {
      requestId: "req_purchase",
      shopId: "shop_1",
      shopDomain: "test-shop.myshopify.com",
      environment: "live",
      mode: "full_funnel",
      validatedEvents: [{
        payload: {
          eventName: "checkout_completed",
          timestamp: now,
          shopDomain: "test-shop.myshopify.com",
          data: {},
        } as any,
        index: 0,
      }],
      keyValidation: { matched: true, reason: "ok", trustLevel: "trusted" },
      origin: "https://test-shop.myshopify.com",
    };

    redisMock.lPush.mockResolvedValue(1);
    redisMock.lTrim.mockResolvedValue(undefined);

    const result = await enqueueIngestBatch(entry);

    expect(result.ok).toBe(true);
    expect(redisMock.lPush).toHaveBeenCalledWith("ingest:queue:purchase", expect.any(String));
    expect(redisMock.lTrim).toHaveBeenCalledWith("ingest:queue:purchase", 0, 99999);
  });

  it("routes non-purchase batches to general queue", async () => {
    const now = Date.now();
    const entry: IngestQueueEntry = {
      requestId: "req_general",
      shopId: "shop_1",
      shopDomain: "test-shop.myshopify.com",
      environment: "live",
      mode: "full_funnel",
      validatedEvents: [{
        payload: {
          eventName: "page_viewed",
          timestamp: now,
          shopDomain: "test-shop.myshopify.com",
          data: {},
        } as any,
        index: 0,
      }],
      keyValidation: { matched: true, reason: "ok", trustLevel: "trusted" },
      origin: "https://test-shop.myshopify.com",
    };

    redisMock.lPush.mockResolvedValue(1);
    redisMock.lTrim.mockResolvedValue(undefined);

    const result = await enqueueIngestBatch(entry);

    expect(result.ok).toBe(true);
    expect(redisMock.lPush).toHaveBeenCalledWith("ingest:queue:general", expect.any(String));
    expect(redisMock.lTrim).toHaveBeenCalledWith("ingest:queue:general", 0, 99999);
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
    redisMock.hGet.mockReset();
    redisMock.hDel.mockReset();
    redisMock.hGet.mockResolvedValue(null);
    redisMock.hDel.mockResolvedValue(1);
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
    expect(redisMock.rPopLPush).toHaveBeenCalledWith("ingest:processing", "ingest:queue:general");
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
    redisMock.hGet.mockResolvedValueOnce(JSON.stringify(stale));
    redisMock.lPush.mockResolvedValue(1);
    redisMock.lRem.mockResolvedValue(1);

    const recovered = await recoverStuckProcessingItems(10, 60 * 1000);

    expect(recovered).toBe(1);
    expect(redisMock.lPush).toHaveBeenCalledWith("ingest:queue:general", JSON.stringify(stale));
    expect(redisMock.lRem).toHaveBeenCalledWith("ingest:processing", 1, requestId);
    expect(redisMock.hDel).toHaveBeenCalledWith("ingest:processing:entries", requestId);
  });
});
