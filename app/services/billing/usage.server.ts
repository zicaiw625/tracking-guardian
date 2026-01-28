import { randomUUID } from "crypto";
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { billingCache } from "~/utils/cache";
import { isReceiptHmacMatched } from "~/utils/common";
import type { PlanId } from "./plans";
import { getPlanLimit } from "./plans";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;
  const platform = data.platform as string | undefined;
  return platform || null;
}

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
  const currentYearMonth = getCurrentYearMonth();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const previousYearMonth = `${previousMonthStart.getFullYear()}-${String(previousMonthStart.getMonth() + 1).padStart(2, "0")}`;
  
  const [currentUsage, previousUsage] = await Promise.all([
    getOrCreateMonthlyUsage(shopId, currentYearMonth),
    prisma.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth: previousYearMonth,
        },
      },
    }),
  ]);
  
  const currentMonthOrders = currentUsage.sentCount;
  const previousMonthOrders = previousUsage?.sentCount || 0;
  
  const platformCounts: Record<string, number> = {};
  const currentMonthReceipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: currentMonthStart },
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      payloadJson: true,
    },
  });
  const matchedCurrentMonthReceipts = currentMonthReceipts.filter((r) =>
    isReceiptHmacMatched(r.payloadJson)
  );
  matchedCurrentMonthReceipts.forEach((receipt) => {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform) return;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    if (hasValue && hasCurrency) {
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    }
  });
  
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
      events: matchedCurrentMonthReceipts.length,
      platforms: platformCounts,
    },
    previousMonth: {
      orders: previousMonthOrders,
      events: 0,
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
  const existing = await prisma.monthlyUsage.findUnique({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth: ym,
      },
    },
  });
  if (existing) {
    return {
      id: existing.id,
      shopId: existing.shopId,
      yearMonth: existing.yearMonth,
      sentCount: existing.sentCount,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }
  const created = await prisma.monthlyUsage.create({
    data: {
      id: randomUUID(),
      shopId,
      yearMonth: ym,
      sentCount: 0,
    },
  });
  return {
    id: created.id,
    shopId: created.shopId,
    yearMonth: created.yearMonth,
    sentCount: created.sentCount,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
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
  const receipt = await prisma.pixelEventReceipt.findFirst({
    where: {
      shopId,
      orderKey: orderId,
      eventType: { in: ["purchase", "checkout_completed"] },
    },
    select: {
      payloadJson: true,
    },
  });
  if (receipt) {
    if (!isReceiptHmacMatched(receipt.payloadJson)) {
      return false;
    }
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const data = payload?.data as Record<string, unknown> | undefined;
    const hasValue = data?.value !== undefined && data?.value !== null;
    const hasCurrency = !!data?.currency;
    return hasValue && hasCurrency;
  }
  return false;
}

export async function incrementMonthlyUsage(
  shopId: string,
  _orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();
  await prisma.monthlyUsage.upsert({
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
    },
    update: {
      sentCount: {
        increment: 1,
      },
    },
  });
  billingCache.delete(`billing:${shopId}`);
  return await getMonthlyUsageCount(shopId, yearMonth);
}

export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<IncrementResult> {
  const alreadyCounted = await isOrderAlreadyCounted(shopId, orderId);
  if (alreadyCounted) {
    const current = await getMonthlyUsageCount(shopId);
    billingCache.delete(`billing:${shopId}`);
    return {
      incremented: false,
      current,
    };
  }
  const yearMonth = getCurrentYearMonth();
  await prisma.monthlyUsage.upsert({
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
    },
    update: {
      sentCount: {
        increment: 1,
      },
    },
  });
  billingCache.delete(`billing:${shopId}`);
  const current = await getMonthlyUsageCount(shopId, yearMonth);
  return {
    incremented: true,
    current,
  };
}

export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<ReservationResult> {
  const alreadyCounted = await isOrderAlreadyCounted(shopId, orderId);
  const yearMonth = getCurrentYearMonth();
  const current = await getMonthlyUsageCount(shopId, yearMonth);
  if (alreadyCounted || (limit > 0 && current >= limit)) {
    return {
      reserved: false,
      current,
      limit,
      remaining: Math.max(0, limit - current),
    };
  }
  if (limit > 0 && current >= limit) {
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
    remaining: limit > 0 ? Math.max(0, limit - current - 1) : -1,
  };
}

export async function decrementMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();
  await prisma.monthlyUsage.upsert({
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
    },
    update: {
      sentCount: {
        decrement: 1,
      },
    },
  });
  billingCache.delete(`billing:${shopId}`);
  return await getMonthlyUsageCount(shopId, yearMonth);
}
