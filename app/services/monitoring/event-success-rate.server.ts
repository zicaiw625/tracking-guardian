import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface EventSuccessRateResult {
  total: number;
  success: number;
  failure: number;
  successRate: number;
  failureRate: number;
  byPlatform: Record<string, {
    total: number;
    success: number;
    failure: number;
    successRate: number;
  }>;
}

export async function getEventSuccessRate(
  shopId: string,
  hours: number = 24
): Promise<EventSuccessRateResult> {
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const stats = await prisma.conversionLog.groupBy({
    by: ["platform", "status"],
    where: {
      shopId,
      createdAt: { gte: startDate },
    },
    _count: {
      id: true,
    },
  });
  const byPlatform: Record<string, { total: number; success: number; failure: number; successRate: number }> = {};
  let totalSuccess = 0;
  let totalFailure = 0;
  for (const stat of stats) {
    const platform = stat.platform;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, success: 0, failure: 0, successRate: 0 };
    }
    const count = stat._count.id;
    byPlatform[platform].total += count;
    if (stat.status === "sent") {
      totalSuccess += count;
      byPlatform[platform].success += count;
    } else if (stat.status === "failed" || stat.status === "dead_letter") {
      totalFailure += count;
      byPlatform[platform].failure += count;
    }
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.successRate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
  }
  const total = totalSuccess + totalFailure;
  const successRate = total > 0 ? (totalSuccess / total) * 100 : 0;
  const failureRate = total > 0 ? (totalFailure / total) * 100 : 0;
  return {
    total,
    success: totalSuccess,
    failure: totalFailure,
    successRate,
    failureRate,
    byPlatform,
  };
}
