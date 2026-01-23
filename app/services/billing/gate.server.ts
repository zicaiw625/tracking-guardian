import { randomUUID } from "crypto";
import { billingCache } from "~/utils/cache";
import { logger } from "~/utils/logger.server";
import { BILLING_PLANS, type PlanId, getPlanOrDefault } from "./plans";
import { getOrCreateMonthlyUsage , getCurrentYearMonth } from "./usage.server";
import { ok, err, type AsyncResult, fromPromise } from "~/types/result";
import { JobStatus, ConversionLogStatus } from "~/types/enums";

export type BillingErrorType =
  | "LIMIT_EXCEEDED"
  | "INACTIVE_SUBSCRIPTION"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR";

export interface BillingError {
  type: BillingErrorType;
  message: string;
  shopId?: string;
}

export interface OrderLimitResult {
  exceeded: boolean;
  current: number;
  limit: number;
  remaining: number;
}

export interface UsageInfo {
  current: number;
  limit: number;
  remaining: number;
}

export interface BillingGateSuccess {
  allowed: true;
  usage: UsageInfo;
}

export interface BillingGateBlocked {
  allowed: false;
  reason: "limit_exceeded" | "inactive_subscription";
  usage: UsageInfo;
}

export type BillingGateResult = BillingGateSuccess | BillingGateBlocked;

interface CachedBillingData {
  allowed: boolean;
  reason?: string;
  usage: {
    current: number;
    limit: number;
  };
}

export async function checkOrderLimitResult(
  shopId: string,
  shopPlan: PlanId
): AsyncResult<OrderLimitResult, BillingError> {
  const result = await fromPromise(
    (async () => {
      const planConfig = getPlanOrDefault(shopPlan);
      const limit = planConfig.monthlyOrderLimit;
      const usage = await getOrCreateMonthlyUsage(shopId);
      const current = usage.sentCount;
      return {
        exceeded: current >= limit,
        current,
        limit,
        remaining: Math.max(0, limit - current),
      };
    })(),
    (e): BillingError => ({
      type: "DATABASE_ERROR",
      message: e instanceof Error ? e.message : "Unknown database error",
      shopId,
    })
  );
  return result;
}

export async function checkBillingGateResult(
  shopId: string,
  shopPlan: PlanId
): AsyncResult<BillingGateResult, BillingError> {
  const cacheKey = `billing:${shopId}`;
  const cached = billingCache.get(cacheKey) as CachedBillingData | undefined;
  if (cached) {
    const remaining = Math.max(0, cached.usage.limit - cached.usage.current);
    const usage = { ...cached.usage, remaining };
    if (cached.allowed) {
      return ok({ allowed: true, usage });
    }
    return ok({
      allowed: false,
      reason: (cached.reason as "limit_exceeded" | "inactive_subscription") || "limit_exceeded",
      usage,
    });
  }
  const result = await fromPromise(
    (async () => {
      const planConfig = getPlanOrDefault(shopPlan);
      const limit = planConfig.monthlyOrderLimit;
      const usageRecord = await getOrCreateMonthlyUsage(shopId);
      const current = usageRecord.sentCount;
      const remaining = Math.max(0, limit - current);
      const usage = { current, limit, remaining };
      const gateResult: BillingGateResult =
        current >= limit
          ? { allowed: false, reason: "limit_exceeded", usage }
          : { allowed: true, usage };
      billingCache.set(cacheKey, {
        allowed: gateResult.allowed,
        reason: gateResult.allowed ? undefined : gateResult.reason,
        usage: { current, limit },
      });
      return gateResult;
    })(),
    (e): BillingError => ({
      type: "DATABASE_ERROR",
      message: e instanceof Error ? e.message : "Unknown database error",
      shopId,
    })
  );
  return result;
}

export async function canProcessOrdersResult(
  shopId: string,
  shopPlan: PlanId,
  count: number = 1
): AsyncResult<boolean, BillingError> {
  const result = await checkBillingGateResult(shopId, shopPlan);
  if (!result.ok) {
    return result;
  }
  return ok(result.value.allowed && result.value.usage.remaining >= count);
}

