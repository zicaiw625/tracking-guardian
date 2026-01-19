import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { extractPlatformFromPayload } from "~/utils/common";
import type { Prisma } from "@prisma/client";

export interface ReconciliationResult {
  orderId: string;
  shopifyOrder: {
    orderId: string;
    orderValue: number;
    currency: string;
  } | null;
  platformEvents: Array<{
    platform: string;
    eventValue: number;
    currency: string;
    eventId: string | null;
    status: string;
  }>;
  discrepancies: Array<{
    platform: string;
    type: "missing" | "value_mismatch" | "currency_mismatch";
    message: string;
  }>;
  isConsistent: boolean;
}

export async function reconcileOrder(
  shopId: string,
  orderId: string
): Promise<ReconciliationResult> {
  try {
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        orderKey: orderId,
      },
      orderBy: { createdAt: "desc" },
    });
    let shopifyOrder: { orderId: string; orderValue: number; currency: string } | null = null;
    const platformEventsMap = new Map<string, {
      platform: string;
      eventValue: number;
      currency: string;
      eventId: string | null;
      status: string;
    }>();
    for (const receipt of receipts) {
      const platform = extractPlatformFromPayload(receipt.payloadJson as Record<string, unknown> | null);
      if (!platform) continue;
      const payload = receipt.payloadJson as Record<string, unknown> | null;
      const data = payload?.data as Record<string, unknown> | undefined;
      let value = (data?.value as number) || 0;
      let currency = (data?.currency as string) || "USD";
      if (platform === "google") {
        const events = payload?.events as Array<Record<string, unknown>> | undefined;
        if (events && events.length > 0) {
          const params = events[0].params as Record<string, unknown> | undefined;
          if (params?.value !== undefined) value = (params.value as number) || 0;
          if (params?.currency) currency = String(params.currency);
        }
      } else if (platform === "meta" || platform === "facebook") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const customData = eventsData[0].custom_data as Record<string, unknown> | undefined;
          if (customData?.value !== undefined) value = (customData.value as number) || 0;
          if (customData?.currency) currency = String(customData.currency);
        }
      } else if (platform === "tiktok") {
        const eventsData = payload?.data as Array<Record<string, unknown>> | undefined;
        if (eventsData && eventsData.length > 0) {
          const properties = eventsData[0].properties as Record<string, unknown> | undefined;
          if (properties?.value !== undefined) value = (properties.value as number) || 0;
          if (properties?.currency) currency = String(properties.currency);
        }
      }
      if (!shopifyOrder && value > 0) {
        shopifyOrder = {
          orderId,
          orderValue: value,
          currency,
        };
      }
      const key = `${platform}-${receipt.eventType}`;
      const hasValue = value > 0 && !!currency;
      platformEventsMap.set(key, {
        platform,
        eventValue: value,
        currency,
        eventId: receipt.id,
        status: hasValue ? "sent" : "fail",
      });
    }
    const platformEvents = Array.from(platformEventsMap.values());
    const discrepancies: ReconciliationResult["discrepancies"] = [];
    if (!shopifyOrder) {
      discrepancies.push({
        platform: "all",
        type: "missing",
        message: "未找到 Shopify 订单信息",
      });
    } else {
      for (const platformEvent of platformEvents) {
        const valueDiff = Math.abs(
          shopifyOrder.orderValue - platformEvent.eventValue
        );
        const valueDiffRate =
          shopifyOrder.orderValue > 0
            ? (valueDiff / shopifyOrder.orderValue) * 100
            : 0;
        if (valueDiffRate > 1) {
          discrepancies.push({
            platform: platformEvent.platform,
            type: "value_mismatch",
            message: `金额差异 ${valueDiffRate.toFixed(2)}%（Shopify: ${shopifyOrder.orderValue}, 平台: ${platformEvent.eventValue}）`,
          });
        }
        if (
          shopifyOrder.currency.toUpperCase() !==
          platformEvent.currency.toUpperCase()
        ) {
          discrepancies.push({
            platform: platformEvent.platform,
            type: "currency_mismatch",
            message: `货币不一致（Shopify: ${shopifyOrder.currency}, 平台: ${platformEvent.currency}）`,
          });
        }
      }
    }
    return {
      orderId,
      shopifyOrder,
      platformEvents,
      discrepancies,
      isConsistent: discrepancies.length === 0,
    };
  } catch (error) {
    logger.error("Failed to reconcile order", {
      shopId,
      orderId,
      error,
    });
    throw error;
  }
}

