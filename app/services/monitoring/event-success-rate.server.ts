import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

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
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate },
    },
    select: {
      payloadJson: true,
    },
  });
  const byPlatform: Record<string, { total: number; success: number; failure: number; successRate: number }> = {};
  let totalSuccess = 0;
  let totalFailure = 0;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload) || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, success: 0, failure: 0, successRate: 0 };
    }
    byPlatform[platform].total++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    if (hasValue && hasCurrency) {
      totalSuccess++;
      byPlatform[platform].success++;
    } else {
      totalFailure++;
      byPlatform[platform].failure++;
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
