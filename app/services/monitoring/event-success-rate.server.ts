
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface SuccessRateByDestination {
  destination: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
  pending?: number;
}

export interface SuccessRateByEventType {
  eventType: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
  pending?: number;
}

export interface SuccessRateByDestinationAndEventType {
  destination: string;
  eventType: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
}

export interface EventSuccessRateStats {
  overall: {
    total: number;
    successful: number;
    failed: number;
    pending?: number;
    successRate: number;
    failureRate: number;
  };
  byDestination: SuccessRateByDestination[];
  byEventType: SuccessRateByEventType[];
  byDestinationAndEventType: SuccessRateByDestinationAndEventType[];
  period: {
    start: Date;
    end: Date;
    hours: number;
  };
}

export interface SuccessRateHistory {
  date: string;
  hour: number;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
}

export interface SuccessRateTrend {
  byDestination: Record<string, SuccessRateHistory[]>;
  byEventType: Record<string, SuccessRateHistory[]>;
  overall: SuccessRateHistory[];
}

export async function getEventSuccessRateStats(
  shopId: string,
  hours: number = 24
): Promise<EventSuccessRateStats> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const now = new Date();

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since, lte: now },
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

  const total = attempts.length;
  const successful = attempts.filter((a) => a.status === "ok").length;
  const failed = attempts.filter((a) => a.status === "fail").length;
  const pending = attempts.filter((a) => a.status === "pending").length;

  const overall = {
    total,
    successful,
    failed,
    pending,
    successRate: total > 0 ? (successful / total) * 100 : 0,
    failureRate: total > 0 ? (failed / total) * 100 : 0,
  };

  const destinationMap = new Map<string, { total: number; successful: number; failed: number; pending: number }>();

  attempts.forEach((attempt) => {
    const dest = attempt.destinationType;
    if (!destinationMap.has(dest)) {
      destinationMap.set(dest, { total: 0, successful: 0, failed: 0, pending: 0 });
    }
    const stats = destinationMap.get(dest)!;
    stats.total++;
    if (attempt.status === "ok") {
      stats.successful++;
    } else if (attempt.status === "fail") {
      stats.failed++;
    } else {
      stats.pending++;
    }
  });

  const byDestination: SuccessRateByDestination[] = Array.from(destinationMap.entries()).map(([destination, stats]) => ({
    destination,
    total: stats.total,
    successful: stats.successful,
    failed: stats.failed,
    pending: stats.pending,
    successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
    failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
  })).sort((a, b) => b.total - a.total);

  const eventTypeMap = new Map<string, { total: number; successful: number; failed: number; pending: number }>();

  attempts.forEach((attempt) => {
    const eventType = attempt.EventLog.eventName;
    if (!eventTypeMap.has(eventType)) {
      eventTypeMap.set(eventType, { total: 0, successful: 0, failed: 0, pending: 0 });
    }
    const stats = eventTypeMap.get(eventType)!;
    stats.total++;
    if (attempt.status === "ok") {
      stats.successful++;
    } else if (attempt.status === "fail") {
      stats.failed++;
    } else {
      stats.pending++;
    }
  });

  const byEventType: SuccessRateByEventType[] = Array.from(eventTypeMap.entries()).map(([eventType, stats]) => ({
    eventType,
    total: stats.total,
    successful: stats.successful,
    failed: stats.failed,
    pending: stats.pending,
    successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
    failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
  })).sort((a, b) => b.total - a.total);

  const destinationEventTypeMap = new Map<string, { total: number; successful: number; failed: number }>();

  attempts.forEach((attempt) => {
    const key = `${attempt.destinationType}:${attempt.EventLog.eventName}`;
    if (!destinationEventTypeMap.has(key)) {
      destinationEventTypeMap.set(key, { total: 0, successful: 0, failed: 0 });
    }
    const stats = destinationEventTypeMap.get(key)!;
    stats.total++;
    if (attempt.status === "ok") {
      stats.successful++;
    } else if (attempt.status === "fail") {
      stats.failed++;
    }
  });

  const byDestinationAndEventType: SuccessRateByDestinationAndEventType[] = Array.from(destinationEventTypeMap.entries()).map(([key, stats]) => {
    const [destination, eventType] = key.split(":");
    return {
      destination,
      eventType,
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
    };
  }).sort((a, b) => b.total - a.total);

  return {
    overall,
    byDestination,
    byEventType,
    byDestinationAndEventType,
    period: {
      start: since,
      end: now,
      hours,
    },
  };
}

