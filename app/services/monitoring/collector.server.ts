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

    const attempts = await prisma.deliveryAttempt.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        destinationType: true,
        status: true,
        EventLog: {
          select: {
            eventName: true,
          },
        },
      },
      take: 10000,
    });

    const metrics: EventMetrics = {
      total: attempts.length,
      success: 0,
      failed: 0,
      successRate: 0,
      byDestination: {},
      byEventType: {},
    };

    for (const attempt of attempts) {
      if (attempt.status === "ok") {
        metrics.success++;
      } else if (attempt.status === "fail") {
        metrics.failed++;
      }

      const dest = attempt.destinationType || "unknown";
      if (!metrics.byDestination[dest]) {
        metrics.byDestination[dest] = {
          total: 0,
          success: 0,
          failed: 0,
          successRate: 0,
        };
      }
      metrics.byDestination[dest].total++;
      if (attempt.status === "ok") {
        metrics.byDestination[dest].success++;
      } else if (attempt.status === "fail") {
        metrics.byDestination[dest].failed++;
      }

      const eventType = attempt.EventLog.eventName || "unknown";
      if (!metrics.byEventType[eventType]) {
        metrics.byEventType[eventType] = {
          total: 0,
          success: 0,
          failed: 0,
          successRate: 0,
        };
      }
      metrics.byEventType[eventType].total++;
      if (attempt.status === "ok") {
        metrics.byEventType[eventType].success++;
      } else if (attempt.status === "fail") {
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

    const attempts = await prisma.deliveryAttempt.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        EventLog: {
          eventName: {
            in: ["checkout_completed", "purchase"],
          },
        },
      },
      select: {
        requestPayloadJson: true,
        EventLog: {
          select: {
            eventName: true,
          },
        },
      },
      take: 10000,
    });

    const metrics: MissingParamsMetrics = {
      missingValue: 0,
      missingCurrency: 0,
      missingItems: 0,
      total: attempts.length,
      missingRate: {
        value: 0,
        currency: 0,
        items: 0,
      },
    };

    for (const attempt of attempts) {

      const payload = attempt.requestPayloadJson as Record<string, unknown>;
      let value: number | undefined;
      let currency: string | undefined;
      let items: unknown[] | undefined;

      if (attempt.destinationType === "google") {
        const body = payload.body as Record<string, unknown> | undefined;
        const events = body?.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          value = params?.value as number | undefined;
          currency = params?.currency as string | undefined;
          items = params?.items as unknown[] | undefined;
        }
      } else if (attempt.destinationType === "meta" || attempt.destinationType === "facebook") {
        const body = payload.body as Record<string, unknown> | undefined;
        const data = body?.data as Array<Record<string, unknown>> | undefined;
        if (data && data.length > 0) {
          const customData = data[0].custom_data as Record<string, unknown> | undefined;
          value = customData?.value as number | undefined;
          currency = customData?.currency as string | undefined;
          items = customData?.contents as unknown[] | undefined;
        }
      } else if (attempt.destinationType === "tiktok") {
        const body = payload.body as Record<string, unknown> | undefined;
        const data = body?.data as Array<Record<string, unknown>> | undefined;
        if (data && data.length > 0) {
          const properties = data[0].properties as Record<string, unknown> | undefined;
          value = properties?.value as number | undefined;
          currency = properties?.currency as string | undefined;
          items = properties?.contents as unknown[] | undefined;
        }
      }

      if (value === undefined || value === null) {
        metrics.missingValue++;
      }

      if (!currency) {
        metrics.missingCurrency++;
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
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

    const attempts = await prisma.deliveryAttempt.findMany({
      where: {
        shopId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        destinationType: true,
        status: true,
      },
      take: 10000,
    });

    const metrics: DeduplicationMetrics = {
      total: attempts.length,
      duplicated: 0,
      duplicationRate: 0,
      byDestination: {},
    };

    for (const attempt of attempts) {

      if (attempt.status === "skipped_dedup") {
        metrics.duplicated++;
      }

      const dest = attempt.destinationType || "unknown";
      if (!metrics.byDestination[dest]) {
        metrics.byDestination[dest] = {
          total: 0,
          duplicated: 0,
          duplicationRate: 0,
        };
      }
      metrics.byDestination[dest].total++;
      if (attempt.status === "skipped_dedup") {
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
      prisma.deliveryAttempt.count({
        where: {
          shopId,
          createdAt: {
            gte: currentPeriod.start,
            lte: currentPeriod.end,
          },
        },
      }),
      prisma.deliveryAttempt.count({
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
