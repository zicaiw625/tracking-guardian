

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";
import { sendPixelEventToPlatform } from "./pixel-event-sender.server";

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

    // purchase 事件必须包含 value、currency 和 items
    if (payload.eventName === "checkout_completed" || payload.eventName === "purchase") {
      if (!data.value && data.value !== 0) {
        errors.push("value is required for purchase events");
      }

      if (!data.currency) {
        errors.push("currency is required for purchase events");
      }

      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        warnings.push("items array is empty or missing for purchase event");
      }
    } else {
      // 非 purchase 事件：value/currency/items 为可选，但建议包含以保持一致性
      // page_viewed 事件允许 value 为 0 或缺失
      if (payload.eventName !== "page_viewed") {
        if (data.value === undefined && data.value !== null) {
          warnings.push(`value is recommended for ${payload.eventName} events`);
        }
        if (!data.currency) {
          warnings.push(`currency is recommended for ${payload.eventName} events`);
        }
      }
    }

    // 验证 items 数组结构（如果存在）
    if (data.items && Array.isArray(data.items)) {
      if (data.items.length === 0 && payload.eventName !== "page_viewed") {
        warnings.push(`items array is empty for ${payload.eventName} event`);
      }
      
      data.items.forEach((item: unknown, index: number) => {
        if (typeof item !== "object" || item === null) {
          errors.push(`items[${index}] must be an object`);
          return;
        }

        const itemObj = item as Record<string, unknown>;
        // 检查是否有 id、productId 或 variantId（至少需要一个）
        if (!itemObj.id && !itemObj.productId && !itemObj.variantId && !itemObj.product_id && !itemObj.variant_id) {
          warnings.push(`items[${index}] missing id, productId, or variantId`);
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

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
    // 验证 payload 是有效的对象
    if (!isObject(payload)) {
      logger.error("Invalid payload type", { shopId, eventName, payloadType: typeof payload });
      throw new Error("Payload must be an object");
    }

    await prisma.eventLog.create({
      data: {
        shopId,
        eventName,
        eventId: eventId || null,
        payloadJson: payload,
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

  // 生成 eventId（如果缺失，为非 purchase 事件生成一个临时 ID）
  let finalEventId = eventId;
  if (!finalEventId) {
    // 对于非 purchase 事件，如果没有 eventId，生成一个基于 payload 的临时 ID
    const crypto = require("crypto");
    const identifier = payload.data?.checkoutToken || 
                      payload.data?.orderId || 
                      `${payload.shopDomain}:${payload.timestamp}:${payload.nonce || Math.random()}`;
    const input = `${payload.shopDomain}:${identifier}:${payload.eventName}:${payload.timestamp}`;
    finalEventId = crypto
      .createHash("sha256")
      .update(input, "utf8")
      .digest("hex")
      .substring(0, 32);
    logger.debug(`Generated temporary eventId for ${payload.eventName}`, {
      shopId,
      eventName: payload.eventName,
      eventId: finalEventId,
    });
  }

  // 如果不是重复事件，则发送到各个平台
  if (!isDeduplicated) {
    logger.info(`Sending ${payload.eventName} event to ${destinations.length} destination(s)`, {
      shopId,
      eventId: finalEventId,
      eventName: payload.eventName,
      destinations,
    });

    const sendPromises = destinations.map(async (destination) => {
      try {
        logger.debug(`Sending ${payload.eventName} to ${destination}`, {
          shopId,
          eventId,
          eventName: payload.eventName,
          platform: destination,
        });

        const sendResult = await sendPixelEventToPlatform(
          shopId,
          destination,
          payload,
          finalEventId
        );

        await logEvent(
          shopId,
          payload.eventName,
          finalEventId,
          payload,
          destination,
          sendResult.success ? "ok" : "fail",
          sendResult.success ? undefined : "send_failed",
          sendResult.error
        );

        if (sendResult.success) {
          logger.info(`Successfully sent ${payload.eventName} to ${destination}`, {
            shopId,
            eventId: finalEventId,
            eventName: payload.eventName,
            platform: destination,
          });
        } else {
          logger.warn(`Failed to send ${payload.eventName} to ${destination}`, {
            shopId,
            eventName: payload.eventName,
            eventId: finalEventId,
            platform: destination,
            error: sendResult.error,
          });
        }

        return sendResult;
      } catch (error) {
        logger.error(`Error sending ${payload.eventName} to ${destination}`, {
          shopId,
          eventName: payload.eventName,
          eventId,
          platform: destination,
          error: error instanceof Error ? error.message : String(error),
        });

        await logEvent(
          shopId,
          payload.eventName,
          finalEventId,
          payload,
          destination,
          "fail",
          "send_error",
          error instanceof Error ? error.message : String(error)
        );

        return {
          success: false,
          platform: destination,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.allSettled(sendPromises);
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    
    logger.info(`Event ${payload.eventName} routing completed`, {
      shopId,
      eventId: finalEventId,
      eventName: payload.eventName,
      totalDestinations: destinations.length,
      successful: successCount,
      failed: destinations.length - successCount,
    });
  } else {
    // 如果是重复事件，只记录日志
    const logPromises = destinations.map((destination) =>
      logEvent(
        shopId,
        payload.eventName,
        finalEventId,
        payload,
        destination,
        "ok",
        "deduplicated",
        "Event was deduplicated"
      )
    );

    await Promise.allSettled(logPromises);
  }

  return {
    success: true,
    eventId: finalEventId || undefined,
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

