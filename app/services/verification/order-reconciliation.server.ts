import prisma from "../../db.server";
import { extractPlatformFromPayload } from "../../utils/common";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractValueCurrencyFromReceipt(
  payload: unknown
): { value: number; currency: string } | null {
  if (!isRecord(payload)) return null;
  const data = payload.data as Record<string, unknown> | undefined;
  let value: number | undefined = data?.value as number | undefined;
  let currency: string | undefined = data?.currency as string | undefined;
  if (payload) {
    if (typeof value !== "number" && data) {
      value = data.value as number | undefined;
      currency = data.currency as string | undefined;
    }
    const platform = extractPlatformFromPayload(payload);
    if (platform === "google") {
      const events = payload.events as Array<Record<string, unknown>> | undefined;
      if (events?.length) {
        const params = events[0].params as Record<string, unknown> | undefined;
        if (params?.value !== undefined) value = params.value as number;
        if (params?.currency) currency = String(params.currency);
      }
    } else if (platform === "meta" || platform === "facebook") {
      const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
      if (eventsData?.length) {
        const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
        if (customData?.value !== undefined) value = customData.value as number;
        if (customData?.currency) currency = String(customData.currency);
      }
    } else if (platform === "tiktok") {
      const eventsData = payload.data as Array<Record<string, unknown>> | undefined;
      if (eventsData?.length) {
        const properties = eventsData[0].properties as Record<string, unknown> | undefined;
        if (properties?.value !== undefined) value = properties.value as number;
        if (properties?.currency) currency = String(properties.currency);
      }
    }
  }
  if (value === undefined || value === null || currency === undefined || currency === "") return null;
  return { value: Number(value), currency: String(currency).trim() };
}

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
      select: { orderId: true, totalPrice: true, currency: true },
    }),
    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: { in: ["checkout_completed", "purchase"] },
        pixelTimestamp: { gte: periodStart, lte: periodEnd },
        orderKey: { not: null },
      },
      select: { orderKey: true, payloadJson: true },
    }),
  ]);

  const orderMap = new Map(
    orders.map((o) => [o.orderId, { totalPrice: Number(o.totalPrice), currency: o.currency }])
  );
  const receiptOrderKeys = new Set(
    receipts.map((r) => r.orderKey).filter((k): k is string => !!k)
  );
  const ordersWithPixel = receiptOrderKeys.size;
  const missingOrderIds = orders
    .filter((o) => !receiptOrderKeys.has(o.orderId))
    .map((o) => ({
      orderId: o.orderId,
      totalPrice: Number(o.totalPrice),
      currency: o.currency,
    }));

  const valueMismatches: PixelVsOrderReconciliationResult["valueMismatches"] = [];
  const seenOrderKeys = new Set<string>();
  for (const receipt of receipts) {
    const orderKey = receipt.orderKey;
    if (!orderKey || seenOrderKeys.has(orderKey)) continue;
    seenOrderKeys.add(orderKey);
    const orderRow = orderMap.get(orderKey);
    if (!orderRow) continue;
    const vc = extractValueCurrencyFromReceipt(receipt.payloadJson);
    if (!vc) continue;
    const orderValue = orderRow.totalPrice;
    const orderCurrency = orderRow.currency;
    const valueMatch = Math.abs(vc.value - orderValue) < 0.01;
    const currencyMatch =
      (vc.currency || "").toUpperCase() === (orderCurrency || "").toUpperCase();
    if (!valueMatch || !currencyMatch) {
      valueMismatches.push({
        orderId: orderKey,
        orderValue,
        orderCurrency,
        pixelValue: vc.value,
        pixelCurrency: vc.currency,
      });
    }
  }

  const totalOrders = orders.length;
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
      "部分订单可能因用户未同意营销/分析追踪、页面未加载完成或网络中断而未触发像素事件，属于合理缺失。",
  };
}
