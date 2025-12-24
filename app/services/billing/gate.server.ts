/**
 * Billing Gate Service
 *
 * Provides billing limit checks and gating functionality:
 * - Order limit checking
 * - Billing gate verification
 * - Usage caching for performance
 *
 * Uses Result type for type-safe error handling.
 */

import { billingCache } from "../../utils/cache";
import { BILLING_PLANS, type PlanId, getPlanOrDefault } from "./plans";
import { getOrCreateMonthlyUsage } from "./usage.server";
import { ok, err, type Result, type AsyncResult, fromPromise } from "../../types/result";

// =============================================================================
// Error Types
// =============================================================================

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

// =============================================================================
// Types
// =============================================================================

/**
 * Order limit check result
 */
export interface OrderLimitResult {
  exceeded: boolean;
  current: number;
  limit: number;
  remaining: number;
}

/**
 * Usage information
 */
export interface UsageInfo {
  current: number;
  limit: number;
  remaining: number;
}

/**
 * Billing gate check result (Success case)
 */
export interface BillingGateSuccess {
  allowed: true;
  usage: UsageInfo;
}

/**
 * Billing gate check result (Failure case)
 */
export interface BillingGateBlocked {
  allowed: false;
  reason: "limit_exceeded" | "inactive_subscription";
  usage: UsageInfo;
}

/**
 * Billing gate check result
 */
export type BillingGateResult = BillingGateSuccess | BillingGateBlocked;

/**
 * Cached billing data structure
 */
interface CachedBillingData {
  allowed: boolean;
  reason?: string;
  usage: {
    current: number;
    limit: number;
  };
}

// =============================================================================
// Result-Based Billing Gate Functions
// =============================================================================

/**
 * Check order limit with Result type.
 */
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

/**
 * Check billing gate with Result type.
 */
export async function checkBillingGateResult(
  shopId: string,
  shopPlan: PlanId
): AsyncResult<BillingGateResult, BillingError> {
  // Check cache first (30 second TTL)
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

  // Get fresh data
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

      // Cache the result
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

/**
 * Check if orders can be processed with Result type.
 */
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

// =============================================================================
// Legacy Functions (for backwards compatibility)
// =============================================================================

/**
 * Check if order limit has been exceeded for a shop
 */
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

/**
 * Check billing gate - whether a shop can process more orders
 *
 * This function checks if the shop is within their billing limits
 * and uses caching to reduce database load.
 */
export async function checkBillingGate(
  shopId: string,
  shopPlan: PlanId
): Promise<BillingGateResult> {
  // Check cache first (30 second TTL)
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

  // Get fresh data
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

  // Cache the result
  billingCache.set(cacheKey, {
    allowed: result.allowed,
    reason: result.allowed ? undefined : result.reason,
    usage: { current, limit },
  });

  return result;
}

/**
 * Check if a shop can process a specific number of additional orders
 */
export async function canProcessOrders(
  shopId: string,
  shopPlan: PlanId,
  count: number = 1
): Promise<boolean> {
  const result = await checkBillingGate(shopId, shopPlan);
  return result.allowed && result.usage.remaining >= count;
}

/**
 * Get remaining order capacity for a shop
 */
export async function getRemainingCapacity(
  shopId: string,
  shopPlan: PlanId
): Promise<number> {
  const result = await checkBillingGate(shopId, shopPlan);
  return result.usage.remaining;
}

/**
 * Get usage percentage
 */
export async function getUsagePercentage(
  shopId: string,
  shopPlan: PlanId
): Promise<number> {
  const result = await checkBillingGate(shopId, shopPlan);
  if (result.usage.limit === 0) return 100;
  return Math.round((result.usage.current / result.usage.limit) * 100);
}

/**
 * Check if shop is approaching their limit (>80%)
 */
export async function isApproachingLimit(
  shopId: string,
  shopPlan: PlanId,
  thresholdPercent: number = 80
): Promise<boolean> {
  const percentage = await getUsagePercentage(shopId, shopPlan);
  return percentage >= thresholdPercent;
}

// =============================================================================
// Atomic Billing Gate (Race-Condition Safe)
// =============================================================================

import prisma from "../../db.server";
import { getCurrentYearMonth } from "./usage.server";

/**
 * Result of atomic reservation attempt
 */
export interface AtomicReservationResult {
  success: boolean;
  current: number;
  limit: number;
  remaining: number;
  alreadyCounted: boolean;
}

/**
 * Atomically check billing limit and reserve a slot for an order.
 *
 * This function uses database-level atomic operations to prevent race conditions
 * when multiple requests try to process orders simultaneously. The operation:
 * 1. Checks if order is already counted (idempotent)
 * 2. Atomically increments usage only if under limit
 * 3. Returns whether the reservation succeeded
 *
 * Use this instead of separate checkBillingGate + incrementUsage calls
 * to avoid race conditions in high-concurrency scenarios.
 */
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
      // Step 1: Check if order is already processed (idempotent)
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

      // Step 2: Ensure usage record exists
      await tx.monthlyUsage.upsert({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        create: { shopId, yearMonth, sentCount: 0 },
        update: {},
      });

      // Step 3: Atomic increment with limit check using raw SQL
      // This is the key to avoiding race conditions:
      // UPDATE only succeeds if sentCount < limit
      const updated = await tx.$executeRaw`
        UPDATE "MonthlyUsage"
        SET "sentCount" = "sentCount" + 1, "updatedAt" = NOW()
        WHERE "shopId" = ${shopId}
          AND "yearMonth" = ${yearMonth}
          AND "sentCount" < ${limit}
      `;

      // Step 4: Get final usage count
      const finalUsage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });

      const current = finalUsage?.sentCount || 0;

      if (updated === 0) {
        // Limit was reached, reservation failed
        return {
          success: false,
          current,
          limit,
          remaining: 0,
          alreadyCounted: false,
        };
      }

      // Reservation succeeded
      return {
        success: true,
        current,
        limit,
        remaining: Math.max(0, limit - current),
        alreadyCounted: false,
      };
    }, {
      // Use serializable isolation for strongest consistency
      isolationLevel: "Serializable",
    });

    // Invalidate cache on successful reservation
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

/**
 * Release a previously reserved billing slot (for rollback scenarios).
 *
 * Call this when an operation that reserved a slot fails and needs to
 * be rolled back to avoid charging the shop for unconverted orders.
 */
export async function releaseBillingSlot(
  shopId: string,
  yearMonth?: string
): AsyncResult<number, BillingError> {
  const ym = yearMonth || getCurrentYearMonth();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Atomic decrement, but don't go below 0
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

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Invalidate billing cache for a shop
 */
export function invalidateBillingCache(shopId: string): void {
  billingCache.delete(`billing:${shopId}`);
}

/**
 * Invalidate all billing caches
 */
export function invalidateAllBillingCaches(): void {
  billingCache.clear();
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get human-readable usage summary
 */
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

/**
 * Format usage for display
 */
export function formatUsage(current: number, limit: number): string {
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}

/**
 * Get suggested upgrade plan based on usage
 */
export function getSuggestedUpgrade(
  currentPlan: PlanId,
  currentUsage: number
): PlanId | null {
  const plans: PlanId[] = ["starter", "pro", "enterprise"];

  if (currentPlan === "enterprise") {
    return null; // Already at highest plan
  }

  for (const planId of plans) {
    const plan = BILLING_PLANS[planId];
    if (plan.monthlyOrderLimit > currentUsage) {
      // Find the first plan that can handle current usage with buffer
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
