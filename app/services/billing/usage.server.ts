
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import type { PlanId } from "./plans";
import { getPlanLimit } from "./plans";

export interface UsageStats {
  currentMonth: {
    orders: number;
    events: number;
    platforms: Record<string, number>;
  };
  previousMonth: {
    orders: number;
    events: number;
  };
  limit: number;
  usagePercentage: number;
  isOverLimit: boolean;
  trend: "up" | "down" | "stable";
}

export async function getMonthlyUsage(
  shopId: string,
  planId: PlanId
): Promise<UsageStats> {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const [currentMonthLogs, previousMonthLogs, currentMonthReceipts] = await Promise.all([

    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: currentMonthStart },
        status: "sent",
      },
      select: {
        platform: true,
        orderId: true,
      },
    }),

    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: previousMonthStart,
          lte: previousMonthEnd,
        },
        status: "sent",
      },
      select: {
        orderId: true,
      },
    }),

    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: { gte: currentMonthStart },
      },
      select: {
        orderId: true,
      },
    }),
  ]);

  const currentMonthOrderIds = new Set([
    ...currentMonthLogs.map((log) => log.orderId),
    ...currentMonthReceipts.map((receipt) => receipt.orderId),
  ]);
  const currentMonthOrders = currentMonthOrderIds.size;

  const platformCounts: Record<string, number> = {};
  currentMonthLogs.forEach((log) => {
    platformCounts[log.platform] = (platformCounts[log.platform] || 0) + 1;
  });

  const previousMonthOrderIds = new Set(previousMonthLogs.map((log) => log.orderId));
  const previousMonthOrders = previousMonthOrderIds.size;

  const limit = getPlanLimit(planId);
  const usagePercentage = limit > 0 ? (currentMonthOrders / limit) * 100 : 0;
  const isOverLimit = limit > 0 && currentMonthOrders >= limit;

  let trend: "up" | "down" | "stable" = "stable";
  if (previousMonthOrders > 0) {
    const change = ((currentMonthOrders - previousMonthOrders) / previousMonthOrders) * 100;
    if (change > 5) {
      trend = "up";
    } else if (change < -5) {
      trend = "down";
    }
  } else if (currentMonthOrders > 0) {
    trend = "up";
  }

  return {
    currentMonth: {
      orders: currentMonthOrders,
      events: currentMonthLogs.length,
      platforms: platformCounts,
    },
    previousMonth: {
      orders: previousMonthOrders,
      events: previousMonthLogs.length,
    },
    limit,
    usagePercentage,
    isOverLimit,
    trend,
  };
}

export async function checkUsageLimit(
  shopId: string,
  planId: PlanId
): Promise<{ allowed: boolean; reason?: string; usage?: UsageStats }> {
  const usage = await getMonthlyUsage(shopId, planId);

  if (usage.isOverLimit) {
    return {
      allowed: false,
      reason: `本月订单数（${usage.currentMonth.orders}）已达到套餐限制（${usage.limit}）。请升级套餐以继续使用。`,
      usage,
    };
  }

  if (usage.usagePercentage >= 80 && usage.usagePercentage < 100) {
    logger.warn(`Usage approaching limit for shop ${shopId}`, {
      usagePercentage: usage.usagePercentage,
      currentOrders: usage.currentMonth.orders,
      limit: usage.limit,
    });
  }

  return {
    allowed: true,
    usage,
  };
}
