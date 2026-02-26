import { getRedisClient } from "~/utils/redis-client.server";
import { logger, metrics } from "~/utils/logger.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";

const QUEUE_KEY = "ingest:queue";
const PROCESSING_KEY = "ingest:processing";
const DLQ_KEY = "ingest:dlq";
const MAX_QUEUE_SIZE = 100_000;
const MAX_BATCHES_PER_RUN = 50;
const MAX_RETRIES = 5;

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

export async function enqueueIngestBatch(entry: IngestQueueEntry): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    entry.enqueuedAt = Date.now();
    const serialized = JSON.stringify(entry);
    
    const newLength = await redis.lPush(QUEUE_KEY, serialized);
    await redis.lTrim(QUEUE_KEY, 0, MAX_QUEUE_SIZE - 1);
    const dropped = Math.max(0, newLength - MAX_QUEUE_SIZE);
    if (dropped > 0) {
      logger.warn("Ingest queue trimmed - events dropped", {
        queueLengthBeforeTrim: newLength,
        dropped,
        maxQueueSize: MAX_QUEUE_SIZE,
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
      });
      metrics.silentDrop({
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        reason: "ingest_queue_overflow",
        category: "rate_limit",
        sampleRate: 1,
      });
    }
    
    return true;
  } catch (e) {
    logger.error("Failed to enqueue ingest batch", {
      requestId: entry.requestId,
      shopDomain: entry.shopDomain,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
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
    const raw = await redis.rPopLPush(QUEUE_KEY, PROCESSING_KEY);
    if (!raw) break;

    let entry: IngestQueueEntry;
    try {
      entry = JSON.parse(raw) as IngestQueueEntry;
    } catch (e) {
      logger.warn("Invalid ingest queue entry JSON", {
        error: e instanceof Error ? e.message : String(e),
      });
      // Invalid JSON, remove from processing queue as it can't be processed
      await redis.lRem(PROCESSING_KEY, 1, raw);
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
        // If persistence fails, we might want to retry. 
        // For now, we throw so it stays in processing queue (or we could rely on this catch to NOT acknowledge).
        throw e; 
      }
      
      // Success - remove from processing queue (ACK)
      await redis.lRem(PROCESSING_KEY, 1, raw);
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
          await redis.lPush(DLQ_KEY, JSON.stringify(entry));
          await redis.lRem(PROCESSING_KEY, 1, raw);
        } else {
          // Re-queue with incremented retry count
          // Push to Head of Queue (will be processed last, acting as backoff)
          entry.retryCount = currentRetry + 1;
          entry.enqueuedAt = Date.now(); // Update timestamp to prevent immediate stuck recovery
          await redis.lPush(QUEUE_KEY, JSON.stringify(entry));
          await redis.lRem(PROCESSING_KEY, 1, raw);
        }
      } catch (queueError) {
        logger.error("Failed to handle failed ingest batch (DLQ/Retry)", {
          requestId: entry.requestId,
          error: queueError instanceof Error ? queueError.message : String(queueError)
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
    const lastItem = await redis.lIndex(PROCESSING_KEY, -1);
    if (!lastItem) break;
    
    let shouldRecover = false;
    try {
      const entry = JSON.parse(lastItem) as IngestQueueEntry;
      if (entry.enqueuedAt && (Date.now() - entry.enqueuedAt > maxAgeMs)) {
        shouldRecover = true;
      } else if (!entry.enqueuedAt) {
        // Legacy item without timestamp, treat as stuck if it's at the tail
        shouldRecover = true;
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
