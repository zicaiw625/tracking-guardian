

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export interface CapturedEvent {
  id: string;
  eventName: string;
  eventId: string | null;
  destinationType: string | null;
  payload: Record<string, unknown>;
  status: "ok" | "fail";
  errorCode: string | null;
  errorDetail: string | null;
  eventTimestamp: Date;
  createdAt: Date;
  parameterCompleteness: {
    hasValue: boolean;
    hasCurrency: boolean;
    hasItems: boolean;
    completenessRate: number;
  };
}

export interface EventCaptureResult {
  events: CapturedEvent[];
  total: number;
  success: number;
  failed: number;
  completenessRate: number;
}

export async function captureRecentEvents(
  shopId: string,
  since: Date = new Date(Date.now() - 5 * 60 * 1000),
  destinationTypes?: string[]
): Promise<EventCaptureResult> {
  try {
    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: since,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? { destinationType: { in: destinationTypes } }
          : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    const capturedEvents: CapturedEvent[] = events.map((event: { payloadJson: unknown; eventId: string | null; destinationType: string | null }) => {
      const payload = (event.payloadJson as Record<string, unknown>) || {};
      const data = (payload.data as Record<string, unknown>) || {};

      const hasValue = data.value !== undefined && data.value !== null;
      const hasCurrency = Boolean(data.currency);
      const hasItems =
        Array.isArray(data.items) && (data.items as unknown[]).length > 0;

      const completenessRate =
        ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;

      return {
        id: event.id,
        eventName: event.eventName,
        eventId: event.eventId || null,
        destinationType: event.destinationType || null,
        payload,
        status: event.status as "ok" | "fail",
        errorCode: event.errorCode || null,
        errorDetail: event.errorDetail || null,
        eventTimestamp: event.eventTimestamp,
        createdAt: event.createdAt,
        parameterCompleteness: {
          hasValue,
          hasCurrency,
          hasItems,
          completenessRate: Math.round(completenessRate * 100),
        },
      };
    });

    const success = capturedEvents.filter((e) => e.status === "ok").length;
    const failed = capturedEvents.filter((e) => e.status === "fail").length;

    const avgCompleteness =
      capturedEvents.length > 0
        ? capturedEvents.reduce(
            (sum, e) => sum + e.parameterCompleteness.completenessRate,
            0
          ) / capturedEvents.length
        : 0;

    return {
      events: capturedEvents,
      total: capturedEvents.length,
      success,
      failed,
      completenessRate: Math.round(avgCompleteness),
    };
  } catch (error) {
    logger.error("Failed to capture recent events", {
      shopId,
      error,
    });
    throw error;
  }
}

export function checkParameterCompleteness(
  payload: Record<string, unknown>
): {
  hasValue: boolean;
  hasCurrency: boolean;
  hasItems: boolean;
  missingParameters: string[];
  completenessRate: number;
} {
  const data = (payload.data as Record<string, unknown>) || {};

  const hasValue = data.value !== undefined && data.value !== null;
  const hasCurrency = Boolean(data.currency);
  const hasItems =
    Array.isArray(data.items) && (data.items as unknown[]).length > 0;

  const missingParameters: string[] = [];
  if (!hasValue) missingParameters.push("value");
  if (!hasCurrency) missingParameters.push("currency");
  if (!hasItems) missingParameters.push("items");

  const completenessRate =
    ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;

  return {
    hasValue,
    hasCurrency,
    hasItems,
    missingParameters,
    completenessRate: Math.round(completenessRate * 100),
  };
}

export async function getEventStatistics(
  shopId: string,
  startDate: Date,
  endDate: Date,
  destinationTypes?: string[]
): Promise<{
  total: number;
  byEventType: Record<string, number>;
  byDestination: Record<string, number>;
  byStatus: Record<string, number>;
  completenessStats: {
    avgCompleteness: number;
    eventsWithAllParams: number;
    eventsWithMissingParams: number;
  };
}> {
  try {
    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? { destinationType: { in: destinationTypes } }
          : {}),
      },
    });

    const byEventType: Record<string, number> = {};
    const byDestination: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCompleteness = 0;
    let eventsWithAllParams = 0;
    let eventsWithMissingParams = 0;

    for (const event of events) {

      byEventType[event.eventName] = (byEventType[event.eventName] || 0) + 1;

      const dest = event.destinationType || "unknown";
      byDestination[dest] = (byDestination[dest] || 0) + 1;

      byStatus[event.status] = (byStatus[event.status] || 0) + 1;

      const payload = (event.payloadJson as Record<string, unknown>) || {};
      const completeness = checkParameterCompleteness(payload);
      totalCompleteness += completeness.completenessRate;

      if (completeness.completenessRate === 100) {
        eventsWithAllParams++;
      } else {
        eventsWithMissingParams++;
      }
    }

    const avgCompleteness =
      events.length > 0 ? totalCompleteness / events.length : 0;

    return {
      total: events.length,
      byEventType,
      byDestination,
      byStatus,
      completenessStats: {
        avgCompleteness: Math.round(avgCompleteness),
        eventsWithAllParams,
        eventsWithMissingParams,
      },
    };
  } catch (error) {
    logger.error("Failed to get event statistics", {
      shopId,
      error,
    });
    throw error;
  }
}

