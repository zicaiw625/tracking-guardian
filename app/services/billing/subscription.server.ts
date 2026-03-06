/**
 * Subscription module facade. Implementation is split into:
 * - subscription.types.ts: types and interfaces
 * - subscription-graphql.server.ts: Shopify GraphQL queries/mutations and getAllSubscriptions
 * - subscription-derive.server.ts: deriveEffectivePlan, detectPlanFromSubscription, parseDate
 * - subscription-lifecycle.server.ts: create, cancel, confirm, sync, getStatus, billing history, one-time purchase
 */
export type {
  AdminGraphQL,
  SubscriptionResult,
  SubscriptionStatus,
  CancelResult,
  ConfirmationResult,
  OneTimePurchaseResult,
  OneTimePurchaseStatus,
  BillingHistoryItem,
} from "./subscription.types";

export {
  getBillingHistory,
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  syncSubscriptionStatus,
  handleSubscriptionConfirmation,
  createOneTimePurchase,
  getOneTimePurchaseStatus,
  handleOneTimePurchaseConfirmation,
} from "./subscription-lifecycle.server";
