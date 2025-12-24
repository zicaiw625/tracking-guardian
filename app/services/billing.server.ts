/**
 * Billing Service
 *
 * BACKWARDS COMPATIBILITY LAYER
 * =============================
 * 
 * This file provides backwards compatibility for existing imports.
 * 
 * RECOMMENDED imports by use case:
 *   - Plan definitions: import { BILLING_PLANS } from "~/services/billing/plans"
 *   - Subscriptions: import { createSubscription } from "~/services/billing/subscription.server"
 *   - Usage tracking: import { incrementMonthlyUsage } from "~/services/billing/usage.server"
 *   - Billing gates: import { checkBillingGate } from "~/services/billing/gate.server"
 *   - All billing: import { ... } from "~/services/billing"
 * 
 * LEGACY (still works):
 *   import { checkBillingGate } from "~/services/billing.server"
 * 
 * @deprecated Prefer importing from "~/services/billing" or specific submodules
 */

// Re-export everything from the billing module
export * from "./billing";
