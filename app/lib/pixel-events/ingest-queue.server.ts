import { getRedisClient } from "~/utils/redis-client.server";
import { logger, metrics } from "~/utils/logger.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";
import prisma from "~/db.server";

const QUEUE_KEY = "ingest:queue";
const PURCHASE_QUEUE_KEY = "ingest:queue:purchase";
const GENERAL_QUEUE_KEY = "ingest:queue:general";
const PROCESSING_KEY = "ingest:processing";
const PROCESSING_HASH_KEY = "ingest:processing:entries";
const DLQ_KEY = "ingest:dlq";
const MAX_PURCHASE_QUEUE_SIZE = 100_000;
const MAX_GENERAL_QUEUE_SIZE = 100_000;
const MAX_BATCHES_PER_RUN = 50;
const MAX_RETRIES = 5;

async function getProcessingEntryById(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  requestId: string
): Promise<string | null> {
  return redis.hGet(PROCESSING_HASH_KEY, requestId);
}

async function removeProcessingEntryById(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  requestId: string
): Promise<void> {
  await redis.hDel(PROCESSING_HASH_KEY, requestId);
}

function hasPurchaseEvent(entry: IngestQueueEntry): boolean {
  const validatedEvents = Array.isArray(entry.validatedEvents) ? entry.validatedEvents : [];
  return validatedEvents.some((ve) => {
    const eventName = ve.payload.eventName;
    return eventName === "checkout_completed";
  });
}

function resolveQueueForEntry(entry: IngestQueueEntry): { key: string; maxSize: number; queueType: "purchase" | "general" } {
  const queueType = entry.queueType ?? (hasPurchaseEvent(entry) ? "purchase" : "general");
  if (queueType === "purchase") {
    return { key: PURCHASE_QUEUE_KEY, maxSize: MAX_PURCHASE_QUEUE_SIZE, queueType };
  }
  return { key: GENERAL_QUEUE_KEY, maxSize: MAX_GENERAL_QUEUE_SIZE, queueType };
}

export interface IngestRequestContext {
  ip?: string | null;
  ip_encrypted?: string | null;
  user_agent?: string | null;
  user_agent_encrypted?: string | null;
  page_url?: string | null;
  referrer?: string | null;
}

export interface IngestQueueEntry {
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
  processingStartedAt?: number;
  retryCount?: number;
  enabledPixelConfigs?: Array<{
    platform: string;
    id: string;
    platformId?: string | null;
    clientSideEnabled?: boolean | null;
    serverSideEnabled?: boolean | null;
    clientConfig?: unknown;
  }>;
  queueType?: "purchase" | "general";
}