export async function getEventSuccessRateHistory(
  shopId: string,
  hours: number = 24
): Promise<SuccessRateTrend> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const now = new Date();

  const attempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since, lte: now },
    },
    select: {
      destinationType: true,
      status: true,
      createdAt: true,
      EventLog: {
        select: {
          eventName: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 10000,
  });

  const hourMap = new Map<string, { total: number; successful: number; failed: number }>();
  const destinationHourMap = new Map<string, Map<string, { total: number; successful: number; failed: number }>>();
  const eventTypeHourMap = new Map<string, Map<string, { total: number; successful: number; failed: number }>>();

  attempts.forEach((attempt) => {
    const date = new Date(attempt.createdAt);
    const dateStr = date.toISOString().split("T")[0];
    const hour = date.getHours();
    const hourKey = `${dateStr}:${hour}`;

    if (!hourMap.has(hourKey)) {
      hourMap.set(hourKey, { total: 0, successful: 0, failed: 0 });
    }
    const overallStats = hourMap.get(hourKey)!;
    overallStats.total++;
    if (attempt.status === "ok") {
      overallStats.successful++;
    } else if (attempt.status === "fail") {
      overallStats.failed++;
    }

    const destination = attempt.destinationType;
    if (!destinationHourMap.has(destination)) {
      destinationHourMap.set(destination, new Map());
    }
    const destHourMap = destinationHourMap.get(destination)!;
    if (!destHourMap.has(hourKey)) {
      destHourMap.set(hourKey, { total: 0, successful: 0, failed: 0 });
    }
    const destStats = destHourMap.get(hourKey)!;
    destStats.total++;
    if (attempt.status === "ok") {
      destStats.successful++;
    } else if (attempt.status === "fail") {
      destStats.failed++;
    }

    const eventType = attempt.EventLog.eventName;
    if (!eventTypeHourMap.has(eventType)) {
      eventTypeHourMap.set(eventType, new Map());
    }
    const eventHourMap = eventTypeHourMap.get(eventType)!;
    if (!eventHourMap.has(hourKey)) {
      eventHourMap.set(hourKey, { total: 0, successful: 0, failed: 0 });
    }
    const eventStats = eventHourMap.get(hourKey)!;
    eventStats.total++;
    if (attempt.status === "ok") {
      eventStats.successful++;
    } else if (attempt.status === "fail") {
      eventStats.failed++;
    }
  });

  const overall: SuccessRateHistory[] = Array.from(hourMap.entries()).map(([key, stats]) => {
    const [date, hourStr] = key.split(":");
    return {
      date,
      hour: parseInt(hourStr, 10),
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
    };
  }).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.hour - b.hour;
  });

  const byDestination: Record<string, SuccessRateHistory[]> = {};
  destinationHourMap.forEach((hourMap, destination) => {
    byDestination[destination] = Array.from(hourMap.entries()).map(([key, stats]) => {
      const [date, hourStr] = key.split(":");
      return {
        date,
        hour: parseInt(hourStr, 10),
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
        successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
        failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      };
    }).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.hour - b.hour;
    });
  });

  const byEventType: Record<string, SuccessRateHistory[]> = {};
  eventTypeHourMap.forEach((hourMap, eventType) => {
    byEventType[eventType] = Array.from(hourMap.entries()).map(([key, stats]) => {
      const [date, hourStr] = key.split(":");
      return {
        date,
        hour: parseInt(hourStr, 10),
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
        successRate: stats.total > 0 ? (stats.successful / stats.total) * 100 : 0,
        failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0,
      };
    }).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.hour - b.hour;
    });
  });

  return {
    overall,
    byDestination,
    byEventType,
  };
}

export async function compareSuccessRates(
  shopId: string,
  currentHours: number = 24,
  previousHours: number = 24
): Promise<{
  current: EventSuccessRateStats;
  previous: EventSuccessRateStats;
  changes: {
    overall: {
      successRateChange: number;
      failureRateChange: number;
    };
    byDestination: Record<string, { successRateChange: number; failureRateChange: number }>;
    byEventType: Record<string, { successRateChange: number; failureRateChange: number }>;
  };
}> {
  const [current, previous] = await Promise.all([
    getEventSuccessRateStats(shopId, currentHours),
    getEventSuccessRateStats(shopId, previousHours),
  ]);

  const overallChange = {
    successRateChange: current.overall.successRate - previous.overall.successRate,
    failureRateChange: current.overall.failureRate - previous.overall.failureRate,
  };

  const byDestinationChanges: Record<string, { successRateChange: number; failureRateChange: number }> = {};
  current.byDestination.forEach((currentStat) => {
    const previousStat = previous.byDestination.find((p) => p.destination === currentStat.destination);
    if (previousStat) {
      byDestinationChanges[currentStat.destination] = {
        successRateChange: currentStat.successRate - previousStat.successRate,
        failureRateChange: currentStat.failureRate - previousStat.failureRate,
      };
    }
  });

  const byEventTypeChanges: Record<string, { successRateChange: number; failureRateChange: number }> = {};
  current.byEventType.forEach((currentStat) => {
    const previousStat = previous.byEventType.find((p) => p.eventType === currentStat.eventType);
    if (previousStat) {
      byEventTypeChanges[currentStat.eventType] = {
        successRateChange: currentStat.successRate - previousStat.successRate,
        failureRateChange: currentStat.failureRate - previousStat.failureRate,
      };
    }
  });

  return {
    current,
    previous,
    changes: {
      overall: overallChange,
      byDestination: byDestinationChanges,
      byEventType: byEventTypeChanges,
    },
  };
}

