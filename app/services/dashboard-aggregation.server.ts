import { randomUUID } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { parseReceiptPayload, extractPlatformFromPayload, isRecord, isReceiptHmacMatched } from "../utils/common";

export interface DailyAggregatedMetrics {
  shopId: string;
  date: Date;
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
  eventVolume: number;
  missingParamsRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function aggregateDailyMetrics(
  shopId: string,
  date: Date
): Promise<DailyAggregatedMetrics> {
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
    select: { payloadJson: true, createdAt: true, eventType: true },
    take: 10000,
  });
  const purchaseReceipts = receipts.filter(
    (r) => r.eventType === "purchase" || r.eventType === "checkout_completed"
  );
  const matchedReceipts = purchaseReceipts.filter((r) => isReceiptHmacMatched(r.payloadJson));
  const orders: Array<{ platform: string; status: string; value: number }> = [];
  for (const receipt of matchedReceipts) {
    const parsed = parseReceiptPayload(receipt.payloadJson);
    if (!parsed) {
      const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
      const platform = extractPlatformFromPayload(payload) || "unknown";
      const data = payload && isRecord(payload.data) ? payload.data : null;
      const value = data && typeof data.value === "number" ? data.value : 0;
      const hasValue = value > 0;
      const hasCurrency = data !== null && typeof data.currency === "string" && data.currency.trim().length > 0;
      orders.push({
        platform,
        status: hasValue && hasCurrency ? "ok" : "pending",
        value,
      });
    } else {
      orders.push({
        platform: parsed.platform,
        status: parsed.hasValue && parsed.hasCurrency ? "ok" : "pending",
        value: parsed.value,
      });
    }
  }
  const totalOrders = orders.length;
  const successfulOrders = orders.filter((o) => o.status === "ok").length;
  const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;
  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const order of orders) {
    if (!platformBreakdown[order.platform]) {
      platformBreakdown[order.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[order.platform].count++;
    platformBreakdown[order.platform].value += order.value;
  }
  const eventVolume = receipts.length;
  const ordersWithMissingParams = orders.filter((o) => o.status !== "ok").length;
  const missingParamsRate = totalOrders > 0 ? ordersWithMissingParams / totalOrders : 0;
  const now = new Date();
  await prisma.dailyAggregatedMetrics.upsert({
    where: { shopId_date: { shopId, date: startOfDay } },
    create: {
      id: randomUUID(),
      shopId,
      date: startOfDay,
      totalOrders,
      totalValue,
      successRate,
      platformBreakdown: platformBreakdown as object,
      eventVolume,
      missingParamsRate,
      updatedAt: now,
    },
    update: {
      totalOrders,
      totalValue,
      successRate,
      platformBreakdown: platformBreakdown as object,
      eventVolume,
      missingParamsRate,
      updatedAt: now,
    },
  });
  return {
    shopId,
    date: startOfDay,
    totalOrders,
    totalValue,
    successRate,
    platformBreakdown,
    eventVolume,
    missingParamsRate,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getAggregatedMetrics(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalOrders: number;
  totalValue: number;
  successRate: number;
  platformBreakdown: Record<string, { count: number; value: number }>;
  dailyBreakdown: Array<{
    date: Date;
    totalOrders: number;
    totalValue: number;
    successRate: number;
  }>;
  eventVolumeByType: Record<string, number>;
  totalEventVolume: number;
}> {
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      payloadJson: true,
      createdAt: true,
      eventType: true,
    },
    take: 10000,
  });
  const purchaseReceipts = receipts.filter(
    (r) => r.eventType === "purchase" || r.eventType === "checkout_completed"
  );
  const eventVolumeByType: Record<string, number> = {};
  for (const r of receipts) {
    const t = r.eventType || "unknown";
    eventVolumeByType[t] = (eventVolumeByType[t] ?? 0) + 1;
  }
  const orders: Array<{ platform: string; status: string; value: number; createdAt: Date }> = [];
  for (const receipt of purchaseReceipts) {
    const parsed = parseReceiptPayload(receipt.payloadJson);
    if (!parsed) {
      const payload = isRecord(receipt.payloadJson) ? receipt.payloadJson : null;
      const platform = extractPlatformFromPayload(payload) || "unknown";
      const data = payload && isRecord(payload.data) ? payload.data : null;
      const value = data && typeof data.value === "number" ? data.value : 0;
      const hasValue = value > 0;
      const hasCurrency = data !== null && typeof data.currency === "string" && data.currency.trim().length > 0;
      orders.push({
        platform,
        status: hasValue && hasCurrency ? "ok" : "pending",
        value,
        createdAt: receipt.createdAt,
      });
    } else {
      orders.push({
        platform: parsed.platform,
        status: parsed.hasValue && parsed.hasCurrency ? "ok" : "pending",
        value: parsed.value,
        createdAt: receipt.createdAt,
      });
    }
  }
  const totalOrders = orders.length;
  const successfulOrders = orders.filter((o) => o.status === "ok").length;
  const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
  const successRate = totalOrders > 0 ? successfulOrders / totalOrders : 0;
  const platformBreakdown: Record<string, { count: number; value: number }> = {};
  for (const order of orders) {
    if (!platformBreakdown[order.platform]) {
      platformBreakdown[order.platform] = { count: 0, value: 0 };
    }
    platformBreakdown[order.platform].count++;
    platformBreakdown[order.platform].value += order.value;
  }
  const dailyMap = new Map<string, { orders: number; value: number; successful: number }>();
  for (const order of orders) {
    const dateKey = order.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { orders: 0, value: 0, successful: 0 });
    }
    const day = dailyMap.get(dateKey)!;
    day.orders++;
    day.value += order.value;
    if (order.status === "ok") {
      day.successful++;
    }
  }
  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([dateKey, stats]) => ({
      date: new Date(dateKey),
      totalOrders: stats.orders,
      totalValue: stats.value,
      successRate: stats.orders > 0 ? stats.successful / stats.orders : 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    totalOrders,
    totalValue,
    successRate,
    platformBreakdown,
    dailyBreakdown,
    eventVolumeByType,
    totalEventVolume: receipts.length,
  };
}

export async function batchAggregateMetrics(
  shopIds: string[],
  date: Date = new Date()
): Promise<number> {
  let successCount = 0;
  for (const shopId of shopIds) {
    try {
      await aggregateDailyMetrics(shopId, date);
      successCount++;
    } catch (error) {
      logger.error("Failed to aggregate metrics for shop", error instanceof Error ? error : new Error(String(error)), {
        shopId,
        date: date.toISOString(),
      });
    }
  }
  logger.info("Batch aggregation completed", {
    total: shopIds.length,
    success: successCount,
    failed: shopIds.length - successCount,
  });
  return successCount;
}
