import prisma from "../../db.server";

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
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startDate },
    },
    select: {
      payloadJson: true,
    },
  });
  const byPlatform: Record<string, { total: number; missing: number; rate: number }> = {};
  let totalMissing = 0;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) continue;
    if (!byPlatform[platform]) {
      byPlatform[platform] = { total: 0, missing: 0, rate: 0 };
    }
    byPlatform[platform].total++;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    const hasItems = Array.isArray(data?.items) && data.items.length > 0;
    if (!hasValue || !hasCurrency || !hasItems) {
      byPlatform[platform].missing++;
      totalMissing++;
    }
  }
  for (const platform in byPlatform) {
    const stats = byPlatform[platform];
    stats.rate = stats.total > 0 ? (stats.missing / stats.total) * 100 : 0;
  }
  const total = receipts.length;
  const rate = total > 0 ? (totalMissing / total) * 100 : 0;
  return {
    total,
    missing: totalMissing,
    rate,
    byPlatform,
  };
}
