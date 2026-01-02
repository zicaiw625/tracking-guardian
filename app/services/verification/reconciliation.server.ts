

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

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

    const conversionLog = await prisma.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
      },
      select: {
        orderValue: true,
        currency: true,
      },
    });

    const shopifyOrder = conversionLog
      ? {
          orderId,
          orderValue: Number(conversionLog.orderValue || 0),
          currency: conversionLog.currency || "USD",
        }
      : null;

    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        eventId: orderId,
        eventName: "checkout_completed",
      },
      select: {
        destinationType: true,
        payloadJson: true,
        eventId: true,
        status: true,
      },
    });

    const platformEvents = events
      .map((event: { payloadJson: unknown; destinationType: string | null; eventId: string | null; status: string }) => {
        const payload = (event.payloadJson as Record<string, unknown>) || {};
        const data = (payload.data as Record<string, unknown>) || {};
        return {
          platform: event.destinationType || "unknown",
          eventValue: Number(data.value || 0),
          currency: (data.currency as string) || "USD",
          eventId: event.eventId || null,
          status: event.status,
        };
      })
      .filter((e: { platform: string }) => e.platform !== "unknown");

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

    const events = await prisma.eventLog.findMany({
      where: {
        shopId,
        eventName: "checkout_completed",
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        eventId: true,
        destinationType: true,
        payloadJson: true,
        status: true,
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

    for (const event of events) {
      if (event.eventId) {
        orderIds.add(event.eventId);
      }

      const platform = event.destinationType || "unknown";
      if (!byPlatform[platform]) {
        byPlatform[platform] = {
          total: 0,
          consistent: 0,
          inconsistent: 0,
        };
      }
      byPlatform[platform].total++;
    }

    let consistentOrders = 0;
    let inconsistentOrders = 0;

    for (const orderId of orderIds) {
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

