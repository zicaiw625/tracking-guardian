import prisma from "../../db.server";
import { extractEventData } from "../../utils/receipt-parser";

export interface PixelVsOrderReconciliationResult {
  totalOrders: number;
  ordersWithPixel: number;
  missingOrderIds: Array<{ orderId: string; totalPrice: number; currency: string }>;
  valueMismatches: Array<{
    orderId: string;
    orderValue: number;
    orderCurrency: string;
    pixelValue: number;
    pixelCurrency: string;
  }>;
  discrepancyRate: number;
  periodStart: Date;
  periodEnd: Date;
  reasonableMissingNote: string;
}

export async function performPixelVsOrderReconciliation(
  shopId: string,
  hours: number = 24
): Promise<PixelVsOrderReconciliationResult> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - hours * 60 * 60 * 1000);

  const [orders, receipts] = await Promise.all([
    prisma.orderSummary.findMany({
      where: { shopId, createdAt: { gte: periodStart, lte: periodEnd } },
      select: { orderId: true, totalPrice: true, currency: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10000,
    }),
    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: { in: ["checkout_completed", "purchase"] },
        pixelTimestamp: { gte: periodStart, lte: periodEnd },
        orderKey: { not: null },
      },
      orderBy: { pixelTimestamp: "desc" },
      select: { orderKey: true, payloadJson: true, pixelTimestamp: true },
      take: 10000,
    }),
  ]);

  const LIMIT = 10000;
  const limitReached = orders.length >= LIMIT || receipts.length >= LIMIT;

  let effectiveOrders = orders;
  let effectiveReceipts = receipts;

  if (limitReached && orders.length > 0 && receipts.length > 0) {
    const oldestOrderDate = orders[orders.length - 1].createdAt;
    const oldestReceiptDate = receipts[receipts.length - 1].pixelTimestamp;
    
    // Use the more recent of the two oldest dates as the cutoff
    const safeCutoffDate = oldestOrderDate > oldestReceiptDate ? oldestOrderDate : oldestReceiptDate;
    
    effectiveOrders = orders.filter(o => o.createdAt >= safeCutoffDate);
    effectiveReceipts = receipts.filter(r => r.pixelTimestamp >= safeCutoffDate);
  }

  const orderMap = new Map(
    effectiveOrders.map((o) => [o.orderId, { totalPrice: Number(o.totalPrice), currency: o.currency }])
  );
  const receiptOrderKeys = new Set(
    effectiveReceipts.map((r) => r.orderKey).filter((k): k is string => !!k)
  );
  const ordersWithPixel = receiptOrderKeys.size;
  const missingOrderIds = effectiveOrders
    .filter((o) => !receiptOrderKeys.has(o.orderId))
    .map((o) => ({
      orderId: o.orderId,
      totalPrice: Number(o.totalPrice),
      currency: o.currency,
    }));

  const valueMismatches: PixelVsOrderReconciliationResult["valueMismatches"] = [];
  const seenOrderKeys = new Set<string>();
  for (const receipt of effectiveReceipts) {
    const orderKey = receipt.orderKey;
    if (!orderKey || seenOrderKeys.has(orderKey)) continue;
    seenOrderKeys.add(orderKey);
    const orderRow = orderMap.get(orderKey);
    if (!orderRow) continue;
    const { value, currency } = extractEventData(receipt.payloadJson);
    if (value === undefined || currency === undefined) continue;
    const orderValue = orderRow.totalPrice;
    const orderCurrency = orderRow.currency;
    const valueMatch = Math.abs(value - orderValue) < 0.01;
    const currencyMatch =
      (currency || "").toUpperCase() === (orderCurrency || "").toUpperCase();
    if (!valueMatch || !currencyMatch) {
      valueMismatches.push({
        orderId: orderKey,
        orderValue,
        orderCurrency,
        pixelValue: value,
        pixelCurrency: currency,
      });
    }
  }

  const totalOrders = effectiveOrders.length;
  const discrepancyRate =
    totalOrders > 0 ? (missingOrderIds.length / totalOrders) * 100 : 0;

  return {
    totalOrders,
    ordersWithPixel,
    missingOrderIds,
    valueMismatches,
    discrepancyRate: Math.round(discrepancyRate * 100) / 100,
    periodStart,
    periodEnd,
    reasonableMissingNote:
      "Some orders may not have triggered pixel events due to the user not consenting to marketing/analytics tracking, the page not fully loading, or network interruptions. These are considered reasonable missing events.",
  };
}
