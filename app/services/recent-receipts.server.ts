import prisma from "~/db.server";

export interface RecentReceiptSummary {
  id: string;
  eventType: string;
  platform: string;
  pixelTimestamp: string;
  orderKey: string | null;
  totalValue: number | null;
  currency: string | null;
  hmacMatched: boolean;
  trustLevel: string;
}

export async function getRecentReceipts(
  shopId: string,
  options?: { since?: Date; limit?: number }
): Promise<RecentReceiptSummary[]> {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 50));
  const rows = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      eventType: { in: ["purchase", "checkout_completed"] },
      ...(options?.since ? { pixelTimestamp: { gt: options.since } } : {}),
    },
    orderBy: { pixelTimestamp: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      platform: true,
      pixelTimestamp: true,
      orderKey: true,
      totalValue: true,
      currency: true,
      hmacMatched: true,
      trustLevel: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    platform: row.platform,
    pixelTimestamp: row.pixelTimestamp.toISOString(),
    orderKey: row.orderKey,
    totalValue: row.totalValue ? Number(row.totalValue) : null,
    currency: row.currency,
    hmacMatched: row.hmacMatched,
    trustLevel: row.trustLevel,
  }));
}
