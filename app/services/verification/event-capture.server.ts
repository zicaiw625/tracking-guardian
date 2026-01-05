

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
    // P0: 使用 EventLog + DeliveryAttempt 作为数据源
    const eventLogs = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: since,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? {
              DeliveryAttempt: {
                some: {
                  destinationType: { in: destinationTypes },
                },
              },
            }
          : {}),
      },
      include: {
        DeliveryAttempt: {
          where: destinationTypes && destinationTypes.length > 0
            ? { destinationType: { in: destinationTypes } }
            : undefined,
          select: {
            id: true,
            destinationType: true,
            status: true,
            errorCode: true,
            errorDetail: true,
            requestPayloadJson: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    const capturedEvents: CapturedEvent[] = [];
    
    for (const eventLog of eventLogs) {
      const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
      const value = (normalizedEvent?.value as number) || 0;
      const currency = (normalizedEvent?.currency as string) || "USD";
      const items = (normalizedEvent?.items as Array<Record<string, unknown>>) || [];
      
      // 为每个 DeliveryAttempt 创建一个 CapturedEvent
      for (const attempt of eventLog.DeliveryAttempt) {
        const payload = (attempt.requestPayloadJson as Record<string, unknown>) || {};
        const data = {
          value,
          currency,
          items,
        };

        const hasValue = value > 0;
        const hasCurrency = Boolean(currency);
        const hasItems = Array.isArray(items) && items.length > 0;

        const completenessRate =
          ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;

        capturedEvents.push({
          id: `${eventLog.id}-${attempt.id}`,
          eventName: eventLog.eventName,
          eventId: eventLog.eventId,
          destinationType: attempt.destinationType,
          payload: { ...payload, data },
          status: attempt.status === "ok" ? "ok" : "fail",
          errorCode: attempt.errorCode || null,
          errorDetail: attempt.errorDetail || null,
          eventTimestamp: eventLog.occurredAt,
          createdAt: attempt.createdAt,
          parameterCompleteness: {
            hasValue,
            hasCurrency,
            hasItems,
            completenessRate: Math.round(completenessRate * 100),
          },
        });
      }
      
      // 如果没有 DeliveryAttempt，仍然创建一个事件记录
      if (eventLog.DeliveryAttempt.length === 0) {
        const hasValue = value > 0;
        const hasCurrency = Boolean(currency);
        const hasItems = Array.isArray(items) && items.length > 0;

        const completenessRate =
          ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;

        capturedEvents.push({
          id: eventLog.id,
          eventName: eventLog.eventName,
          eventId: eventLog.eventId,
          destinationType: eventLog.source || null,
          payload: { data: { value, currency, items } },
          status: "pending",
          errorCode: null,
          errorDetail: null,
          eventTimestamp: eventLog.occurredAt,
          createdAt: eventLog.createdAt,
          parameterCompleteness: {
            hasValue,
            hasCurrency,
            hasItems,
            completenessRate: Math.round(completenessRate * 100),
          },
        });
      }
    }

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
    // P0: 使用 EventLog + DeliveryAttempt 作为数据源
    const eventLogs = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? {
              DeliveryAttempt: {
                some: {
                  destinationType: { in: destinationTypes },
                },
              },
            }
          : {}),
      },
      include: {
        DeliveryAttempt: {
          where: destinationTypes && destinationTypes.length > 0
            ? { destinationType: { in: destinationTypes } }
            : undefined,
          select: {
            destinationType: true,
            status: true,
            requestPayloadJson: true,
          },
        },
      },
    });

    const byEventType: Record<string, number> = {};
    const byDestination: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCompleteness = 0;
    let eventsWithAllParams = 0;
    let eventsWithMissingParams = 0;
    let totalEvents = 0;

    for (const eventLog of eventLogs) {
      const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
      const value = (normalizedEvent?.value as number) || 0;
      const currency = (normalizedEvent?.currency as string) || "USD";
      const items = (normalizedEvent?.items as Array<Record<string, unknown>>) || [];
      
      const eventType = eventLog.eventName;
      byEventType[eventType] = (byEventType[eventType] || 0) + 1;

      // 为每个 DeliveryAttempt 统计
      for (const attempt of eventLog.DeliveryAttempt) {
        totalEvents++;
        const dest = attempt.destinationType;
        byDestination[dest] = (byDestination[dest] || 0) + 1;

        const status = attempt.status === "ok" ? "ok" : "fail";
        byStatus[status] = (byStatus[status] || 0) + 1;
        
        const hasValue = value > 0;
        const hasCurrency = Boolean(currency);
        const hasItems = Array.isArray(items) && items.length > 0;
        const completenessRate = ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;
        
        totalCompleteness += completenessRate;
        if (completenessRate === 1) {
          eventsWithAllParams++;
        } else {
          eventsWithMissingParams++;
        }

        const payload = (attempt.requestPayloadJson as Record<string, unknown>) || {};
        const data = { value, currency, items };
        const completeness = checkParameterCompleteness({ ...payload, data });
        totalCompleteness += completeness.completenessRate / 100;

        if (completeness.completenessRate === 100) {
          eventsWithAllParams++;
        } else {
          eventsWithMissingParams++;
        }
      }
      
      // 如果没有 DeliveryAttempt，仍然统计事件本身
      if (eventLog.DeliveryAttempt.length === 0) {
        totalEvents++;
        const dest = eventLog.source || "unknown";
        byDestination[dest] = (byDestination[dest] || 0) + 1;
        byStatus["pending"] = (byStatus["pending"] || 0) + 1;
        
        const hasValue = value > 0;
        const hasCurrency = Boolean(currency);
        const hasItems = Array.isArray(items) && items.length > 0;
        const completenessRate = ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;
        
        totalCompleteness += completenessRate;
        if (completenessRate === 1) {
          eventsWithAllParams++;
        } else {
          eventsWithMissingParams++;
        }
      }
    }

    const avgCompleteness =
      totalEvents > 0 ? totalCompleteness / totalEvents : 0;

    return {
      total: totalEvents,
      byEventType,
      byDestination,
      byStatus,
      completenessStats: {
        avgCompleteness: Math.round(avgCompleteness * 100),
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

