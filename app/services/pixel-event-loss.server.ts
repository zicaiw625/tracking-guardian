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
  const deliveryAttempts = await prisma.deliveryAttempt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      platform: true,
      status: true,
      errorCode: true,
    },
  });
  const totalAttempted = deliveryAttempts.length;
  const totalReceived = receipts.length;
  const byFailureReason: Record<string, number> = {};
  const byPlatform: Record<string, {
    attempted: number;
    received: number;
    lost: number;
    lossRate: number;
  }> = {};
  for (const attempt of deliveryAttempts) {
    if (attempt.status === "failed" || attempt.status === "dead_letter") {
      const reason = attempt.errorCode || "unknown";
      byFailureReason[reason] = (byFailureReason[reason] || 0) + 1;
    }
    const platform = attempt.platform || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { attempted: 0, received: 0, lost: 0, lossRate: 0 };
    }
    byPlatform[platform].attempted++;
    if (attempt.status === "failed" || attempt.status === "dead_letter") {
      byPlatform[platform].lost++;
    }
  }
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = (payload?.destination as string) || "unknown";
    if (!byPlatform[platform]) {
      byPlatform[platform] = { attempted: 0, received: 0, lost: 0, lossRate: 0 };
    }
    byPlatform[platform].received++;
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.lossRate = stats.attempted > 0 ? (stats.lost / stats.attempted) * 100 : 0;
  }
  const totalLost = totalAttempted - totalReceived;
  const lossRate = totalAttempted > 0 ? (totalLost / totalAttempted) * 100 : 0;
  return {
    totalAttempted,
    totalReceived,
    totalLost,
    lossRate,
    byFailureReason,
    byPlatform,
  };
}
