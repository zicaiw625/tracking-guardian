

export {
  BILLING_PLANS,
  type PlanId,
  type PlanFeatures,
  PLAN_IDS,
  isValidPlanId,
  getPlanConfig,
  getPlanOrDefault,
  getPlanLimit,
  detectPlanFromPrice,
  hasTrial,
  getTrialDays,
  isHigherTier,
  getUpgradeOptions,
  getMaxShops,
} from "./plans";

export {
  type AdminGraphQL,
  type SubscriptionResult,
  type SubscriptionStatus,
  type CancelResult,
  type ConfirmationResult,
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  syncSubscriptionStatus,
  handleSubscriptionConfirmation,
} from "./subscription.server";

export {
  type MonthlyUsageRecord,
  type IncrementResult,
  type ReservationResult,
  getCurrentYearMonth,
  getMonthDateRange,
  getOrCreateMonthlyUsage,
  getMonthlyUsageCount,
  isOrderAlreadyCounted,
  incrementMonthlyUsage,
  incrementMonthlyUsageIdempotent,
  tryReserveUsageSlot,
  decrementMonthlyUsage,
} from "./usage.server";

export {

  type OrderLimitResult,
  type UsageInfo,
  type BillingGateResult,
  type BillingGateSuccess,
  type BillingGateBlocked,
  type BillingError,
  type BillingErrorType,
  type AtomicReservationResult,

  checkOrderLimit,
  checkBillingGate,
  canProcessOrders,
  getRemainingCapacity,
  getUsagePercentage,
  isApproachingLimit,

  checkOrderLimitResult,
  checkBillingGateResult,
  canProcessOrdersResult,

  checkAndReserveBillingSlot,
  releaseBillingSlot,

  invalidateBillingCache,
  invalidateAllBillingCaches,

  getUsageSummary,
  formatUsage,
  getSuggestedUpgrade,
} from "./gate.server";

