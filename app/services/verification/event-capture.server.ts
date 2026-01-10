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
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: {
          gte: since,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? {
              platform: { in: destinationTypes },
            }
          : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });
    const capturedEvents: CapturedEvent[] = [];
    for (const receipt of receipts) {
      if (!receipt.platform) continue;
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      let value = (data?.value as number) || 0;
      let currency = (data?.currency as string) || "USD";
      let items = (data?.items as Array<Record<string, unknown>>) || [];
      if (receipt.platform === "google") {
        const events = payload?.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          if (params?.value !== undefined) value = (params.value as number) || 0;
          if (params?.currency) currency = String(params.currency);
          if (Array.isArray(params?.items)) items = params.items as Array<Record<string, unknown>>;
        }
      } else if (receipt.platform === "meta" || receipt.platform === "facebook") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
          if (customData?.value !== undefined) value = (customData.value as number) || 0;
          if (customData?.currency) currency = String(customData.currency);
          if (Array.isArray(customData?.contents)) items = customData.contents as Array<Record<string, unknown>>;
        }
      } else if (receipt.platform === "tiktok") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const properties = eventsData[0].properties as Record<string, unknown> | undefined;
          if (properties?.value !== undefined) value = (properties.value as number) || 0;
          if (properties?.currency) currency = String(properties.currency);
          if (Array.isArray(properties?.contents)) items = properties.contents as Array<Record<string, unknown>>;
        }
      }
      const hasValue = value > 0;
      const hasCurrency = Boolean(currency);
      const hasItems = Array.isArray(items) && items.length > 0;
      const completenessRate =
        ((hasValue ? 1 : 0) + (hasCurrency ? 1 : 0) + (hasItems ? 1 : 0)) / 3;
      capturedEvents.push({
        id: receipt.id,
        eventName: receipt.eventType,
        eventId: receipt.id,
        destinationType: receipt.platform,
        payload: { ...(payload || {}), data: { value, currency, items } },
        status: hasValue && hasCurrency ? "ok" : "fail",
        errorCode: null,
        errorDetail: null,
        eventTimestamp: receipt.pixelTimestamp,
        createdAt: receipt.createdAt,
        parameterCompleteness: {
          hasValue,
          hasCurrency,
          hasItems,
          completenessRate: Math.round(completenessRate * 100),
        },
      });
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
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(destinationTypes && destinationTypes.length > 0
          ? {
              platform: { in: destinationTypes },
            }
          : {}),
      },
      select: {
        eventType: true,
        platform: true,
        payloadJson: true,
      },
    });
    const byEventType: Record<string, number> = {};
    const byDestination: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalCompleteness = 0;
    let eventsWithAllParams = 0;
    let eventsWithMissingParams = 0;
    let totalEvents = 0;
    for (const receipt of receipts) {
      if (!receipt.platform) continue;
      totalEvents++;
      const eventType = receipt.eventType;
      byEventType[eventType] = (byEventType[eventType] || 0) + 1;
      const dest = receipt.platform;
      byDestination[dest] = (byDestination[dest] || 0) + 1;
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      let value = (data?.value as number) || 0;
      let currency = (data?.currency as string) || "USD";
      let items = (data?.items as Array<Record<string, unknown>>) || [];
      if (receipt.platform === "google") {
        const events = payload?.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          if (params?.value !== undefined) value = (params.value as number) || 0;
          if (params?.currency) currency = String(params.currency);
          if (Array.isArray(params?.items)) items = params.items as Array<Record<string, unknown>>;
        }
      } else if (receipt.platform === "meta" || receipt.platform === "facebook") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
          if (customData?.value !== undefined) value = (customData.value as number) || 0;
          if (customData?.currency) currency = String(customData.currency);
          if (Array.isArray(customData?.contents)) items = customData.contents as Array<Record<string, unknown>>;
        }
      } else if (receipt.platform === "tiktok") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const properties = eventsData[0].properties as Record<string, unknown> | undefined;
          if (properties?.value !== undefined) value = (properties.value as number) || 0;
          if (properties?.currency) currency = String(properties.currency);
          if (Array.isArray(properties?.contents)) items = properties.contents as Array<Record<string, unknown>>;
        }
      }
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
      const status = hasValue && hasCurrency ? "ok" : "fail";
      byStatus[status] = (byStatus[status] || 0) + 1;
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