export async function reconcileOrders(
  shopId: string,
  orderIds: string[]
): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = [];
  for (const orderId of orderIds) {
    try {
      const result = await reconcileOrder(shopId, orderId);
      results.push(result);
    } catch (error) {
      logger.error("Failed to reconcile order in batch", {
        shopId,
        orderId,
        error,
      });
    }
  }
  return results;
}

export async function getReconciliationSummary(
  shopId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalOrders: number;
  consistentOrders: number;
  inconsistentOrders: number;
  consistencyRate: number;
  byPlatform: Record<
    string,
    {
      total: number;
      consistent: number;
      inconsistent: number;
      consistencyRate: number;
    }
  >;
}> {
  try {
    const receipts = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        eventType: { in: ["checkout_completed", "purchase"] },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        orderKey: true,
        payloadJson: true,
      },
    });
    const orderIds = new Set<string>();
    const byPlatform: Record<
      string,
      {
        total: number;
        consistent: number;
        inconsistent: number;
      }
    > = {};
    for (const receipt of receipts) {
      if (receipt.orderKey) {
        orderIds.add(receipt.orderKey);
      }
      const plat = extractPlatformFromPayload(receipt.payloadJson as Record<string, unknown> | null);
      if (plat) {
        if (!byPlatform[plat]) {
          byPlatform[plat] = {
            total: 0,
            consistent: 0,
            inconsistent: 0,
          };
        }
        byPlatform[plat].total++;
      }
    }
    let consistentOrders = 0;
    let inconsistentOrders = 0;
    const orderIdsArray = Array.from(orderIds);
    for (let i = 0; i < Math.min(orderIdsArray.length, 100); i++) {
      const orderId = orderIdsArray[i];
      try {
        const result = await reconcileOrder(shopId, orderId);
        if (result.isConsistent) {
          consistentOrders++;
          for (const platformEvent of result.platformEvents) {
            if (byPlatform[platformEvent.platform]) {
              byPlatform[platformEvent.platform].consistent++;
            }
          }
        } else {
          inconsistentOrders++;
          for (const platformEvent of result.platformEvents) {
            if (byPlatform[platformEvent.platform]) {
              byPlatform[platformEvent.platform].inconsistent++;
            }
          }
        }
      } catch (error) {
        logger.error("Failed to reconcile order in summary", {
          shopId,
          orderId,
          error,
        });
        inconsistentOrders++;
      }
    }
    const totalOrders = orderIds.size;
    const consistencyRate =
      totalOrders > 0 ? (consistentOrders / totalOrders) * 100 : 0;
    const platformStats: Record<
      string,
      {
        total: number;
        consistent: number;
        inconsistent: number;
        consistencyRate: number;
      }
    > = {};
    for (const [platform, stats] of Object.entries(byPlatform)) {
      platformStats[platform] = {
        ...stats,
        consistencyRate:
          stats.total > 0 ? (stats.consistent / stats.total) * 100 : 0,
      };
    }
    return {
      totalOrders,
      consistentOrders,
      inconsistentOrders,
      consistencyRate: Math.round(consistencyRate),
      byPlatform: platformStats,
    };
  } catch (error) {
    logger.error("Failed to get reconciliation summary", {
      shopId,
      error,
    });
    throw error;
  }
}
