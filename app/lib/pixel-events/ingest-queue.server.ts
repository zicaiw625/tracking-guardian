import { getRedisClient } from "~/utils/redis-client.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload, KeyValidationResult } from "./types";

const QUEUE_KEY = "ingest:queue";
const MAX_QUEUE_SIZE = 100_000;
const MAX_BATCHES_PER_RUN = 50;

export interface IngestQueueEntry {
  requestId: string;
  shopId: string;
  shopDomain: string;
  environment: "test" | "live";
  mode: "purchase_only" | "full_funnel";
  validatedEvents: Array<{ payload: PixelEventPayload; index: number }>;
  keyValidation: KeyValidationResult;
  origin: string | null;
  serverSideConfigs: Array<{
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
    const len = await redis.lPush(QUEUE_KEY, serialized);
    if (len > MAX_QUEUE_SIZE) {
      logger.warn("Ingest queue exceeds max size, consider scaling worker", {
        queueKey: QUEUE_KEY,
        length: len,
        maxSize: MAX_QUEUE_SIZE,
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
  const { processBatchEvents } = await import("~/services/events/pipeline.server");
  const { API_CONFIG } = await import("~/utils/config.server");
  const redis = await getRedisClient();
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < maxBatches; i++) {
    const raw = await redis.rPop(QUEUE_KEY);
    if (!raw) break;

    let entry: IngestQueueEntry;
    try {
      entry = JSON.parse(raw) as IngestQueueEntry;
    } catch (e) {
      logger.warn("Invalid ingest queue entry JSON", {
        error: e instanceof Error ? e.message : String(e),
      });
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
      const configs = entry.serverSideConfigs.map((c) => ({
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

      const forPipeline = processedEvents.map((e) => ({
        payload: e.payload,
        eventId: e.eventId,
        destinations: e.destinations,
      }));

      if (forPipeline.length === 0) {
        processed++;
        continue;
      }

      const results = await processBatchEvents(
        entry.shopId,
        forPipeline,
        entry.environment,
        { persistOnly: true }
      );
      const ok = results.filter((r) => r.success).length;
      if (ok < forPipeline.length) {
        logger.error("Worker failed to persist some ingest events", {
          shopDomain: entry.shopDomain,
          shopId: entry.shopId,
          total: forPipeline.length,
          persisted: ok,
        });
        errors++;
      }
      processed++;
    } catch (e) {
      logger.error("Ingest worker batch failed", {
        requestId: entry.requestId,
        shopDomain: entry.shopDomain,
        shopId: entry.shopId,
        error: e instanceof Error ? e.message : String(e),
      });
      errors++;
    }
  }

  return { processed, errors };
}
