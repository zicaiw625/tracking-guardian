import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../app/utils/redis-client.server", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../../../app/lib/pixel-events/ingest-pipeline.server", () => ({
  normalizeEvents: vi.fn((events: any[]) => events),
  deduplicateEvents: vi.fn(async (events: any[]) => events),
  distributeEvents: vi.fn(async () => []),
}));

vi.mock("../../../app/services/dispatch/internal-event-write.server", () => ({
  persistInternalEventsAndDispatchJobs: vi.fn(async () => void 0),
}));

vi.mock("../../../app/utils/config.server", () => ({
  API_CONFIG: {
    TIMESTAMP_WINDOW_MS: 15 * 60 * 1000,
  },
}));

import { getRedisClient } from "../../../app/utils/redis-client.server";
import { processIngestQueue } from "../../../app/lib/pixel-events/ingest-queue.server";

type FakeRedis = ReturnType<typeof makeFakeRedis>;

function makeFakeRedis() {
  const lists = new Map<string, string[]>();
  const kv = new Map<string, string>();
  const deletedKeys: string[] = [];

  return {
    // minimal surface used by ingest-queue.server.ts
    getConnectionInfo() {
      return { connected: true, mode: "memory" as const, reconnectAttempts: 0 };
    },
    async rPopLPush(source: string, destination: string): Promise<string | null> {
      const src = lists.get(source) ?? [];
      if (src.length === 0) return null;
      const val = src.pop()!;
      lists.set(source, src);
      const dest = lists.get(destination) ?? [];
      dest.unshift(val);
      lists.set(destination, dest);
      return val;
    },
    async lRem(key: string, count: number, element: string): Promise<number> {
      const list = lists.get(key) ?? [];
      let removed = 0;
      for (let i = 0; i < list.length && removed < count; i++) {
        if (list[i] === element) {
          list.splice(i, 1);
          removed++;
          i--;
        }
      }
      lists.set(key, list);
      return removed;
    },
    async lIndex(key: string, index: number): Promise<string | null> {
      const list = lists.get(key) ?? [];
      const idx = index < 0 ? list.length + index : index;
      return list[idx] ?? null;
    },
    async lLen(key: string): Promise<number> {
      return (lists.get(key) ?? []).length;
    },
    async lPush(key: string, ...values: string[]): Promise<number> {
      const list = lists.get(key) ?? [];
      for (let i = values.length - 1; i >= 0; i--) {
        list.unshift(values[i]);
      }
      lists.set(key, list);
      return list.length;
    },
    async get(key: string): Promise<string | null> {
      return kv.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      kv.set(key, value);
    },
    async del(key: string): Promise<number> {
      deletedKeys.push(key);
      return kv.delete(key) ? 1 : 0;
    },

    // test helpers
    _lists: lists,
    _kv: kv,
    _deletedKeys: deletedKeys,
  };
}

describe("ingest queue hardening", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = makeFakeRedis();
    vi.mocked(getRedisClient).mockResolvedValue(redis as any);
  });

  it("ACKs by entryId and deletes entry payload key", async () => {
    const now = Date.now();
    const entryId = "req_abc";
    const entryKey = `ingest:entry:${entryId}`;
    const entry = {
      entryId,
      requestId: entryId,
      shopId: "shop-1",
      shopDomain: "test-shop.myshopify.com",
      environment: "live",
      mode: "purchase_only",
      validatedEvents: [
        {
          index: 0,
          payload: {
            eventName: "checkout_completed",
            timestamp: now,
            shopDomain: "test-shop.myshopify.com",
            data: { orderId: "gid://shopify/Order/1" },
          },
        },
      ],
      keyValidation: { matched: true, reason: "hmac_verified", trustLevel: "trusted" },
      origin: "https://test-shop.myshopify.com",
      enabledPixelConfigs: [],
      enqueuedAt: now,
    };

    redis._kv.set(entryKey, JSON.stringify(entry));
    redis._lists.set("ingest:queue", [entryId]);
    redis._lists.set("ingest:processing", []);

    const result = await processIngestQueue({ maxBatches: 1 });
    expect(result.processed).toBe(1);
    expect(redis._lists.get("ingest:processing") ?? []).toEqual([]);
    expect(redis._deletedKeys).toContain(entryKey);
  });
});
