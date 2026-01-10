import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface EventValidationResult {
  eventId: string;
  orderId: string;
  platform: string;
  eventType: string;
  isValid: boolean;
  missingParams: string[];
  invalidParams: Array<{
    param: string;
    reason: string;
  }>;
}

export interface ValidationSummary {
  total: number;
  valid: number;
  invalid: number;
  validityRate: number;
  missingParamsCount: Record<string, number>;
}

export function validateEventParams(log: {
  orderValue: number | string | null;
  currency: string | null;
  eventId: string | null;
  platform: string;
  eventType: string;
}): EventValidationResult {
  const missingParams: string[] = [];
  const invalidParams: Array<{ param: string; reason: string }> = [];
  if (!log.orderValue || log.orderValue === null) {
    missingParams.push("value");
  } else if (typeof log.orderValue === "number" && log.orderValue <= 0) {
    invalidParams.push({ param: "value", reason: "订单金额必须大于0" });
  }
  if (!log.currency || log.currency.trim() === "") {
    missingParams.push("currency");
  } else if (log.currency.length !== 3) {
    invalidParams.push({ param: "currency", reason: "货币代码必须是3位ISO代码" });
  }
  if (log.eventType === "purchase" && !log.eventId) {
    missingParams.push("event_id");
  }
  return {
    eventId: log.eventId || "",
    orderId: "",
    platform: log.platform,
    eventType: log.eventType,
    isValid: missingParams.length === 0 && invalidParams.length === 0,
    missingParams,
    invalidParams,
  };
}

export async function validateEvents(
  shopId: string,
  options: {
    since?: Date;
    platform?: string;
    eventType?: string;
    limit?: number;
  } = {}
): Promise<{
  results: EventValidationResult[];
  summary: ValidationSummary;
}> {
  const { since, platform, eventType, limit = 1000 } = options;
  const where: {
    shopId: string;
    status: { in: string[] };
    createdAt?: { gte: Date };
    platform?: string;
    eventType?: string;
  } = {
    shopId,
    status: { in: ["sent", "failed"] },
  };
  if (since) {
    where.createdAt = { gte: since };
  }
  if (platform) {
    where.platform = platform;
  }
  if (eventType) {
    where.eventType = eventType;
  }
  const logs = await prisma.conversionLog.findMany({
    where,
    select: {
      id: true,
      orderId: true,
      orderValue: true,
      currency: true,
      eventId: true,
      platform: true,
      eventType: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const results: EventValidationResult[] = logs.map((log) => {
    const validation = validateEventParams({
      orderValue: log.orderValue ? Number(log.orderValue) : null,
      currency: log.currency,
      eventId: log.eventId,
      platform: log.platform,
      eventType: log.eventType,
    });
    return {
      ...validation,
      orderId: log.orderId,
    };
  });
  const valid = results.filter((r) => r.isValid).length;
  const invalid = results.length - valid;
  const missingParamsCount: Record<string, number> = {};
  results.forEach((result) => {
    result.missingParams.forEach((param) => {
      missingParamsCount[param] = (missingParamsCount[param] || 0) + 1;
    });
  });
  const summary: ValidationSummary = {
    total: results.length,
    valid,
    invalid,
    validityRate: results.length > 0 ? (valid / results.length) * 100 : 0,
    missingParamsCount,
  };
  return { results, summary };
}

export async function getMissingParamsRate(
  shopId: string,
  hours: number = 24
): Promise<{
  rate: number;
  byPlatform: Record<string, number>;
  byEventType: Record<string, number>;
  details: Array<{
    platform: string;
    eventType: string;
    missingParams: string[];
    count: number;
  }>;
}> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const validation = await validateEvents(shopId, { since });
  const total = validation.summary.total;
  const invalid = validation.summary.invalid;
  const rate = total > 0 ? (invalid / total) * 100 : 0;
  const byPlatform: Record<string, { total: number; invalid: number }> = {};
  validation.results.forEach((result) => {
    if (!byPlatform[result.platform]) {
      byPlatform[result.platform] = { total: 0, invalid: 0 };
    }
    byPlatform[result.platform].total++;
    if (!result.isValid) {
      byPlatform[result.platform].invalid++;
    }
  });
  const byPlatformRate: Record<string, number> = {};
  Object.entries(byPlatform).forEach(([platform, stats]) => {
    byPlatformRate[platform] = stats.total > 0 ? (stats.invalid / stats.total) * 100 : 0;
  });
  const byEventType: Record<string, { total: number; invalid: number }> = {};
  validation.results.forEach((result) => {
    if (!byEventType[result.eventType]) {
      byEventType[result.eventType] = { total: 0, invalid: 0 };
    }
    byEventType[result.eventType].total++;
    if (!result.isValid) {
      byEventType[result.eventType].invalid++;
    }
  });
  const byEventTypeRate: Record<string, number> = {};
  Object.entries(byEventType).forEach(([eventType, stats]) => {
    byEventTypeRate[eventType] = stats.total > 0 ? (stats.invalid / stats.total) * 100 : 0;
  });
  const detailsMap = new Map<string, {
    platform: string;
    eventType: string;
    missingParams: Set<string>;
    count: number;
  }>();
  validation.results.forEach((result) => {
    if (!result.isValid) {
      const key = `${result.platform}:${result.eventType}`;
      const existing = detailsMap.get(key);
      if (existing) {
        existing.count++;
        result.missingParams.forEach((param) => existing.missingParams.add(param));
      } else {
        detailsMap.set(key, {
          platform: result.platform,
          eventType: result.eventType,
          missingParams: new Set(result.missingParams),
          count: 1,
        });
      }
    }
  });
  const details = Array.from(detailsMap.values()).map((d) => ({
    platform: d.platform,
    eventType: d.eventType,
    missingParams: Array.from(d.missingParams),
    count: d.count,
  }));
  return {
    rate,
    byPlatform: byPlatformRate,
    byEventType: byEventTypeRate,
    details: details.sort((a, b) => b.count - a.count),
  };
}
