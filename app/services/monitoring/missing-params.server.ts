
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface MissingParamDefinition {
  name: string;
  label: string;
  required: boolean;
  checkFunction: (log: {
    orderValue: number | string | null;
    currency: string | null;
    eventId: string | null;
    platform?: string;
    eventType?: string;
    eventData?: Record<string, unknown>;
  }) => boolean;
}

export interface MissingParamsDetectionResult {
  paramName: string;
  isMissing: boolean;
  severity: "critical" | "warning" | "info";
  reason?: string;
}

export interface MissingParamsStats {
  overall: {
    total: number;
    withMissingParams: number;
    missingRate: number;
    byParam: Record<string, number>;
  };
  byPlatform: Record<string, {
    total: number;
    withMissingParams: number;
    missingRate: number;
    byParam: Record<string, number>;
  }>;
  byEventType: Record<string, {
    total: number;
    withMissingParams: number;
    missingRate: number;
    byParam: Record<string, number>;
  }>;
  byPlatformAndEventType: Record<string, {
    total: number;
    withMissingParams: number;
    missingRate: number;
    byParam: Record<string, number>;
  }>;
  period: {
    start: Date;
    end: Date;
    hours: number;
  };
}

export interface MissingParamsAlertConfig {
  enabled: boolean;
  threshold: number;
  criticalThreshold?: number;
  byEventType?: Record<string, number>;
  byPlatform?: Record<string, number>;
  params: string[];
}

export interface MissingParamsAlertResult {
  triggered: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  details: {
    overallRate: number;
    threshold: number;
    affectedPlatforms?: string[];
    affectedEventTypes?: string[];
    topMissingParams?: Array<{ param: string; count: number; rate: number }>;
  };
}

const PARAM_DEFINITIONS: MissingParamDefinition[] = [
  {
    name: "value",
    label: "订单金额 (value)",
    required: true,
    checkFunction: (log) => {
      if (log.orderValue === null || log.orderValue === undefined) {
        return true;
      }
      const numValue = typeof log.orderValue === "number" 
        ? log.orderValue 
        : Number(log.orderValue);
      return isNaN(numValue) || numValue === 0;
    },
  },
  {
    name: "currency",
    label: "货币代码 (currency)",
    required: true,
    checkFunction: (log) => {
      return !log.currency || 
             log.currency === "" || 
             log.currency === null || 
             typeof log.currency !== "string" ||
             log.currency.trim() === "";
    },
  },
  {
    name: "items",
    label: "商品信息 (items)",
    required: false,
    checkFunction: (log) => {
      // items 不是必需参数，但如果有 eventData，检查其中是否包含 items
      if (log.eventData && typeof log.eventData === "object" && !Array.isArray(log.eventData)) {
        const eventData = log.eventData as Record<string, unknown>;
        const items = eventData.items;
        // 如果 items 存在但不是数组或为空数组，视为缺失
        if (items !== undefined && items !== null && (!Array.isArray(items) || items.length === 0)) {
          return true;
        }
      }
      // 默认返回 false，因为 items 不是必需参数
      return false;
    },
  },
  {
    name: "event_id",
    label: "事件 ID (event_id)",
    required: false,
    checkFunction: (log) => {
      return !log.eventId || 
             log.eventId === "" || 
             log.eventId === null || 
             typeof log.eventId !== "string" ||
             log.eventId.trim() === "";
    },
  },
];

export function detectMissingParams(log: {
  orderValue: number | string | null;
  currency: string | null;
  eventId: string | null;
  platform?: string;
  eventType?: string;
  eventData?: Record<string, unknown>;
}, paramsToCheck: string[] = ["value", "currency"]): MissingParamsDetectionResult[] {
  const results: MissingParamsDetectionResult[] = [];

  const definitionsToCheck = PARAM_DEFINITIONS.filter((def) =>
    paramsToCheck.includes(def.name)
  );

  definitionsToCheck.forEach((def) => {
    const isMissing = def.checkFunction(log);
    if (isMissing) {
      results.push({
        paramName: def.name,
        isMissing: true,
        severity: def.required ? "critical" : "warning",
        reason: `${def.label} 缺失`,
      });
    }
  });

  return results;
}