export async function enqueueIngestBatch(entry: IngestQueueEntry): Promise<{ ok: boolean; dropped: number }> {
  try {
    const redis = await getRedisClient();
    entry.enqueuedAt = Date.now();
    const queue = resolveQueueForEntry(entry);
    entry.queueType = queue.queueType;
    const serialized = JSON.stringify(entry);
    
    const newLength = await redis.lPush(queue.key, serialized);
    await redis.lTrim(queue.key, 0, queue.maxSize - 1);
    const dropped = Math.max(0, newLength - queue.maxSize);
    if (dropped > 0) {
      logger.warn("Ingest queue trimmed - events dropped", {
        queue: queue.key,
        queueLengthBeforeTrim: newLength,
        dropped,
        maxQueueSize: queue.maxSize,
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
      });
      metrics.silentDrop({
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        reason: `ingest_queue_trimmed_backpressure_${queue.queueType}`,
        category: "backpressure",
        sampleRate: 1,
      });
    }
    
    return { ok: true, dropped };
  } catch (e) {
    logger.error("Failed to enqueue ingest batch", {
      requestId: entry.requestId,
      shopDomain: entry.shopDomain,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, dropped: 0 };
  }
}

export async function processIngestQueue(
  options?: { maxBatches?: number }
): Promise<{ processed: number; errors: number }> {
  const maxBatches = options?.maxBatches ?? MAX_BATCHES_PER_RUN;
  const { normalizeEvents, deduplicateEvents, distributeEvents } = await import("./ingest-pipeline.server");
  const { API_CONFIG } = await import("~/utils/config.server");
  const redis = await getRedisClient();
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < maxBatches; i++) {
    const raw =
      (await redis.rPopLPush(PURCHASE_QUEUE_KEY, PROCESSING_KEY)) ??
      (await redis.rPopLPush(GENERAL_QUEUE_KEY, PROCESSING_KEY)) ??
      (await redis.rPopLPush(QUEUE_KEY, PROCESSING_KEY));
    if (!raw) break;

    let entry: IngestQueueEntry;
    try {
      entry = JSON.parse(raw) as IngestQueueEntry;
    } catch (e) {
      logger.warn("Invalid ingest queue entry JSON", {
        error: e instanceof Error ? e.message : String(e),
      });
      await redis.lRem(PROCESSING_KEY, 1, raw);
      errors++;
      continue;
    }

    if (!entry.processingStartedAt) {
      entry.processingStartedAt = Date.now();
    }
    if (!entry.queueType) {
      entry.queueType = hasPurchaseEvent(entry) ? "purchase" : "general";
    }

    const processingRaw = JSON.stringify(entry);
    const processingMarker = entry.requestId;
    try {
      await redis.hSet(PROCESSING_HASH_KEY, processingMarker, processingRaw);
      await redis.lRem(PROCESSING_KEY, 1, raw);
      await redis.lPush(PROCESSING_KEY, processingMarker);
    } catch (e) {
      logger.error("Failed to register processing entry", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        error: e instanceof Error ? e.message : String(e),
      });
      await redis.lRem(PROCESSING_KEY, 1, raw);
      await redis.lPush(QUEUE_KEY, raw);
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
      const deduplicated = await deduplicateEvents(
        normalized,
        entry.shopId,
        entry.shopDomain
      );
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
        undefined,
        entry.environment
      );

      try {
        const { persistInternalEventsAndDispatchJobs } = await import("~/services/dispatch/internal-event-write.server");
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
        await rollbackReceiptsForFailedBatch(entry.shopId, processedEvents);
        // If persistence fails, we might want to retry. 
        // For now, we throw so it stays in processing queue (or we could rely on this catch to NOT acknowledge).
        throw e; 
      }
      
      await redis.lRem(PROCESSING_KEY, 1, processingMarker);
      await removeProcessingEntryById(redis, processingMarker);
      processed++;
    } catch (e) {
      const currentRetry = entry.retryCount || 0;
      logger.error("Ingest worker batch failed", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        shopId: entry.shopId,
        retryCount: currentRetry,
        error: e instanceof Error ? e.message : String(e),
      });
      
      try {
        if (currentRetry >= MAX_RETRIES) {
          logger.warn(`Ingest batch exceeded max retries (${MAX_RETRIES}), moving to DLQ`, {
            requestId: entry.requestId,
            shopDomain: entry.shopDomain
          });
          entry.retryCount = currentRetry + 1;
          entry.processingStartedAt = undefined;
          await redis.lPush(DLQ_KEY, JSON.stringify(entry));
          await redis.lRem(PROCESSING_KEY, 1, processingMarker);
          await removeProcessingEntryById(redis, processingMarker);
        } else {
          entry.retryCount = currentRetry + 1;
          entry.enqueuedAt = Date.now();
          entry.processingStartedAt = undefined;
          const queue = resolveQueueForEntry(entry);
          entry.queueType = queue.queueType;
          await redis.lPush(queue.key, JSON.stringify(entry));
          await redis.lRem(PROCESSING_KEY, 1, processingMarker);
          await removeProcessingEntryById(redis, processingMarker);
        }
      } catch (queueError) {
        logger.error("Failed to handle failed ingest batch (DLQ/Retry)", {
          requestId: entry.requestId,
          error: queueError instanceof Error ? queueError.message : String(queueError)
        });
      }
      
      errors++;
    }
  }

  return { processed, errors };
}