export async function checkOrderLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<OrderLimitResult> {
  const planConfig = getPlanOrDefault(shopPlan);
  const limit = planConfig.monthlyOrderLimit;
  const usage = await getOrCreateMonthlyUsage(shopId);
  const current = usage.sentCount;
  return {
    exceeded: current >= limit,
    current,
    limit,
    remaining: Math.max(0, limit - current),
  };
}

export async function checkBillingGate(
  shopId: string,
  shopPlan: PlanId
): Promise<BillingGateResult> {
  const cacheKey = `billing:${shopId}`;
  const cached = billingCache.get(cacheKey) as CachedBillingData | undefined;
  if (cached) {
    const remaining = Math.max(0, cached.usage.limit - cached.usage.current);
    const usage = { ...cached.usage, remaining };
    if (cached.allowed) {
      return { allowed: true, usage };
    }
    return {
      allowed: false,
      reason: (cached.reason as "limit_exceeded" | "inactive_subscription") || "limit_exceeded",
      usage,
    };
  }
  const planConfig = getPlanOrDefault(shopPlan);
  const limit = planConfig.monthlyOrderLimit;
  const usageRecord = await getOrCreateMonthlyUsage(shopId);
  const current = usageRecord.sentCount;
  const remaining = Math.max(0, limit - current);
  const usage = { current, limit, remaining };
  const result: BillingGateResult =
    current >= limit
      ? { allowed: false, reason: "limit_exceeded", usage }
      : { allowed: true, usage };
  billingCache.set(cacheKey, {
    allowed: result.allowed,
    reason: result.allowed ? undefined : result.reason,
    usage: { current, limit },
  });
  return result;
}

export async function canProcessOrders(
  shopId: string,
  shopPlan: PlanId,
  count: number = 1
): Promise<boolean> {
  const result = await checkBillingGate(shopId, shopPlan);
  return result.allowed && result.usage.remaining >= count;
}

export async function getRemainingCapacity(
  shopId: string,
  shopPlan: PlanId
): Promise<number> {
  const result = await checkBillingGate(shopId, shopPlan);
  return result.usage.remaining;
}

export async function getUsagePercentage(
  shopId: string,
  shopPlan: PlanId
): Promise<number> {
  const result = await checkBillingGate(shopId, shopPlan);
  if (result.usage.limit === 0) return 100;
  return Math.round((result.usage.current / result.usage.limit) * 100);
}

export async function isApproachingLimit(
  shopId: string,
  shopPlan: PlanId,
  thresholdPercent: number = 80
): Promise<boolean> {
  const percentage = await getUsagePercentage(shopId, shopPlan);
  return percentage >= thresholdPercent;
}

import prisma from "~/db.server";

export interface AtomicReservationResult {
  success: boolean;
  current: number;
  limit: number;
  remaining: number;
  alreadyCounted: boolean;
  yearMonth: string; 
}

