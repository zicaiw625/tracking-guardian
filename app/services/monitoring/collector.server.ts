

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export interface EventMetrics {
  total: number;
  success: number;
  failed: number;
  successRate: number;
  byDestination: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
  }>;
  byEventType: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
  }>;
}

export interface MissingParamsMetrics {
  missingValue: number;
  missingCurrency: number;
  missingItems: number;
  total: number;
  missingRate: {
    value: number;
    currency: number;
    items: number;
  };
}

export interface DeduplicationMetrics {
  total: number;
  duplicated: number;
  duplicationRate: number;
  byDestination: Record<string, {
    total: number;
    duplicated: number;
    duplicationRate: number;
  }>;
}

export async function collectEventSuccessRate(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<EventMetrics> {
  try {
    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        eventName: true,
        destinationType: true,
        status: true,
      },
    });

    const metrics: EventMetrics = {
      total: events.length,
      success: 0,
      failed: 0,
      successRate: 0,
      byDestination: {},
      byEventType: {},
    };

    for (const event of events) {
      if (event.status === "ok") {
        metrics.success++;
      } else {
        metrics.failed++;
      }

      const dest = event.destinationType || "unknown";
      if (!metrics.byDestination[dest]) {
        metrics.byDestination[dest] = {
          total: 0,
          success: 0,
          failed: 0,
          successRate: 0,
        };
      }
      metrics.byDestination[dest].total++;
      if (event.status === "ok") {
        metrics.byDestination[dest].success++;
      } else {
        metrics.byDestination[dest].failed++;
      }

      const eventType = event.eventName;
      if (!metrics.byEventType[eventType]) {
        metrics.byEventType[eventType] = {
          total: 0,
          success: 0,
          failed: 0,
          successRate: 0,
        };
      }
      metrics.byEventType[eventType].total++;
      if (event.status === "ok") {
        metrics.byEventType[eventType].success++;
      } else {
        metrics.byEventType[eventType].failed++;
      }
    }

    if (metrics.total > 0) {
      metrics.successRate = (metrics.success / metrics.total) * 100;
    }

    for (const dest in metrics.byDestination) {
      const destMetrics = metrics.byDestination[dest];
      if (destMetrics.total > 0) {
        destMetrics.successRate = (destMetrics.success / destMetrics.total) * 100;
      }
    }

    for (const eventType in metrics.byEventType) {
      const typeMetrics = metrics.byEventType[eventType];
      if (typeMetrics.total > 0) {
        typeMetrics.successRate = (typeMetrics.success / typeMetrics.total) * 100;
      }
    }

    return metrics;
  } catch (error) {
    logger.error("Failed to collect event success rate metrics", {
      shopId,
      error,
    });
    throw error;
  }
}

export async function collectMissingParamsMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<MissingParamsMetrics> {
  try {
    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        eventName: {
          in: ["checkout_completed", "purchase"],
        },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        payloadJson: true,
        errorCode: true,
      },
    });

    const metrics: MissingParamsMetrics = {
      missingValue: 0,
      missingCurrency: 0,
      missingItems: 0,
      total: events.length,
      missingRate: {
        value: 0,
        currency: 0,
        items: 0,
      },
    };

    for (const event of events) {
      const payload = event.payloadJson as {
        data?: {
          value?: number;
          currency?: string;
          items?: unknown[];
        };
      };

      if (!payload.data) {
        metrics.missingValue++;
        metrics.missingCurrency++;
        metrics.missingItems++;
        continue;
      }

      const data = payload.data;

      if (data.value === undefined || data.value === null) {
        metrics.missingValue++;
      }

      if (!data.currency) {
        metrics.missingCurrency++;
      }

      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        metrics.missingItems++;
      }
    }

    if (metrics.total > 0) {
      metrics.missingRate.value = (metrics.missingValue / metrics.total) * 100;
      metrics.missingRate.currency = (metrics.missingCurrency / metrics.total) * 100;
      metrics.missingRate.items = (metrics.missingItems / metrics.total) * 100;
    }

    return metrics;
  } catch (error) {
    logger.error("Failed to collect missing params metrics", {
      shopId,
      error,
    });
    throw error;
  }
}

export async function collectDeduplicationMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<DeduplicationMetrics> {
  try {
    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        eventId: true,
        destinationType: true,
        errorCode: true,
      },
    });

    const metrics: DeduplicationMetrics = {
      total: events.length,
      duplicated: 0,
      duplicationRate: 0,
      byDestination: {},
    };

    for (const event of events) {
      if (event.errorCode === "deduplicated") {
        metrics.duplicated++;
      }

      const dest = event.destinationType || "unknown";
      if (!metrics.byDestination[dest]) {
        metrics.byDestination[dest] = {
          total: 0,
          duplicated: 0,
          duplicationRate: 0,
        };
      }
      metrics.byDestination[dest].total++;
      if (event.errorCode === "deduplicated") {
        metrics.byDestination[dest].duplicated++;
      }
    }

    if (metrics.total > 0) {
      metrics.duplicationRate = (metrics.duplicated / metrics.total) * 100;
    }

    for (const dest in metrics.byDestination) {
      const destMetrics = metrics.byDestination[dest];
      if (destMetrics.total > 0) {
        destMetrics.duplicationRate = (destMetrics.duplicated / destMetrics.total) * 100;
      }
    }

    return metrics;
  } catch (error) {
    logger.error("Failed to collect deduplication metrics", {
      shopId,
      error,
    });
    throw error;
  }
}

export async function collectEventVolumeAnomaly(
  shopId: string,
  currentPeriod: { start: Date; end: Date },
  previousPeriod: { start: Date; end: Date }
): Promise<{
  currentCount: number;
  previousCount: number;
  changeRate: number;
  isAnomaly: boolean;
}> {
  try {
    const [currentEvents, previousEvents] = await Promise.all([
      prisma.eventLog.count({
        where: {
          shopId,
          createdAt: {
            gte: currentPeriod.start,
            lte: currentPeriod.end,
          },
        },
      }),
      prisma.eventLog.count({
        where: {
          shopId,
          createdAt: {
            gte: previousPeriod.start,
            lte: previousPeriod.end,
          },
        },
      }),
    ]);

    const changeRate =
      previousEvents > 0
        ? ((currentEvents - previousEvents) / previousEvents) * 100
        : 0;

    const isAnomaly = changeRate < -50;

    return {
      currentCount: currentEvents,
      previousCount: previousEvents,
      changeRate,
      isAnomaly,
    };
  } catch (error) {
    logger.error("Failed to collect event volume anomaly", {
      shopId,
      error,
    });
    throw error;
  }
}

