

import {
  BILLING_PLANS,
  type PlanId as BillingPlanId,
  normalizePlanId,
  getPlanConfig,
  getPlanOrDefault,
  isHigherTier,
} from "../services/billing/plans";

export type PlanId = BillingPlanId | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceLabel: string;
  tagline: string;
  features: string[];
}

export const PLAN_ORDER: PlanId[] = ["free", "starter", "growth", "agency"];

const PLAN_ORDER_COMPAT: PlanId[] = ["free", "starter", "growth", "pro", "agency"];

export function getPlanDefinition(plan: string | null | undefined): PlanDefinition {
  const normalized = normalizePlan(plan);

  const actualPlanId = normalized === "pro" ? "growth" : normalized;
  const planConfig = getPlanOrDefault(actualPlanId);

  return {
    id: normalized,
    name: planConfig.name,
    priceLabel: `$${planConfig.price}`,
    tagline: planConfig.tagline || "",
    features: [...planConfig.features],
  };
}

export function normalizePlan(plan: string | null | undefined): PlanId {
  if (!plan) return "free";

  if (plan === "pro") {
    return "pro";
  }

  const normalized = normalizePlanId(plan);

  if (PLAN_ORDER.includes(normalized as PlanId)) {
    return normalized as PlanId;
  }

  return "free";
}

export function isPlanAtLeast(
  current: string | null | undefined,
  target: PlanId
): boolean {
  const currentNormalized = normalizePlan(current);
  const targetNormalized = normalizePlan(target);

  const currentActual = currentNormalized === "pro" ? "growth" : currentNormalized;
  const targetActual = targetNormalized === "pro" ? "growth" : targetNormalized;

  return isHigherTier(currentActual as BillingPlanId, targetActual as BillingPlanId) ||
         currentActual === targetActual;
}

