import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import type { PlanId } from "./plans";

export interface UsageTracking {
  pixelDestinations: {
    current: number;
    limit: number;
    unlimited: boolean;
  };
  uiModules: {
    current: number;
    limit: number;
    unlimited: boolean;
  };
  eventCount: {
    current: number;
    limit: number;
    unlimited: boolean;
  };
  monthlyOrders: {
    current: number;
    limit: number;
    unlimited: boolean;
  };
}

export async function getUsageTracking(
  shopId: string,
  planId: PlanId
): Promise<UsageTracking> {
  try {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [pixelConfigs, uiModules, eventLogs, conversionLogs] = await Promise.all([
      prisma.pixelConfig.count({
        where: {
          shopId,
          isActive: true,
        },
      }),
      prisma.uiExtensionSetting.count({
        where: {
          shopId,
          isEnabled: true,
        },
      }),
      prisma.pixelEventReceipt.count({
        where: {
          shopId,
          createdAt: {
            gte: currentMonthStart,
          },
        },
      }),
      prisma.conversionLog.findMany({
        where: {
          shopId,
          createdAt: {
            gte: currentMonthStart,
          },
          status: "sent",
        },
        select: {
          orderId: true,
        },
        distinct: ["orderId"],
      }),
    ]);
    const monthlyOrders = new Set(conversionLogs.map((log: { orderId: string }) => log.orderId)).size;
    const { getPixelDestinationsLimit, getUiModulesLimit, getPlanLimit } = await import("./plans");
    const pixelLimit = getPixelDestinationsLimit(planId);
    const uiLimit = getUiModulesLimit(planId);
    const orderLimit = getPlanLimit(planId);
    const eventLimit = -1;
    return {
      pixelDestinations: {
        current: pixelConfigs,
        limit: pixelLimit === -1 ? 0 : pixelLimit,
        unlimited: pixelLimit === -1,
      },
      uiModules: {
        current: uiModules,
        limit: uiLimit === -1 ? 0 : uiLimit,
        unlimited: uiLimit === -1,
      },
      eventCount: {
        current: eventLogs,
        limit: eventLimit === -1 ? 0 : eventLimit,
        unlimited: eventLimit === -1,
      },
      monthlyOrders: {
        current: monthlyOrders,
        limit: orderLimit === -1 ? 0 : orderLimit,
        unlimited: orderLimit === -1,
      },
    };
  } catch (error) {
    logger.error("Failed to get usage tracking", {
      shopId,
      planId,
      error,
    });
    throw error;
  }
}

export async function checkUsageApproachingLimit(
  shopId: string,
  planId: PlanId,
  threshold: number = 80
): Promise<{
  approaching: boolean;
  items: Array<{
    type: "pixelDestinations" | "uiModules" | "eventCount" | "monthlyOrders";
    current: number;
    limit: number;
    percentage: number;
  }>;
}> {
  const usage = await getUsageTracking(shopId, planId);
  const items: Array<{
    type: "pixelDestinations" | "uiModules" | "eventCount" | "monthlyOrders";
    current: number;
    limit: number;
    percentage: number;
  }> = [];
  if (!usage.pixelDestinations.unlimited) {
    const percentage =
      usage.pixelDestinations.limit > 0
        ? (usage.pixelDestinations.current / usage.pixelDestinations.limit) * 100
        : 0;
    if (percentage >= threshold) {
      items.push({
        type: "pixelDestinations",
        current: usage.pixelDestinations.current,
        limit: usage.pixelDestinations.limit,
        percentage: Math.round(percentage),
      });
    }
  }
  if (!usage.uiModules.unlimited) {
    const percentage =
      usage.uiModules.limit > 0
        ? (usage.uiModules.current / usage.uiModules.limit) * 100
        : 0;
    if (percentage >= threshold) {
      items.push({
        type: "uiModules",
        current: usage.uiModules.current,
        limit: usage.uiModules.limit,
        percentage: Math.round(percentage),
      });
    }
  }
  if (!usage.monthlyOrders.unlimited) {
    const percentage =
      usage.monthlyOrders.limit > 0
        ? (usage.monthlyOrders.current / usage.monthlyOrders.limit) * 100
        : 0;
    if (percentage >= threshold) {
      items.push({
        type: "monthlyOrders",
        current: usage.monthlyOrders.current,
        limit: usage.monthlyOrders.limit,
        percentage: Math.round(percentage),
      });
    }
  }
  return {
    approaching: items.length > 0,
    items,
  };
}
