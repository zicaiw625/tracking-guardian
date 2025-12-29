

import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  current24h: number;
  previous24h: number;
  average7Days: number;
  changePercent: number;
  threshold: number;
  severity: "low" | "medium" | "high";
  message: string;
}

export async function detectEventVolumeDrop(
  shopId: string,
  hours: number = 24
): Promise<AnomalyDetectionResult> {
  const now = new Date();
  const current24hStart = new Date(now);
  current24hStart.setHours(current24hStart.getHours() - hours);

  const previous24hStart = new Date(current24hStart);
  previous24hStart.setHours(previous24hStart.getHours() - hours);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const current24hCount = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: { gte: current24hStart },
    },
  });

  const previous24hCount = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: {
        gte: previous24hStart,
        lt: current24hStart,
      },
    },
  });

  const sevenDaysLogs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      createdAt: true,
    },
  });

  const dailyCounts: Record<string, number> = {};
  sevenDaysLogs.forEach((log) => {
    const dateKey = log.createdAt.toISOString().split("T")[0];
    dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
  });

  const dailyValues = Object.values(dailyCounts);
  const average7Days =
    dailyValues.length > 0
      ? dailyValues.reduce((sum, count) => sum + count, 0) / dailyValues.length
      : 0;

  const variance =
    dailyValues.length > 0
      ? dailyValues.reduce((sum, count) => sum + Math.pow(count - average7Days, 2), 0) /
        dailyValues.length
      : 0;
  const stdDev = Math.sqrt(variance);

  const changePercent =
    previous24hCount > 0
      ? ((current24hCount - previous24hCount) / previous24hCount) * 100
      : 0;

  const threshold = Math.max(
    average7Days - 2 * stdDev,
    previous24hCount * 0.3
  );

  const isAnomaly = current24hCount < threshold && current24hCount > 0;

  let severity: "low" | "medium" | "high" = "low";
  if (isAnomaly) {
    if (changePercent < -70 || current24hCount < average7Days * 0.2) {
      severity = "high";
    } else if (changePercent < -50 || current24hCount < average7Days * 0.4) {
      severity = "medium";
    } else {
      severity = "low";
    }
  }

  const message = isAnomaly
    ? `事件量异常下降：当前 24h ${current24hCount} 个事件，前一天 ${previous24hCount} 个事件（下降 ${Math.abs(changePercent).toFixed(1)}%），7 天平均值 ${average7Days.toFixed(1)} 个事件`
    : `事件量正常：当前 24h ${current24hCount} 个事件，前一天 ${previous24hCount} 个事件`;

  return {
    isAnomaly,
    current24h: current24hCount,
    previous24h: previous24hCount,
    average7Days,
    changePercent,
    threshold,
    severity,
    message,
  };
}

export async function detectAllShopAnomalies(): Promise<
  Array<{ shopId: string; result: AnomalyDetectionResult }>
> {
  const shops = await prisma.shop.findMany({
    where: {
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  const results: Array<{ shopId: string; result: AnomalyDetectionResult }> = [];

  for (const shop of shops) {
    try {
      const result = await detectEventVolumeDrop(shop.id);
      if (result.isAnomaly) {
        results.push({ shopId: shop.id, result });
      }
    } catch (error) {
      logger.error(`Failed to detect anomaly for shop ${shop.id}:`, error);
    }
  }

  return results;
}

