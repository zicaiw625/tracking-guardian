

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
    const events = await prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: since,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? { platform: { in: destinationTypes } }
          : {}),
      },
      select: {
        id: true,
        orderId: true,
        orderValue: true,
        currency: true,
        platform: true,
        eventType: true,
        status: true,
        errorMessage: true,
        platformResponse: true,
        createdAt: true,
        eventId: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    const capturedEvents: CapturedEvent[] = events.map((event) => {
      const orderValue = typeof event.orderValue === 'object' && 'toNumber' in event.orderValue 
        ? event.orderValue.toNumber() 
        : typeof event.orderValue === 'number' 
        ? event.orderValue 
        : 0;
      
      const payload = (event.platformResponse as Record<string, unknown>) || {};
      const data = {
        value: orderValue,
        currency: event.currency || "USD",
        items: [],
      };

      const hasValue = orderValue > 0;
      const hasCurrency = Boolean(event.currency);
      const hasItems = false; // ConversionLog doesn't have items

      const completenessRate =
        ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;

      return {
        id: event.id,
        eventName: event.eventType || "checkout_completed",
        eventId: event.eventId || event.orderId,
        destinationType: event.platform || null,
        payload: { ...payload, data },
        status: event.status === "sent" || event.status === "ok" ? "ok" : "fail",
        errorCode: event.errorMessage ? "conversion_failed" : null,
        errorDetail: event.errorMessage || null,
        eventTimestamp: event.createdAt,
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
  const hasItems = Array.isArray(data.items) && data.items.length > 0;

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
    const events = await prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? { platform: { in: destinationTypes } }
          : {}),
      },
      select: {
        eventType: true,
        platform: true,
        status: true,
        orderValue: true,
        currency: true,
        platformResponse: true,
      },
    });

    const byEventType: Record<string, number> = {};
    const byDestination: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCompleteness = 0;
    let eventsWithAllParams = 0;
    let eventsWithMissingParams = 0;

    for (const event of events) {
      const eventType = event.eventType || "checkout_completed";
      byEventType[eventType] = (byEventType[eventType] || 0) + 1;

      const dest = event.platform || "unknown";
      byDestination[dest] = (byDestination[dest] || 0) + 1;

      const status = event.status === "sent" || event.status === "ok" ? "ok" : "fail";
      byStatus[status] = (byStatus[status] || 0) + 1;
      
      const hasValue = (typeof event.orderValue === 'object' && 'toNumber' in event.orderValue 
        ? event.orderValue.toNumber() 
        : typeof event.orderValue === 'number' 
        ? event.orderValue 
        : 0) > 0;
      const hasCurrency = Boolean(event.currency);
      const completenessRate = ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0)) / 2;
      
      totalCompleteness += completenessRate;
      if (completenessRate === 1) {
        eventsWithAllParams++;
      } else {
        eventsWithMissingParams++;
      }

      const payload = (event.platformResponse as Record<string, unknown>) || {};
      const completeness = checkParameterCompleteness(payload);
      totalCompleteness += completeness.completenessRate / 100;

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

