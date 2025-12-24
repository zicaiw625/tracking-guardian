/**
 * Billing Service
 *
 * Re-exports all billing functionality from the billing module.
 * This file is kept for backwards compatibility with existing imports.
 *
 * New code should import directly from:
 * - ~/services/billing/plans for plan definitions
 * - ~/services/billing/subscription.server for subscription management
 * - ~/services/billing/usage.server for usage tracking
 * - ~/services/billing/gate.server for billing gate checks
 * - ~/services/billing for all billing functionality
 */

// Re-export everything from the billing module
export * from "./billing";

// For backwards compatibility, also export the commonly used items directly
export {
  BILLING_PLANS,
  type PlanId,
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  syncSubscriptionStatus,
  handleSubscriptionConfirmation,
  getCurrentYearMonth,
  getOrCreateMonthlyUsage,
  incrementMonthlyUsage,
  incrementMonthlyUsageIdempotent,
  tryReserveUsageSlot,
  checkOrderLimit,
  checkBillingGate,
  // Atomic operations (race-condition safe)
  checkAndReserveBillingSlot,
  releaseBillingSlot,
} from "./billing";