export async function getMissingParamsStats(
  shopId: string,
  hours: number = 24,
  paramsToCheck: string[] = ["value", "currency"]
): Promise<MissingParamsStats> {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const now = new Date();

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since, lte: now },
      status: { in: ["sent", "failed"] },
    },
    select: {
      platform: true,
      eventType: true,
      orderValue: true,
      currency: true,
      eventId: true,
      createdAt: true,
    },
  });

  let total = 0;
  let withMissingParams = 0;
  const byParam: Record<string, number> = {};
  const byPlatform: Record<string, {
    total: number;
    withMissingParams: number;
    byParam: Record<string, number>;
  }> = {};
  const byEventType: Record<string, {
    total: number;
    withMissingParams: number;
    byParam: Record<string, number>;
  }> = {};
  const byPlatformAndEventType: Record<string, {
    total: number;
    withMissingParams: number;
    byParam: Record<string, number>;
  }> = {};

  logs.forEach((log) => {
    total++;
    const missingParams = detectMissingParams(log, paramsToCheck);
    const hasMissingParams = missingParams.length > 0;

    if (hasMissingParams) {
      withMissingParams++;
      missingParams.forEach((result) => {
        byParam[result.paramName] = (byParam[result.paramName] || 0) + 1;
      });
    }

    const platform = log.platform;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, withMissingParams: 0, byParam: {} };
    }
    byPlatform[platform].total++;
    if (hasMissingParams) {
      byPlatform[platform].withMissingParams++;
      missingParams.forEach((result) => {
        byPlatform[platform].byParam[result.paramName] =
          (byPlatform[platform].byParam[result.paramName] || 0) + 1;
      });
    }

    const eventType = log.eventType;
    if (!byEventType[eventType]) {
      byEventType[eventType] = { total: 0, withMissingParams: 0, byParam: {} };
    }
    byEventType[eventType].total++;
    if (hasMissingParams) {
      byEventType[eventType].withMissingParams++;
      missingParams.forEach((result) => {
        byEventType[eventType].byParam[result.paramName] =
          (byEventType[eventType].byParam[result.paramName] || 0) + 1;
      });
    }

    const key = `${platform}:${eventType}`;
    if (!byPlatformAndEventType[key]) {
      byPlatformAndEventType[key] = { total: 0, withMissingParams: 0, byParam: {} };
    }
    byPlatformAndEventType[key].total++;
    if (hasMissingParams) {
      byPlatformAndEventType[key].withMissingParams++;
      missingParams.forEach((result) => {
        byPlatformAndEventType[key].byParam[result.paramName] =
          (byPlatformAndEventType[key].byParam[result.paramName] || 0) + 1;
      });
    }
  });

  const overallMissingRate = total > 0 ? (withMissingParams / total) * 100 : 0;

  Object.keys(byPlatform).forEach((platform) => {
    const stats = byPlatform[platform];
    stats.missingRate = stats.total > 0 ? (stats.withMissingParams / stats.total) * 100 : 0;
  });

  Object.keys(byEventType).forEach((eventType) => {
    const stats = byEventType[eventType];
    stats.missingRate = stats.total > 0 ? (stats.withMissingParams / stats.total) * 100 : 0;
  });

  Object.keys(byPlatformAndEventType).forEach((key) => {
    const stats = byPlatformAndEventType[key];
    stats.missingRate = stats.total > 0 ? (stats.withMissingParams / stats.total) * 100 : 0;
  });

  return {
    overall: {
      total,
      withMissingParams,
      missingRate: overallMissingRate,
      byParam,
    },
    byPlatform,
    byEventType,
    byPlatformAndEventType,
    period: {
      start: since,
      end: now,
      hours,
    },
  };
}

