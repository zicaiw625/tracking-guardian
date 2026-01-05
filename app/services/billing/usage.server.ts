
import { randomUUID } from "crypto";
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { billingCache } from "~/utils/cache";
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

export interface MonthlyUsageRecord {
  id: string;
  shopId: string;
  yearMonth: string;
  sentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncrementResult {
  incremented: boolean;
  current: number;
}

export interface ReservationResult {
  reserved: boolean;
  current: number;
  limit: number;
  remaining: number;
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getMonthDateRange(yearMonth: string): { start: Date; end: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

export async function getOrCreateMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<MonthlyUsageRecord> {
  const ym = yearMonth || getCurrentYearMonth();

  return await prisma.monthlyUsage.upsert({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth: ym,
      },
    },
    create: {
      id: randomUUID(),
      shopId,
      yearMonth: ym,
      sentCount: 0,
      updatedAt: new Date(),
    },
    update: {},
  });
}

export async function getMonthlyUsageCount(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();

  const usage = await prisma.monthlyUsage.findUnique({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth: ym,
      },
    },
    select: {
      sentCount: true,
    },
  });

  return usage?.sentCount || 0;
}

export async function isOrderAlreadyCounted(
  shopId: string,
  orderId: string
): Promise<boolean> {
  const job = await prisma.conversionJob.findUnique({
    where: {
      shopId_orderId: {
        shopId,
        orderId,
      },
    },
    select: {
      status: true,
    },
  });

  if (job?.status === "completed") {
    return true;
  }

  const log = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      status: "sent",
    },
  });

  return !!log;
}

export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();

  let actuallyIncremented = false;
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.conversionJob.findUnique({
      where: {
        shopId_orderId: {
          shopId,
          orderId,
        },
      },
      select: {
        status: true,
      },
    });

    if (job?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return usage?.sentCount || 0;
    }

    const log = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        status: "sent",
      },
    });

    if (log) {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return usage?.sentCount || 0;
    }

    await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      create: {
        id: randomUUID(),
        shopId,
        yearMonth,
        sentCount: 1,
        updatedAt: new Date(),
      },
      update: {
        sentCount: {
          increment: 1,
        },
      },
    });

    actuallyIncremented = true;

    const updated = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return updated?.sentCount || 0;
  });

  if (actuallyIncremented) {
    billingCache.delete(`billing:${shopId}`);
  }
  return result;
}

export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<IncrementResult> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.conversionJob.findUnique({
      where: {
        shopId_orderId: {
          shopId,
          orderId,
        },
      },
      select: {
        status: true,
      },
    });

    if (job?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return {
        incremented: false,
        current: usage?.sentCount || 0,
      };
    }

    const log = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        status: "sent",
      },
    });

    if (log) {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return {
        incremented: false,
        current: usage?.sentCount || 0,
      };
    }

    await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      create: {
        id: randomUUID(),
        shopId,
        yearMonth,
        sentCount: 1,
        updatedAt: new Date(),
      },
      update: {
        sentCount: {
          increment: 1,
        },
      },
    });

    const updated = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return {
      incremented: true,
      current: updated?.sentCount || 0,
    };
  });

  billingCache.delete(`billing:${shopId}`);
  return result;
}

export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<ReservationResult> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.conversionJob.findUnique({
      where: {
        shopId_orderId: {
          shopId,
          orderId,
        },
      },
      select: {
        status: true,
      },
    });

    if (job?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      const current = usage?.sentCount || 0;
      return {
        reserved: false,
        current,
        limit,
        remaining: Math.max(0, limit - current),
      };
    }

    const log = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        status: "sent",
      },
    });

    if (log) {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      const current = usage?.sentCount || 0;
      return {
        reserved: false,
        current,
        limit,
        remaining: Math.max(0, limit - current),
      };
    }

    await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      create: {
        id: randomUUID(),
        shopId,
        yearMonth,
        sentCount: 0,
        updatedAt: new Date(),
      },
      update: {},
    });

    const updated = await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = "sentCount" + 1, "updatedAt" = NOW()
      WHERE "shopId" = ${shopId}
        AND "yearMonth" = ${yearMonth}
        AND "sentCount" < ${limit}
    `;

    const finalUsage = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      select: {
        sentCount: true,
      },
    });

    const current = finalUsage?.sentCount || 0;

    if (updated === 0) {
      return {
        reserved: false,
        current,
        limit,
        remaining: 0,
      };
    }

    return {
      reserved: true,
      current,
      limit,
      remaining: Math.max(0, limit - current),
    };
  });

  if (result.reserved) {
    billingCache.delete(`billing:${shopId}`);
  }

  return result;
}

export async function decrementMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = NOW()
      WHERE "shopId" = ${shopId}
        AND "yearMonth" = ${ym}
    `;

    const usage = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth: ym,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return usage?.sentCount || 0;
  });

  billingCache.delete(`billing:${shopId}`);
  return result;
}