async function rollbackReceiptsForFailedBatch(
  shopId: string,
  processedEvents: Array<{
    eventId: string | null;
    payload: { eventName: string };
    platformsToRecord: Array<{ platform: string }>;
  }>
): Promise<void> {
  const receiptFilters: Array<{ eventId: string; eventType: string; platform: string }> = [];
  for (const event of processedEvents) {
    if (!event.eventId) continue;
    const eventType =
      event.payload.eventName === "checkout_completed" ? "purchase" : event.payload.eventName;
    for (const { platform } of event.platformsToRecord) {
      if (!platform) continue;
      receiptFilters.push({
        eventId: event.eventId,
        eventType,
        platform,
      });
    }
  }
  if (receiptFilters.length === 0) return;

  try {
    await prisma.pixelEventReceipt.deleteMany({
      where: {
        shopId,
        OR: receiptFilters,
      },
    });
  } catch (error) {
    logger.warn("Failed to rollback receipts after ingest persistence failure", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recoverStuckProcessingItems(limit = 100, maxAgeMs = 15 * 60 * 1000): Promise<number> {
  const redis = await getRedisClient();
  let recovered = 0;

  while (recovered < limit) {
    const lastItem = await redis.lIndex(PROCESSING_KEY, -1);
    if (!lastItem) break;
    if (lastItem.startsWith("{")) {
      let shouldRecover = false;
      try {
        const entry = JSON.parse(lastItem) as IngestQueueEntry;
        const startedAt = entry.processingStartedAt ?? entry.enqueuedAt;
        if (startedAt && (Date.now() - startedAt > maxAgeMs)) {
          shouldRecover = true;
        } else if (!startedAt) {
          shouldRecover = true;
        }
      } catch {
        shouldRecover = true;
      }

      if (shouldRecover) {
        const moved = await redis.rPopLPush(PROCESSING_KEY, GENERAL_QUEUE_KEY);
        if (moved) {
          recovered++;
          logger.warn("Recovered stuck ingest item", { from: PROCESSING_KEY, to: GENERAL_QUEUE_KEY, format: "legacy" });
          continue;
        }
      }
      break;
    }

    const requestId = lastItem;
    const processingRaw = await getProcessingEntryById(redis, requestId);
    if (!processingRaw) {
      await redis.lRem(PROCESSING_KEY, 1, requestId);
      logger.warn("Removed orphan processing marker", { requestId });
      continue;
    }

    let shouldRecover = false;
    let recoveredEntry: IngestQueueEntry | null = null;
    try {
      const entry = JSON.parse(processingRaw) as IngestQueueEntry;
      recoveredEntry = entry;
      const startedAt = entry.processingStartedAt ?? entry.enqueuedAt;
      if (startedAt && (Date.now() - startedAt > maxAgeMs)) {
        shouldRecover = true;
      } else if (!startedAt) {
        shouldRecover = true;
      }
    } catch {
      shouldRecover = true;
    }

    if (!shouldRecover) {
      break;
    }

    const queue = resolveQueueForEntry(
      recoveredEntry ?? {
        requestId,
        shopId: "",
        shopDomain: "",
        environment: "live",
        mode: "purchase_only",
        validatedEvents: [],
        keyValidation: { matched: false, reason: "unknown", trustLevel: "untrusted" },
        origin: null,
      }
    );
    await redis.lPush(queue.key, processingRaw);
    await redis.lRem(PROCESSING_KEY, 1, requestId);
    await removeProcessingEntryById(redis, requestId);
    recovered++;
    logger.warn("Recovered stuck ingest item", { from: PROCESSING_KEY, to: queue.key, requestId, format: "hash" });
  }
  return recovered;
}
