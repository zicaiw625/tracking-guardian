import { getRedisClient } from "~/utils/redis-client.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";

const QUEUE_KEY = "ingest:queue";
const PROCESSING_KEY = "ingest:processing";
const DLQ_KEY = "ingest:dlq";
const ENTRY_KEY_PREFIX = "ingest:entry:";
const MAX_QUEUE_SIZE = 100_000;
const MAX_BATCHES_PER_RUN = 50;
const MAX_RETRIES = 5;
const ENTRY_TTL_SECONDS = 24 * 60 * 60;

export type EnqueueIngestResult = { ok: true } | { ok: false; reason: "overloaded" | "redis_error" };

export interface IngestRequestContext {
  ip?: string | null;
  user_agent?: string | null;
  ip_encrypted?: string | null;
  user_agent_encrypted?: string | null;
  page_url?: string | null;
  referrer?: string | null;
}

export interface IngestQueueEntry {
  entryId: string;
  requestId: string;
  shopId: string;
  shopDomain: string;
  environment: "test" | "live";
  mode: "purchase_only" | "full_funnel";
  validatedEvents: Array<{ payload: PixelEventPayload; index: number }>;
  keyValidation: KeyValidationResult;
  origin: string | null;
  requestContext?: IngestRequestContext;
  enqueuedAt?: number;
  retryCount?: number;
  enabledPixelConfigs?: Array<{
    platform: string;
    id: string;
    platformId?: string | null;
    clientSideEnabled?: boolean | null;
    serverSideEnabled?: boolean | null;
    clientConfig?: unknown;
  }>;
}

function entryKey(entryId: string): string {
  return `${ENTRY_KEY_PREFIX}${entryId}`;
}

const ENQUEUE_LUA = `
local q = KEYS[1]
local entryKey = KEYS[2]
local max = tonumber(ARGV[1])
local entryId = ARGV[2]
local val = ARGV[3]
local ttlSeconds = tonumber(ARGV[4])
local len = redis.call('LLEN', q)
if len >= max then
  return 0
end
redis.call('SET', entryKey, val)
if ttlSeconds and ttlSeconds > 0 then
  redis.call('EXPIRE', entryKey, ttlSeconds)
end
redis.call('LPUSH', q, entryId)
return 1
`;

export async function enqueueIngestBatch(entry: IngestQueueEntry): Promise<EnqueueIngestResult> {
  try {
    const redis = await getRedisClient();
    if (!entry.entryId) {
      // Prefer requestId for deterministic uniqueness within this pipeline.
      entry.entryId = entry.requestId;
    }
    entry.enqueuedAt = Date.now();
    const serialized = JSON.stringify(entry);

    // P0: Fail-fast on overload to avoid silently dropping old queue items.
    // Use Lua for atomic check+push under concurrency.
    const conn = redis.getConnectionInfo();
    let pushed = false;
    if (conn.mode === "redis") {
      const result = await redis.eval(
        ENQUEUE_LUA,
        [QUEUE_KEY, entryKey(entry.entryId)],
        [String(MAX_QUEUE_SIZE), entry.entryId, serialized, String(ENTRY_TTL_SECONDS)]
      );
      pushed = typeof result === "number" ? result === 1 : result === 1 || result === "1";
    } else {
      // In-memory mode (dev/test): best-effort non-atomic fallback.
      const len = await redis.lLen(QUEUE_KEY);
      if (len < MAX_QUEUE_SIZE) {
        await redis.set(entryKey(entry.entryId), serialized, { EX: ENTRY_TTL_SECONDS });
        await redis.lPush(QUEUE_KEY, entry.entryId);
        pushed = true;
      }
    }
    if (!pushed) {
      logger.warn("Ingest queue overloaded - rejecting new batch", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        maxQueueSize: MAX_QUEUE_SIZE,
      });
      return { ok: false, reason: "overloaded" };
    }

    return { ok: true };
  } catch (e) {
    logger.error("Failed to enqueue ingest batch", {
      requestId: entry.requestId,
      shopDomain: entry.shopDomain,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "redis_error" };
  }
}

