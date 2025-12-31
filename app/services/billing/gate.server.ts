

import { billingCache } from "~/utils/cache";
import { BILLING_PLANS, type PlanId, getPlanOrDefault } from "./plans";
import { getOrCreateMonthlyUsage } from "./usage.server";
import { ok, err, type Result, type AsyncResult, fromPromise } from "~/types/result";

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
import { getCurrentYearMonth } from "./usage.server";

export interface AtomicReservationResult {
  success: boolean;
  current: number;
  limit: number;
  remaining: number;
  alreadyCounted: boolean;
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
        const current = usage?.sentCount || 0;
        return {
          success: true,
          current,
          limit,
          remaining: Math.max(0, limit - current),
          alreadyCounted: true,
        };
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
        select: { sentCount: true },
      });

      const current = finalUsage?.sentCount || 0;

      if (updated === 0) {

        return {
          success: false,
          current,
          limit,
          remaining: 0,
          alreadyCounted: false,
        };
      }

      return {
        success: true,
        current,
        limit,
        remaining: Math.max(0, limit - current),
        alreadyCounted: false,
      };
    }, {

      isolationLevel: "Serializable",
    });

    if (result.success && !result.alreadyCounted) {
      billingCache.delete(`billing:${shopId}`);
    }

    return ok(result);
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
  const plans: PlanId[] = ["starter", "pro", "enterprise"];

  if (currentPlan === "enterprise") {
    return null;
  }

  for (const planId of plans) {
    const plan = BILLING_PLANS[planId];
    if (plan.monthlyOrderLimit > currentUsage) {

      if (
        planId !== currentPlan &&
        plan.monthlyOrderLimit > BILLING_PLANS[currentPlan].monthlyOrderLimit
      ) {
        return planId;
      }
    }
  }

  return null;
}
