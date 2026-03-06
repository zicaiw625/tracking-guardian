import type { PlanId } from "./plans";

export interface SubscriptionNode {
  id: string;
  name?: string;
  status: string;
  currentPeriodEnd?: string;
  createdAt?: string;
  trialDays?: number;
  lineItems?: Array<{
    plan?: {
      pricingDetails?: {
        price?: { amount?: string; currencyCode?: string };
      };
    };
  }>;
}

export interface BillingHistorySubscriptionNode {
  id: string;
  name: string;
  status: string;
  currentPeriodEnd?: string;
  lineItems?: Array<{
    plan?: {
      pricingDetails?: {
        price?: { amount?: string; currencyCode?: string };
      };
    };
  }>;
}

export interface OneTimePurchaseNode {
  id: string;
  name: string;
  status: string;
  price?: { amount?: string; currencyCode?: string };
  createdAt?: string;
}

export interface GraphQLErrorNode {
  message?: string;
}

export interface GraphQLEnvelope<T> {
  data?: T;
  errors?: GraphQLErrorNode[];
}

export interface DerivedPlanResult {
  effectiveSubscription: SubscriptionNode | null;
  plan: PlanId;
  entitledUntil: Date | null;
  hasActiveSubscription: boolean;
  hasEntitlement: boolean;
}

export interface AdminGraphQL {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

export interface SubscriptionResult {
  success: boolean;
  confirmationUrl?: string;
  subscriptionId?: string;
  error?: string;
}

export interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  hasEntitlement: boolean;
  plan: PlanId;
  subscriptionId?: string;
  status?: string;
  trialDays?: number;
  trialDaysRemaining?: number;
  currentPeriodEnd?: string;
  isTrialing?: boolean;
  entitledUntil?: string;
}

export interface CancelResult {
  success: boolean;
  error?: string;
}

export interface ConfirmationResult {
  success: boolean;
  pending?: boolean;
  plan?: PlanId;
  status?: string;
  error?: string;
}

export interface OneTimePurchaseResult {
  success: boolean;
  confirmationUrl?: string;
  purchaseId?: string;
  error?: string;
}

export interface OneTimePurchaseStatus {
  hasActivePurchase: boolean;
  purchaseId?: string;
  status?: string;
  price?: number;
  createdAt?: string;
}

export interface BillingHistoryItem {
  id: string;
  type: "subscription" | "one_time";
  name: string;
  status: string;
  amount?: number;
  currency?: string;
  createdAt?: string;
  periodEnd?: string;
}
