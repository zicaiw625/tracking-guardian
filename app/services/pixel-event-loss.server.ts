import prisma from "../db.server";

export interface EventLossStats {
  totalAttempted: number;
  totalReceived: number;
  totalLost: number;
  lossRate: number;
  byFailureReason: Record<string, number>;
  byPlatform: Record<string, {
    attempted: number;
    received: number;
    lost: number;
    lossRate: number;
  }>;
}

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "unknown";
  if (payload.platform && typeof payload.platform === "string") return payload.platform;
  if (payload.destination && typeof payload.destination === "string") return payload.destination;
  return "unknown";
}

export async function getEventLossStats(shopId: string, hours: number = 24): Promise<EventLossStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      payloadJson: true,
      eventType: true,
    },
  });
  const totalReceived = receipts.length;
  const totalAttempted = totalReceived;
  const totalLost = 0;
  const lossRate = 0;
  const byFailureReason: Record<string, number> = {};
  const byPlatform: Record<string, {
    attempted: number;
    received: number;
    lost: number;
    lossRate: number;
  }> = {};
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!byPlatform[platform]) {
      byPlatform[platform] = { attempted: 0, received: 0, lost: 0, lossRate: 0 };
    }
    byPlatform[platform].attempted++;
    byPlatform[platform].received++;
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.lossRate = 0;
  }
  return {
    totalAttempted,
    totalReceived,
    totalLost,
    lossRate,
    byFailureReason,
    byPlatform,
  };
}