export async function checkMissingParamsAlert(
  shopId: string,
  config: MissingParamsAlertConfig,
  hours: number = 24
): Promise<MissingParamsAlertResult> {
  if (!config.enabled) {
    return {
      triggered: false,
      severity: "info",
      message: "缺参率告警未启用",
      details: {
        overallRate: 0,
        threshold: config.threshold,
      },
    };
  }

  const stats = await getMissingParamsStats(shopId, hours, config.params);
  const overallRate = stats.overall.missingRate;

  const threshold = config.threshold;
  const criticalThreshold = config.criticalThreshold || threshold * 2;

  if (overallRate >= criticalThreshold) {

    const affectedPlatforms: string[] = [];
    const affectedEventTypes: string[] = [];
    const topMissingParams: Array<{ param: string; count: number; rate: number }> = [];

    Object.entries(stats.byPlatform).forEach(([platform, platformStats]) => {
      if (platformStats.missingRate >= criticalThreshold) {
        affectedPlatforms.push(platform);
      }
    });

    Object.entries(stats.byEventType).forEach(([eventType, eventStats]) => {
      if (eventStats.missingRate >= criticalThreshold) {
        affectedEventTypes.push(eventType);
      }
    });

    Object.entries(stats.overall.byParam)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .forEach(([param, count]) => {
        const paramRate = stats.overall.total > 0 ? (count / stats.overall.total) * 100 : 0;
        topMissingParams.push({ param, count, rate: paramRate });
      });

    return {
      triggered: true,
      severity: "critical",
      message: `缺参率 ${overallRate.toFixed(2)}% 超过严重阈值 ${criticalThreshold.toFixed(2)}%`,
      details: {
        overallRate,
        threshold: criticalThreshold,
        affectedPlatforms: affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
        affectedEventTypes: affectedEventTypes.length > 0 ? affectedEventTypes : undefined,
        topMissingParams: topMissingParams.length > 0 ? topMissingParams : undefined,
      },
    };
  }

  if (overallRate >= threshold) {

    const affectedPlatforms: string[] = [];
    const affectedEventTypes: string[] = [];
    const topMissingParams: Array<{ param: string; count: number; rate: number }> = [];

    Object.entries(stats.byPlatform).forEach(([platform, platformStats]) => {
      if (platformStats.missingRate >= threshold) {
        affectedPlatforms.push(platform);
      }
    });

    Object.entries(stats.byEventType).forEach(([eventType, eventStats]) => {
      if (eventStats.missingRate >= threshold) {
        affectedEventTypes.push(eventType);
      }
    });

    Object.entries(stats.overall.byParam)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .forEach(([param, count]) => {
        const paramRate = stats.overall.total > 0 ? (count / stats.overall.total) * 100 : 0;
        topMissingParams.push({ param, count, rate: paramRate });
      });

    return {
      triggered: true,
      severity: "warning",
      message: `缺参率 ${overallRate.toFixed(2)}% 超过阈值 ${threshold.toFixed(2)}%`,
      details: {
        overallRate,
        threshold,
        affectedPlatforms: affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
        affectedEventTypes: affectedEventTypes.length > 0 ? affectedEventTypes : undefined,
        topMissingParams: topMissingParams.length > 0 ? topMissingParams : undefined,
      },
    };
  }

  if (config.byPlatform) {
    for (const [platform, platformThreshold] of Object.entries(config.byPlatform)) {
      const platformStats = stats.byPlatform[platform];
      if (platformStats && platformStats.missingRate >= platformThreshold) {
        return {
          triggered: true,
          severity: platformStats.missingRate >= (platformThreshold * 1.5) ? "critical" : "warning",
          message: `平台 ${platform} 的缺参率 ${platformStats.missingRate.toFixed(2)}% 超过阈值 ${platformThreshold.toFixed(2)}%`,
          details: {
            overallRate: platformStats.missingRate,
            threshold: platformThreshold,
            affectedPlatforms: [platform],
          },
        };
      }
    }
  }

  if (config.byEventType) {
    for (const [eventType, eventThreshold] of Object.entries(config.byEventType)) {
      const eventStats = stats.byEventType[eventType];
      if (eventStats && eventStats.missingRate >= eventThreshold) {
        return {
          triggered: true,
          severity: eventStats.missingRate >= (eventThreshold * 1.5) ? "critical" : "warning",
          message: `事件类型 ${eventType} 的缺参率 ${eventStats.missingRate.toFixed(2)}% 超过阈值 ${eventThreshold.toFixed(2)}%`,
          details: {
            overallRate: eventStats.missingRate,
            threshold: eventThreshold,
            affectedEventTypes: [eventType],
          },
        };
      }
    }
  }

  return {
    triggered: false,
    severity: "info",
    message: "缺参率正常",
    details: {
      overallRate,
      threshold,
    },
  };
}

export async function getMissingParamsHistory(
  shopId: string,
  days: number = 7,
  paramsToCheck: string[] = ["value", "currency"]
): Promise<Array<{
  date: string;
  total: number;
  withMissingParams: number;
  missingRate: number;
  byParam: Record<string, number>;
}>> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
      status: { in: ["sent", "failed"] },
    },
    select: {
      orderValue: true,
      currency: true,
      eventId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const dayMap = new Map<string, {
    total: number;
    withMissingParams: number;
    byParam: Record<string, number>;
  }>();

  logs.forEach((log) => {
    // 安全处理日期，避免空值错误
    if (!log.createdAt) {
      return; // 跳过没有创建日期的记录
    }
    const dateStr = log.createdAt.toISOString().split("T")[0];
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, { total: 0, withMissingParams: 0, byParam: {} });
    }

    const dayStats = dayMap.get(dateStr)!;
    dayStats.total++;

    const missingParams = detectMissingParams(log, paramsToCheck);
    if (missingParams.length > 0) {
      dayStats.withMissingParams++;
      missingParams.forEach((result) => {
        dayStats.byParam[result.paramName] = (dayStats.byParam[result.paramName] || 0) + 1;
      });
    }
  });

  return Array.from(dayMap.entries()).map(([date, stats]) => ({
    date,
    total: stats.total,
    withMissingParams: stats.withMissingParams,
    missingRate: stats.total > 0 ? (stats.withMissingParams / stats.total) * 100 : 0,
    byParam: stats.byParam,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

