import { jsonWithCors } from "../cors";
import { normalizeEvents, deduplicateEvents, distributeEvents } from "../ingest-pipeline.server";
import { processBatchEvents } from "~/services/events/pipeline.server";
import { logger } from "~/utils/logger.server";
import { API_CONFIG } from "~/utils/config.server";
import type { PixelEventPayload } from "../types";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const processingMiddleware: IngestMiddleware = async (
  context: IngestContext
): Promise<MiddlewareResult> => {
  if (!context.shop || !context.shopDomain) {
    return {
      continue: false,
      response: jsonWithCors(
        { error: "Invalid request" },
        { status: 500, request: context.request, requestId: context.requestId }
      ),
    };
  }

  const filteredValidatedEvents = context.validatedEvents.filter(ve => {
    if (ve.payload.shopDomain !== context.shopDomain) {
      logger.warn(`Event at index ${ve.index} has different shopDomain`, {
        expected: context.shopDomain,
        actual: ve.payload.shopDomain,
      });
      return false;
    }
    const now = Date.now();
    const eventTimeDiff = Math.abs(now - ve.payload.timestamp);
    if (eventTimeDiff > API_CONFIG.TIMESTAMP_WINDOW_MS) {
      logger.debug(`Event at index ${ve.index} timestamp outside window: diff=${eventTimeDiff}ms, skipping`, {
        shopDomain: context.shopDomain,
        eventTimestamp: ve.payload.timestamp,
        currentTime: now,
        windowMs: API_CONFIG.TIMESTAMP_WINDOW_MS,
      });
      return false;
    }
    return true;
  });

  const normalizedEvents = normalizeEvents(filteredValidatedEvents, context.shopDomain, context.mode);
  const deduplicatedEvents = await deduplicateEvents(normalizedEvents, context.shop.id, context.shopDomain);
  const processedEvents = await distributeEvents(
    deduplicatedEvents,
    context.shop.id,
    context.shopDomain,
    context.serverSideConfigs.map(config => ({
      platform: "",
      id: "",
      ...config,
    })),
    context.keyValidation,
    context.origin,
    undefined
  );

  const validatedEventsForPipeline: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }> = processedEvents.map(event => ({
    payload: event.payload,
    eventId: event.eventId,
    destinations: event.destinations,
  }));

  if (validatedEventsForPipeline.length === 0) {
    logger.debug(`All events filtered for ${context.shopDomain} (mode: ${context.mode}) - returning empty accepted_count`);
    return {
      continue: false,
      response: jsonWithCors(
        {
          accepted_count: 0,
          errors: [],
        },
        { request: context.request }
      ),
    };
  }

  const persistResults = await processBatchEvents(
    context.shop.id,
    validatedEventsForPipeline,
    context.environment,
    { persistOnly: true }
  );

  const persistedCount = persistResults.filter((r) => r.success).length;
  if (persistedCount < validatedEventsForPipeline.length) {
    logger.error("Failed to persist some ingest events", undefined, {
      shopDomain: context.shopDomain,
      shopId: context.shop.id,
      total: validatedEventsForPipeline.length,
      persisted: persistedCount,
    });
    return {
      continue: false,
      response: jsonWithCors(
        {
          error: "Failed to persist events",
          accepted_count: persistedCount,
          errors: ["persist_failed"],
        },
        { status: 500, request: context.request }
      ),
    };
  }

  return {
    continue: false,
    response: jsonWithCors(
      {
        accepted_count: persistedCount,
        errors: [],
      },
      { status: 202, request: context.request, requestId: context.requestId }
    ),
  };
};
