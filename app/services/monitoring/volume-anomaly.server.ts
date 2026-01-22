import prisma from "../../db.server";

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
): Promise<VolumeAnomalyResult & { knownBehavior?: string; hasAlternativeEvents?: boolean }> {
  const baseline = await calculateBaseline(shopId, 7);
  const currentStart = new Date(Date.now() - currentPeriodHours * 60 * 60 * 1000);
  
  const checkoutCompletedCount = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: { gte: currentStart },
      eventType: "checkout_completed",
    },
  });
  
  const purchaseCount = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: { gte: currentStart },
      eventType: "purchase",
    },
  });
  
  const pageViewedCount = await prisma.pixelEventReceipt.count({
    where: {
      shopId,
      createdAt: { gte: currentStart },
      eventType: "page_viewed",
    },
  });
  
  const current = checkoutCompletedCount + purchaseCount;
  const hasAlternativeEvents = purchaseCount > 0 || pageViewedCount > 0;
  
  const deviation = current - baseline.average;
  const deviationPercent = baseline.average > 0 
    ? (deviation / baseline.average) * 100 
    : 0;
  
  let isAnomaly = Math.abs(deviationPercent) > 20;
  let knownBehavior: string | undefined;
  
  if (checkoutCompletedCount < baseline.average * 0.5 && hasAlternativeEvents) {
    const alternativeTotal = purchaseCount + pageViewedCount;
    if (alternativeTotal >= baseline.average * 0.8) {
      isAnomaly = false;
      knownBehavior = "checkout_completed 事件减少但存在 page_viewed/purchase 事件，可能是 post-purchase/upsell 导致 checkout_completed 在 upsell 页触发而非 Thank you 页，这是 Shopify 的已知行为";
    } else if (alternativeTotal >= baseline.average * 0.5) {
      isAnomaly = Math.abs(deviationPercent) > 30;
      knownBehavior = "checkout_completed 事件减少但存在替代事件，可能是 post-purchase/upsell 场景，建议检查 full_funnel 模式下的 page_viewed 事件";
    }
  }
  
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
    knownBehavior,
    hasAlternativeEvents,
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
