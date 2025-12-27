

import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { billingCache } from "../../utils/cache";

export interface MonthlyUsageRecord {
  id: string;
  sentCount: number;
}

export interface IncrementResult {
  incremented: boolean;
  current: number;
}

export interface ReservationResult {
  success: boolean;
  current: number;
  alreadyCounted: boolean;
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getMonthDateRange(yearMonth: string): { start: Date; end: Date } {

  const start = new Date(`${yearMonth}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export async function getOrCreateMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<MonthlyUsageRecord> {
  const ym = yearMonth || getCurrentYearMonth();

  const usage = await prisma.monthlyUsage.upsert({
    where: {
      shopId_yearMonth: { shopId, yearMonth: ym },
    },
    create: {
      shopId,
      yearMonth: ym,
      sentCount: 0,
    },
    update: {},
    select: { id: true, sentCount: true },
  });

  return usage;
}

export async function getMonthlyUsageCount(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();

  const usage = await prisma.monthlyUsage.findUnique({
    where: {
      shopId_yearMonth: { shopId, yearMonth: ym },
    },
    select: { sentCount: true },
  });

  return usage?.sentCount ?? 0;
}

export async function isOrderAlreadyCounted(
  shopId: string,
  orderId: string,
  yearMonth?: string
): Promise<boolean> {
  const ym = yearMonth || getCurrentYearMonth();

  const existingJob = await prisma.conversionJob.findUnique({
    where: { shopId_orderId: { shopId, orderId } },
    select: { status: true },
  });

  if (existingJob?.status === "completed") {
    return true;
  }

  const { start: startOfMonth, end: endOfMonth } = getMonthDateRange(ym);

  const sentLog = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      serverSideSent: true,
      sentAt: {
        gte: startOfMonth,
        lt: endOfMonth,
      },
    },
    select: { id: true },
  });

  return !!sentLog;
}

export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {

    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });

    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return { incremented: false, count: usage?.sentCount || 0 };
    }

    const { start: startOfMonth, end: endOfMonth } = getMonthDateRange(yearMonth);

    const sentLog = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        serverSideSent: true,
        sentAt: {
          gte: startOfMonth,
          lt: endOfMonth,
        },
      },
      select: { id: true },
    });

    if (sentLog) {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return { incremented: false, count: usage?.sentCount || 0 };
    }

    const usage = await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: { shopId, yearMonth },
      },
      create: {
        shopId,
        yearMonth,
        sentCount: 1,
      },
      update: {
        sentCount: { increment: 1 },
      },
      select: { sentCount: true },
    });

    return { incremented: true, count: usage.sentCount };
  });

  if (result.incremented) {
    logger.debug(`Usage incremented for shop ${shopId}, order ${orderId}: ${result.count}`);

    billingCache.delete(`billing:${shopId}`);
  }

  return result.count;
}

export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<IncrementResult> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {

    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });

    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { incremented: false, current: usage?.sentCount || 0 };
    }

    const { start: startOfMonth, end: endOfMonth } = getMonthDateRange(yearMonth);

    const sentLog = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        serverSideSent: true,
        sentAt: { gte: startOfMonth, lt: endOfMonth },
      },
      select: { id: true },
    });

    if (sentLog) {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { incremented: false, current: usage?.sentCount || 0 };
    }

    const usage = await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 1 },
      update: { sentCount: { increment: 1 } },
    });

    return { incremented: true, current: usage.sentCount };
  });

  if (result.incremented) {
    billingCache.delete(`billing:${shopId}`);
  }

  return result;
}

export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<ReservationResult> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {

    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });

    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { success: true, current: usage?.sentCount || 0, alreadyCounted: true };
    }

    await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 0 },
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
      where: { shopId_yearMonth: { shopId, yearMonth } },
    });

    if (updated === 0) {
      return {
        success: false,
        current: finalUsage?.sentCount || 0,
        alreadyCounted: false,
      };
    }

    return {
      success: true,
      current: finalUsage?.sentCount || 1,
      alreadyCounted: false,
    };
  });

  if (result.success && !result.alreadyCounted) {
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
    const updated = await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = NOW()
      WHERE "shopId" = ${shopId}
        AND "yearMonth" = ${ym}
    `;

    if (updated === 0) {
      return 0;
    }

    const usage = await tx.monthlyUsage.findUnique({
      where: { shopId_yearMonth: { shopId, yearMonth: ym } },
      select: { sentCount: true },
    });

    return usage?.sentCount || 0;
  });

  billingCache.delete(`billing:${shopId}`);
  return result;
}

