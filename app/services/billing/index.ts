/**
 * Billing Module
 *
 * Centralized exports for all billing functionality.
 *
 * The billing system is split into focused modules:
 * - plans.ts: Plan definitions and utilities
 * - subscription.server.ts: Shopify subscription management
 * - usage.server.ts: Monthly usage tracking
 * - gate.server.ts: Billing limit checks
 */

// =============================================================================
// Plan Configuration
// =============================================================================

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
} from "./plans";

// =============================================================================
// Subscription Management
// =============================================================================

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

// =============================================================================
// Usage Tracking
// =============================================================================

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

// =============================================================================
// Billing Gate
// =============================================================================

export {
  // Types
  type OrderLimitResult,
  type UsageInfo,
  type BillingGateResult,
  type BillingGateSuccess,
  type BillingGateBlocked,
  type BillingError,
  type BillingErrorType,
  type AtomicReservationResult,
  // Legacy functions
  checkOrderLimit,
  checkBillingGate,
  canProcessOrders,
  getRemainingCapacity,
  getUsagePercentage,
  isApproachingLimit,
  // Result-based functions
  checkOrderLimitResult,
  checkBillingGateResult,
  canProcessOrdersResult,
  // Atomic operations (race-condition safe)
  checkAndReserveBillingSlot,
  releaseBillingSlot,
  // Cache management
  invalidateBillingCache,
  invalidateAllBillingCaches,
  // Utilities
  getUsageSummary,
  formatUsage,
  getSuggestedUpgrade,
} from "./gate.server";

