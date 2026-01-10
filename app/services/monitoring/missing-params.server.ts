import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface MissingParamsResult {
  total: number;
  missing: number;
  rate: number;
  byPlatform: Record<string, {
    total: number;
    missing: number;
    rate: number;
  }>;
}

export async function getMissingParamsRate(
  shopId: string,
  hours: number = 24
): Promise<MissingParamsResult> {
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate },
    },
    select: {
      platform: true,
      platformResponse: true,
    },
  });
  const byPlatform: Record<string, { total: number; missing: number; rate: number }> = {};
  let totalMissing = 0;
  for (const log of logs) {
    const platform = log.platform;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, missing: 0, rate: 0 };
    }
    byPlatform[platform].total++;
    const response = log.platformResponse as { missingParams?: string[] } | null;
    if (response?.missingParams && response.missingParams.length > 0) {
      byPlatform[platform].missing++;
      totalMissing++;
    }
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.rate = stats.total > 0 ? (stats.missing / stats.total) * 100 : 0;
  }
  const total = logs.length;
  const rate = total > 0 ? (totalMissing / total) * 100 : 0;
  return {
    total,
    missing: totalMissing,
    rate,
    byPlatform,
  };
}