export async function checkAndReserveBillingSlot(
  shopId: string,
  shopPlan: PlanId,
  orderId: string
): AsyncResult<AtomicReservationResult, BillingError> {
  const yearMonth = getCurrentYearMonth();
  try {
    const planConfig = getPlanOrDefault(shopPlan);
    const limit = planConfig.monthlyOrderLimit;
    const maxRetries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const existingJob = await tx.conversionJob.findUnique({
            where: { shopId_orderId: { shopId, orderId } },
            select: { status: true },
          });
          const existingLog = await tx.conversionLog.findFirst({
            where: {
              shopId,
              orderId,
              status: ConversionLogStatus.SENT,
            },
            select: { id: true },
          });
          if (existingJob?.status === JobStatus.COMPLETED || existingLog) {
            const usage = await tx.monthlyUsage.findUnique({
              where: { shopId_yearMonth: { shopId, yearMonth } },
              select: { sentCount: true },
            });
            const current = usage?.sentCount || 0;
            return {
              success: true,
              current,
              limit,
              remaining: Math.max(0, limit - current),
              alreadyCounted: true,
              yearMonth,
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
          if (updated === 0) {
            const currentUsage = await tx.monthlyUsage.findUnique({
              where: { shopId_yearMonth: { shopId, yearMonth } },
              select: { sentCount: true },
            });
            const current = currentUsage?.sentCount || 0;
            return {
              success: false,
              current,
              limit,
              remaining: 0,
              alreadyCounted: false,
              yearMonth,
            };
          }
          const finalUsage = await tx.monthlyUsage.findUnique({
            where: { shopId_yearMonth: { shopId, yearMonth } },
            select: { sentCount: true },
          });
          const current = finalUsage?.sentCount || 0;
          if (current > limit) {
            logger.error('Usage count exceeded limit after atomic update', {
              shopId,
              yearMonth,
              current,
              limit,
              orderId,
            });
            return {
              success: false,
              current,
              limit,
              remaining: 0,
              alreadyCounted: false,
              yearMonth,
            };
          }
          return {
            success: true,
            current,
            limit,
            remaining: Math.max(0, limit - current),
            alreadyCounted: false,
            yearMonth,
          };
        }, {
          isolationLevel: "Serializable",
          maxWait: 5000,
        });
        billingCache.delete(`billing:${shopId}`);
        return ok(result);
      } catch (error) {
        lastError = error;
        const isPrismaError_ = error && typeof error === 'object' && 'code' in error;
        const errorCode = isPrismaError_ ? (error as { code?: string }).code : null;
        const isSerializationError = errorCode === 'P40001' || (errorCode?.startsWith('P40') ?? false);
        if (isSerializationError && attempt < maxRetries - 1) {
          const backoffMs = 50 * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      }
    }
    return err({
      type: "DATABASE_ERROR",
      message: lastError instanceof Error ? lastError.message : "Unknown database error after retries",
      shopId,
    });
  } catch (error) {
    return err({
      type: "DATABASE_ERROR",
      message: error instanceof Error ? error.message : "Unknown database error",
      shopId,
    });
  }
}

export async function releaseBillingSlot(
  shopId: string,
  yearMonth?: string
): AsyncResult<number, BillingError> {
  const ym = yearMonth || getCurrentYearMonth();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "MonthlyUsage"
        SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = NOW()
        WHERE "shopId" = ${shopId}
          AND "yearMonth" = ${ym}
      `;
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth: ym } },
        select: { sentCount: true },
      });
      return usage?.sentCount || 0;
    });
    billingCache.delete(`billing:${shopId}`);
    return ok(result);
  } catch (error) {
    return err({
      type: "DATABASE_ERROR",
      message: error instanceof Error ? error.message : "Unknown database error",
      shopId,
    });
  }
}

export function invalidateBillingCache(shopId: string): void {
  billingCache.delete(`billing:${shopId}`);
}

export function invalidateAllBillingCaches(): void {
  billingCache.clear();
}

export async function getUsageSummary(
  shopId: string,
  shopPlan: PlanId
): Promise<{
  current: number;
  limit: number;
  remaining: number;
  percentage: number;
  isLimited: boolean;
  isNearLimit: boolean;
}> {
  const result = await checkBillingGate(shopId, shopPlan);
  const percentage =
    result.usage.limit > 0
      ? Math.round((result.usage.current / result.usage.limit) * 100)
      : 0;
  return {
    current: result.usage.current,
    limit: result.usage.limit,
    remaining: result.usage.remaining,
    percentage,
    isLimited: !result.allowed,
    isNearLimit: percentage >= 80,
  };
}

export function formatUsage(current: number, limit: number): string {
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function getSuggestedUpgrade(
  currentPlan: PlanId,
  currentUsage: number
): PlanId | null {
  if (currentPlan === "agency") {
    return null;
  }
  const planTiers: PlanId[] = ["free", "starter", "growth", "agency"];
  const currentIndex = planTiers.indexOf(currentPlan);
  if (currentIndex === -1) {
    return null;
  }
  for (let i = currentIndex + 1; i < planTiers.length; i++) {
    const planId = planTiers[i];
    const plan = BILLING_PLANS[planId];
    if (plan.monthlyOrderLimit > currentUsage) {
      return planId;
    }
  }
  return null;
}
