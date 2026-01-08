import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export interface PerformanceStats {
  lcp: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number };
  fcp: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number };
  cls: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number };
  inp: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number };
  ttfb: { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number };
}

export async function getPerformanceStats(
  shopId: string,
  days: number = 7
): Promise<PerformanceStats | null> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const metrics = await prisma.performanceMetric.findMany({
      where: {
        shopId,
        timestamp: { gte: since },
      },
      select: {
        metricName: true,
        metricValue: true,
        rating: true,
      },
    });

    if (metrics.length === 0) {
      return null;
    }

    const stats: PerformanceStats = {
      lcp: calculatePercentiles(metrics, "LCP", [2500, 4000]),
      fcp: calculatePercentiles(metrics, "FCP", [1800, 3000]),
      cls: calculatePercentiles(metrics, "CLS", [0.1, 0.25]),
      inp: calculatePercentiles(metrics, "INP", [200, 500]),
      ttfb: calculatePercentiles(metrics, "TTFB", [800, 1800]),
    };

    return stats;
  } catch (error) {
    logger.error("Failed to get performance stats", error);
    return null;
  }
}

function calculatePercentiles(
  metrics: Array<{ metricName: string; metricValue: number; rating: string }>,
  metricName: string,
  thresholds: [number, number]
): { p50: number; p75: number; p95: number; good: number; needsImprovement: number; poor: number } {
  const values = metrics
    .filter((m) => m.metricName === metricName)
    .map((m) => m.metricValue)
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return { p50: 0, p75: 0, p95: 0, good: 0, needsImprovement: 0, poor: 0 };
  }

  const p50 = values[Math.floor(values.length * 0.5)] || 0;
  const p75 = values[Math.floor(values.length * 0.75)] || 0;
  const p95 = values[Math.floor(values.length * 0.95)] || 0;

  const good = values.filter((v) => v <= thresholds[0]).length;
  const needsImprovement = values.filter((v) => v > thresholds[0] && v <= thresholds[1]).length;
  const poor = values.filter((v) => v > thresholds[1]).length;

  return { p50, p75, p95, good, needsImprovement, poor };
}

export async function getPerformanceTrends(
  shopId: string,
  days: number = 30
): Promise<Array<{ date: string; lcp: number; fcp: number; cls: number; inp: number; ttfb: number }>> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const metrics = await prisma.performanceMetric.findMany({
      where: {
        shopId,
        timestamp: { gte: since },
      },
      select: {
        metricName: true,
        metricValue: true,
        timestamp: true,
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    const dailyStats = new Map<string, { lcp: number[]; fcp: number[]; cls: number[]; inp: number[]; ttfb: number[] }>();

    for (const metric of metrics) {
      const date = metric.timestamp.toISOString().split("T")[0];
      if (!dailyStats.has(date)) {
        dailyStats.set(date, { lcp: [], fcp: [], cls: [], inp: [], ttfb: [] });
      }
      const stats = dailyStats.get(date)!;
      const metricName = metric.metricName.toLowerCase();
      if (metricName in stats) {
        (stats[metricName as keyof typeof stats] as number[]).push(metric.metricValue);
      }
    }

    const trends = Array.from(dailyStats.entries())
      .map(([date, stats]) => ({
        date,
        lcp: calculateAverage(stats.lcp),
        fcp: calculateAverage(stats.fcp),
        cls: calculateAverage(stats.cls),
        inp: calculateAverage(stats.inp),
        ttfb: calculateAverage(stats.ttfb),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return trends;
  } catch (error) {
    logger.error("Failed to get performance trends", error);
    return [];
  }
}

function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}
