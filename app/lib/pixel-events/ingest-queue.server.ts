import { getRedisClient } from "~/utils/redis-client.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";

const QUEUE_KEY = "ingest:queue";
const PROCESSING_KEY = "ingest:processing";
const MAX_QUEUE_SIZE = 100_000;
const MAX_BATCHES_PER_RUN = 50;

export interface IngestRequestContext {
  ip?: string | null;
  user_agent?: string | null;
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
    const serialized = JSON.stringify(entry);
    
    await redis.lPush(QUEUE_KEY, serialized);
    await redis.lTrim(QUEUE_KEY, 0, MAX_QUEUE_SIZE - 1);
    
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
        undefined
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
      logger.error("Ingest worker batch failed", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        shopId: entry.shopId,
        error: e instanceof Error ? e.message : String(e),
      });
      errors++;
      // We do NOT remove from PROCESSING_KEY here, so it can be recovered later
    }
  }

  return { processed, errors };
}
