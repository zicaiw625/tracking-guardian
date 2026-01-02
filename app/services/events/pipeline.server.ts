

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

export interface EventPipelineResult {
  success: boolean;
  eventId?: string;
  destinations?: string[];
  errors?: string[];
  deduplicated?: boolean;
}

export interface EventValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEventPayload(
  payload: PixelEventPayload
): EventValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload.eventName) {
    errors.push("eventName is required");
  }

  if (!payload.timestamp) {
    errors.push("timestamp is required");
  }

  if (!payload.shopDomain) {
    errors.push("shopDomain is required");
  }

  if (payload.data) {
    const data = payload.data;

    if (payload.eventName === "checkout_completed" || payload.eventName === "purchase") {
      if (!data.value && data.value !== 0) {
        errors.push("value is required for purchase events");
      }

      if (!data.currency) {
        errors.push("currency is required for purchase events");
      }

      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        warnings.push("items array is empty or missing");
      }
    }

    if (data.items && Array.isArray(data.items)) {
      data.items.forEach((item: unknown, index: number) => {
        if (typeof item !== "object" || item === null) {
          errors.push(`items[${index}] must be an object`);
          return;
        }

        const itemObj = item as Record<string, unknown>;
        if (!itemObj.product_id && !itemObj.variant_id) {
          warnings.push(`items[${index}] missing product_id or variant_id`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function checkEventDeduplication(
  shopId: string,
  eventId: string | null,
  eventName: string,
  destinationType?: string
): Promise<{ isDuplicate: boolean; existingEventId?: string }> {
  if (!eventId) {
    return { isDuplicate: false };
  }

  try {
    const existing = await prisma.eventLog.findFirst({
      where: {
        shopId,
        eventId,
        eventName,
        ...(destinationType ? { destinationType } : {}),
      },
      select: {
        id: true,
        eventId: true,
      },
    });

    if (existing) {
      return {
        isDuplicate: true,
        existingEventId: existing.eventId || undefined,
      };
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error("Failed to check event deduplication", {
      shopId,
      eventId,
      error,
    });

    return { isDuplicate: false };
  }
}

export async function logEvent(
  shopId: string,
  eventName: string,
  eventId: string | null,
  payload: PixelEventPayload,
  destinationType: string | null,
  status: "ok" | "fail",
  errorCode?: string,
  errorDetail?: string
): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        shopId,
        eventName,
        eventId: eventId || null,
        payloadJson: payload as unknown as object,
        destinationType: destinationType || null,
        status,
        errorCode: errorCode || null,
        errorDetail: errorDetail || null,
        eventTimestamp: new Date(payload.timestamp),
      },
    });
  } catch (error) {
    logger.error("Failed to log event", {
      shopId,
      eventName,
      eventId,
      error,
    });

  }
}

export async function processEventPipeline(
  shopId: string,
  payload: PixelEventPayload,
  eventId: string | null,
  destinations: string[]
): Promise<EventPipelineResult> {

  const validation = validateEventPayload(payload);
  if (!validation.valid) {
    await logEvent(
      shopId,
      payload.eventName,
      eventId,
      payload,
      null,
      "fail",
      "validation_failed",
      validation.errors.join("; ")
    );

    return {
      success: false,
      errors: validation.errors,
    };
  }

  const deduplicationResults: boolean[] = [];
  for (const destination of destinations) {
    const dedupResult = await checkEventDeduplication(
      shopId,
      eventId,
      payload.eventName,
      destination
    );

    if (dedupResult.isDuplicate) {
      logger.info("Event deduplicated", {
        shopId,
        eventId,
        destination,
        existingEventId: dedupResult.existingEventId,
      });
      deduplicationResults.push(true);
    } else {
      deduplicationResults.push(false);
    }
  }

  const isDeduplicated = deduplicationResults.some((dup) => dup);

  const logPromises = destinations.map((destination) =>
    logEvent(
      shopId,
      payload.eventName,
      eventId,
      payload,
      destination,
      isDeduplicated ? "ok" : "ok",
      isDeduplicated ? "deduplicated" : undefined,
      isDeduplicated ? "Event was deduplicated" : undefined
    )
  );

  await Promise.allSettled(logPromises);

  return {
    success: true,
    eventId: eventId || undefined,
    destinations,
    deduplicated: isDeduplicated,
  };
}

export async function processBatchEvents(
  shopId: string,
  events: Array<{
    payload: PixelEventPayload;
    eventId: string | null;
    destinations: string[];
  }>
): Promise<EventPipelineResult[]> {
  const results: EventPipelineResult[] = [];

  for (const event of events) {
    const result = await processEventPipeline(
      shopId,
      event.payload,
      event.eventId,
      event.destinations
    );
    results.push(result);
  }

  return results;
}

export async function getEventStats(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  total: number;
  success: number;
  failed: number;
  deduplicated: number;
  byDestination: Record<string, { total: number; success: number; failed: number }>;
}> {
  const events = await prisma.eventLog.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      status: true,
      destinationType: true,
      errorCode: true,
    },
  });

  const stats = {
    total: events.length,
    success: 0,
    failed: 0,
    deduplicated: 0,
    byDestination: {} as Record<string, { total: number; success: number; failed: number }>,
  };

  for (const event of events) {
    if (event.status === "ok") {
      stats.success++;
      if (event.errorCode === "deduplicated") {
        stats.deduplicated++;
      }
    } else {
      stats.failed++;
    }

    const dest = event.destinationType || "unknown";
    if (!stats.byDestination[dest]) {
      stats.byDestination[dest] = { total: 0, success: 0, failed: 0 };
    }

    stats.byDestination[dest].total++;
    if (event.status === "ok") {
      stats.byDestination[dest].success++;
    } else {
      stats.byDestination[dest].failed++;
    }
  }

  return stats;
}

