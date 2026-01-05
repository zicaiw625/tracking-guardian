

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
    // P0: 使用 EventLog + DeliveryAttempt 作为数据源
    // 查找该订单的所有事件（主要是 checkout_completed/purchase）
    const eventLogs = await prisma.eventLog.findMany({
      where: {
        shopId,
        // 通过 normalizedEventJson 中的 orderId 匹配
        // 注意：这里需要查询所有事件，然后过滤 orderId
      },
      include: {
        DeliveryAttempt: {
          where: {
            status: { in: ["ok", "fail"] }, // 只检查已发送的（成功或失败）
          },
          select: {
            id: true,
            destinationType: true,
            status: true,
            requestPayloadJson: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100, // 限制查询数量
    });

    // 过滤出匹配 orderId 的事件
    const matchingEvents = eventLogs.filter((eventLog) => {
      const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
      const eventOrderId = normalizedEvent?.orderId as string | undefined;
      return eventOrderId === orderId;
    });

    // 从第一个匹配的事件中提取 Shopify 订单信息
    let shopifyOrder: { orderId: string; orderValue: number; currency: string } | null = null;
    if (matchingEvents.length > 0) {
      const firstEvent = matchingEvents[0];
      const normalizedEvent = firstEvent.normalizedEventJson as Record<string, unknown> | null;
      const value = (normalizedEvent?.value as number) || 0;
      const currency = (normalizedEvent?.currency as string) || "USD";
      
      shopifyOrder = {
        orderId,
        orderValue: value,
        currency,
      };
    }

    // 从 DeliveryAttempt 中提取平台事件信息
    const platformEventsMap = new Map<string, {
      platform: string;
      eventValue: number;
      currency: string;
      eventId: string | null;
      status: string;
    }>();

    for (const eventLog of matchingEvents) {
      const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
      const eventValue = (normalizedEvent?.value as number) || 0;
      const currency = (normalizedEvent?.currency as string) || "USD";
      const eventId = eventLog.eventId;

      for (const attempt of eventLog.DeliveryAttempt) {
        const platform = attempt.destinationType;
        const key = `${platform}-${eventLog.eventName}`;
        
        // 如果该平台已有记录，保留状态为 "ok" 的记录
        if (!platformEventsMap.has(key) || attempt.status === "ok") {
          // 尝试从 requestPayloadJson 中提取更准确的值
          let finalValue = eventValue;
          let finalCurrency = currency;
          
          if (attempt.requestPayloadJson) {
            const requestPayload = attempt.requestPayloadJson as Record<string, unknown> | null;
            if (platform === "google") {
              const body = requestPayload?.body as Record<string, unknown> | undefined;
              const events = body?.events as Array<Record<string, unknown>> | undefined;
              if (events && events.length > 0) {
                const params = events[0].params as Record<string, unknown> | undefined;
                if (params?.value !== undefined) finalValue = (params.value as number) || 0;
                if (params?.currency) finalCurrency = String(params.currency);
              }
            } else if (platform === "meta" || platform === "facebook") {
              const body = requestPayload?.body as Record<string, unknown> | undefined;
              const data = body?.data as Array<Record<string, unknown>> | undefined;
              if (data && data.length > 0) {
                const customData = data[0].custom_data as Record<string, unknown> | undefined;
                if (customData?.value !== undefined) finalValue = (customData.value as number) || 0;
                if (customData?.currency) finalCurrency = String(customData.currency);
              }
            } else if (platform === "tiktok") {
              const body = requestPayload?.body as Record<string, unknown> | undefined;
              const data = body?.data as Array<Record<string, unknown>> | undefined;
              if (data && data.length > 0) {
                const properties = data[0].properties as Record<string, unknown> | undefined;
                if (properties?.value !== undefined) finalValue = (properties.value as number) || 0;
                if (properties?.currency) finalCurrency = String(properties.currency);
              }
            }
          }

          platformEventsMap.set(key, {
            platform,
            eventValue: finalValue,
            currency: finalCurrency,
            eventId,
            status: attempt.status === "ok" ? "sent" : attempt.status,
          });
        }
      }
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
    // P0: 使用 EventLog + DeliveryAttempt 作为数据源
    const eventLogs = await prisma.eventLog.findMany({
      where: {
        shopId,
        eventName: { in: ["checkout_completed", "purchase"] }, // 主要关注购买事件
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        DeliveryAttempt: {
          where: {
            status: { in: ["ok", "fail"] },
          },
          select: {
            destinationType: true,
            status: true,
          },
        },
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

    // 从 EventLog 中提取 orderId 和平台信息
    for (const eventLog of eventLogs) {
      const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
      const orderId = normalizedEvent?.orderId as string | undefined;
      
      if (orderId) {
        orderIds.add(orderId);
      }

      // 统计每个平台的事件数
      for (const attempt of eventLog.DeliveryAttempt) {
        const platform = attempt.destinationType;
        if (!byPlatform[platform]) {
          byPlatform[platform] = {
            total: 0,
            consistent: 0,
            inconsistent: 0,
          };
        }
        byPlatform[platform].total++;
      }
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