export async function processIngestQueue(options?: {
  maxBatches?: number;
}): Promise<{ processed: number; errors: number }> {
  const maxBatches = options?.maxBatches ?? MAX_BATCHES_PER_RUN;
  const { normalizeEvents, deduplicateEvents, distributeEvents } = await import("./ingest-pipeline.server");
  const { API_CONFIG } = await import("~/utils/config.server");
  const redis = await getRedisClient();
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < maxBatches; i++) {
    const entryId = await redis.rPopLPush(QUEUE_KEY, PROCESSING_KEY);
    if (!entryId) break;

    let entry: IngestQueueEntry;
    try {
      const raw = await redis.get(entryKey(entryId));
      if (!raw) {
        logger.warn("Missing ingest queue entry payload (stale id in list)", { entryId });
        await redis.lRem(PROCESSING_KEY, 1, entryId);
        errors++;
        continue;
      }
      entry = JSON.parse(raw) as IngestQueueEntry;
    } catch (e) {
      logger.warn("Invalid ingest queue entry payload JSON", {
        entryId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Invalid payload, drop from processing queue to avoid blocking. Keep payload key for TTL cleanup.
      await redis.lRem(PROCESSING_KEY, 1, entryId);
      errors++;
      continue;
    }

    try {
      const filtered = entry.validatedEvents.filter((ve) => {
        if (ve.payload.shopDomain !== entry.shopDomain) return false;
        const now = Date.now();
        const diff = Math.abs(now - ve.payload.timestamp);
        if (diff > API_CONFIG.TIMESTAMP_WINDOW_MS) return false;
        return true;
      });

      const normalized = normalizeEvents(
        filtered.map((ve) => ({ payload: ve.payload, index: ve.index })),
        entry.shopDomain,
        entry.mode
      );
      const deduplicated = await deduplicateEvents(normalized, entry.shopId, entry.shopDomain);
      const rawConfigs = entry.enabledPixelConfigs ?? [];
      const configs = rawConfigs.map((c) => ({
        ...c,
        platform: c.platform ?? "",
        id: c.id ?? "",
      }));
      const processedEvents = await distributeEvents(
        deduplicated,
        entry.shopId,
        entry.shopDomain,
        configs,
        entry.keyValidation,
        entry.origin,
        undefined
      );

      try {
        const { persistInternalEventsAndDispatchJobs } =
          await import("~/services/dispatch/internal-event-write.server");
        await persistInternalEventsAndDispatchJobs(
          entry.shopId,
          processedEvents,
          entry.requestContext,
          entry.environment
        );
      } catch (e) {
        logger.error("Failed to persist InternalEvent and dispatch jobs", {
          shopId: entry.shopId,
          shopDomain: entry.shopDomain,
          error: e instanceof Error ? e.message : String(e),
        });
        // If persistence fails, we might want to retry.
        // For now, we throw so it stays in processing queue (or we could rely on this catch to NOT acknowledge).
        throw e;
      }

      // Success - remove from processing queue (ACK)
      await redis.lRem(PROCESSING_KEY, 1, entryId);
      await redis.del(entryKey(entryId));
      processed++;
    } catch (e) {
      const currentRetry = entry.retryCount || 0;
      logger.error("Ingest worker batch failed", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        shopId: entry.shopId,
        entryId,
        retryCount: currentRetry,
        error: e instanceof Error ? e.message : String(e),
      });

      try {
        if (currentRetry >= MAX_RETRIES) {
          logger.warn(`Ingest batch exceeded max retries (${MAX_RETRIES}), moving to DLQ`, {
            requestId: entry.requestId,
            shopDomain: entry.shopDomain,
            entryId,
          });
          entry.retryCount = currentRetry + 1;
          entry.enqueuedAt = Date.now();
          await redis.set(entryKey(entryId), JSON.stringify(entry), { EX: ENTRY_TTL_SECONDS });
          await redis.lPush(DLQ_KEY, entryId);
          await redis.lRem(PROCESSING_KEY, 1, entryId);
        } else {
          // Re-queue with incremented retry count
          // Push to Head of Queue (will be processed last, acting as backoff)
          entry.retryCount = currentRetry + 1;
          entry.enqueuedAt = Date.now();
          await redis.set(entryKey(entryId), JSON.stringify(entry), { EX: ENTRY_TTL_SECONDS });
          await redis.lPush(QUEUE_KEY, entryId);
          await redis.lRem(PROCESSING_KEY, 1, entryId);
        }
      } catch (queueError) {
        logger.error("Failed to handle failed ingest batch (DLQ/Retry)", {
          requestId: entry.requestId,
          entryId,
          error: queueError instanceof Error ? queueError.message : String(queueError),
        });
        // If we fail here, we leave it in PROCESSING_KEY.
        // It will be picked up by recoverStuckProcessingItems later,
        // effectively resetting its retry loop (since we couldn't update the JSON).
        // This is a safe fallback.
      }

      errors++;
    }
  }

  return { processed, errors };
}

export async function recoverStuckProcessingItems(limit = 100, maxAgeMs = 15 * 60 * 1000): Promise<number> {
  const redis = await getRedisClient();
  let recovered = 0;

  // Check items at the tail of the processing list (oldest items)
  while (recovered < limit) {
    const lastEntryId = await redis.lIndex(PROCESSING_KEY, -1);
    if (!lastEntryId) break;

    let shouldRecover = false;
    try {
      const raw = await redis.get(entryKey(lastEntryId));
      if (!raw) {
        shouldRecover = true;
      } else {
        const entry = JSON.parse(raw) as IngestQueueEntry;
        if (entry.enqueuedAt && Date.now() - entry.enqueuedAt > maxAgeMs) {
          shouldRecover = true;
        } else if (!entry.enqueuedAt) {
          // Legacy item without timestamp, treat as stuck if it's at the tail
          shouldRecover = true;
        }
      }
    } catch {
      // Invalid JSON, move it out to avoid blocking
      shouldRecover = true;
    }

    if (shouldRecover) {
      // Move from Tail of Processing to Head of Queue
      const moved = await redis.rPopLPush(PROCESSING_KEY, QUEUE_KEY);
      if (moved) {
        recovered++;
        logger.warn("Recovered stuck ingest item", { from: PROCESSING_KEY, to: QUEUE_KEY });
      } else {
        break;
      }
    } else {
      // Oldest item is not stuck yet, so newer items won't be either
      break;
    }
  }
  return recovered;
}
