import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface BaselineStats {
  average: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface VolumeAnomalyResult {
  isAnomaly: boolean;
  current: number;
  baseline: BaselineStats;
  deviation: number;
  deviationPercent: number;
  severity: "low" | "medium" | "high";
}

export async function calculateBaseline(
  shopId: string,
  days: number = 7
): Promise<BaselineStats> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      createdAt: true,
    },
  });
  const dailyCounts = new Map<string, number>();
  for (const receipt of receipts) {
    const dateKey = receipt.createdAt.toISOString().split("T")[0];
    dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
  }
  const counts = Array.from(dailyCounts.values()).sort((a, b) => a - b);
  if (counts.length === 0) {
    return {
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      stdDev: 0,
    };
  }
  const sum = counts.reduce((a, b) => a + b, 0);
  const average = sum / counts.length;
  const median = counts[Math.floor(counts.length / 2)] || 0;
  const min = counts[0] || 0;
  const max = counts[counts.length - 1] || 0;
  const variance = counts.reduce((acc, val) => acc + Math.pow(val - average, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);
  return {
    average,
    median,
    min,
    max,
    stdDev,
  };
}

export async function detectVolumeAnomaly(
  shopId: string,
  currentPeriodHours: number = 24
): Promise<VolumeAnomalyResult> {
  const baseline = await calculateBaseline(shopId, 7);
  const currentStart = new Date(Date.now() - currentPeriodHours * 60 * 60 * 1000);
  const current = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: { gte: currentStart },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
  });
  const deviation = current - baseline.average;
  const deviationPercent = baseline.average > 0 
    ? (deviation / baseline.average) * 100 
    : 0;
  const isAnomaly = Math.abs(deviationPercent) > 20; 
  let severity: "low" | "medium" | "high" = "low";
  if (Math.abs(deviationPercent) > 50) {
    severity = "high";
  } else if (Math.abs(deviationPercent) > 30) {
    severity = "medium";
  }
  return {
    isAnomaly,
    current,
    baseline,
    deviation,
    deviationPercent,
    severity,
  };
}

export async function checkVolumeDropAlerts(
  shopId: string,
  threshold: number = 0.2
): Promise<{ alert: boolean; current: number; baseline: number; dropPercent: number }> {
  const anomaly = await detectVolumeAnomaly(shopId);
  const dropPercent = -anomaly.deviationPercent; 
  const alert = dropPercent > threshold * 100;
  return {
    alert,
    current: anomaly.current,
    baseline: anomaly.baseline.average,
    dropPercent,
  };
}
