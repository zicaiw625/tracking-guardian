import type { PlanId } from "./plans";
import {
  detectPlanFromPrice,
  isHigherTier,
  detectPlanIdFromDisplayName,
} from "./plans";
import type { DerivedPlanResult, SubscriptionNode } from "./subscription.types";

export function parseDateMs(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function parseDate(value?: string): Date | null {
  const parsedMs = parseDateMs(value);
  if (parsedMs === null) {
    return null;
  }
  return new Date(parsedMs);
}

function detectPlanFromName(name: string): PlanId | null {
  return detectPlanIdFromDisplayName(name);
}

export function detectPlanFromSubscription(subscription: SubscriptionNode): PlanId {
  const planFromName = subscription.name
    ? detectPlanFromName(subscription.name)
    : null;
  if (planFromName) {
    return planFromName;
  }

  const prices = (subscription.lineItems ?? [])
    .map((lineItem) => {
      const amount = lineItem.plan?.pricingDetails?.price?.amount;
      return amount ? parseFloat(amount) : null;
    })
    .filter((price): price is number => price !== null && !Number.isNaN(price));

  if (prices.length === 0) {
    return "free";
  }

  const maxPrice = Math.max(...prices);
  return detectPlanFromPrice(maxPrice);
}

export function deriveEffectivePlan(
  subscriptions: SubscriptionNode[],
  now: Date
): DerivedPlanResult {
  const nowMs = now.getTime();
  const validSubscriptions = subscriptions.filter((sub) => {
    if (sub.status === "ACTIVE") {
      return true;
    }
    if (sub.status === "CANCELLED" && sub.currentPeriodEnd) {
      const periodEndMs = parseDateMs(sub.currentPeriodEnd);
      return periodEndMs !== null && periodEndMs > nowMs;
    }
    return false;
  });

  if (validSubscriptions.length === 0) {
    return {
      effectiveSubscription: null,
      plan: "free",
      entitledUntil: null,
      hasActiveSubscription: false,
      hasEntitlement: false,
    };
  }

  const activeSubscriptions = validSubscriptions.filter(
    (sub) => sub.status === "ACTIVE"
  );
  const cancelledSubscriptions = validSubscriptions.filter(
    (sub) => sub.status === "CANCELLED"
  );

  let effectiveSubscription: SubscriptionNode | null = null;
  if (activeSubscriptions.length > 0) {
    const rankedActive = activeSubscriptions
      .map((sub, index) => ({
        sub,
        index,
        plan: detectPlanFromSubscription(sub),
        periodEndMs: parseDateMs(sub.currentPeriodEnd),
        createdAtMs: parseDateMs(sub.createdAt),
      }))
      .sort((a, b) => {
        if (a.plan !== b.plan) {
          return isHigherTier(a.plan, b.plan) ? -1 : 1;
        }
        const aHasPeriodEnd = a.periodEndMs !== null;
        const bHasPeriodEnd = b.periodEndMs !== null;
        if (aHasPeriodEnd !== bHasPeriodEnd) {
          return aHasPeriodEnd ? -1 : 1;
        }
        if (
          a.periodEndMs !== null &&
          b.periodEndMs !== null &&
          a.periodEndMs !== b.periodEndMs
        ) {
          return b.periodEndMs - a.periodEndMs;
        }
        const aHasCreatedAt = a.createdAtMs !== null;
        const bHasCreatedAt = b.createdAtMs !== null;
        if (aHasCreatedAt !== bHasCreatedAt) {
          return aHasCreatedAt ? -1 : 1;
        }
        if (
          a.createdAtMs !== null &&
          b.createdAtMs !== null &&
          a.createdAtMs !== b.createdAtMs
        ) {
          return b.createdAtMs - a.createdAtMs;
        }
        return a.index - b.index;
      });
    effectiveSubscription = rankedActive[0]?.sub ?? null;
  } else if (cancelledSubscriptions.length > 0) {
    cancelledSubscriptions.sort((a, b) => {
      const aEnd = parseDateMs(a.currentPeriodEnd) ?? 0;
      const bEnd = parseDateMs(b.currentPeriodEnd) ?? 0;
      return bEnd - aEnd;
    });
    effectiveSubscription = cancelledSubscriptions[0];
  }

  if (!effectiveSubscription) {
    return {
      effectiveSubscription: null,
      plan: "free",
      entitledUntil: null,
      hasActiveSubscription: false,
      hasEntitlement: false,
    };
  }

  const detectedPlan = detectPlanFromSubscription(effectiveSubscription);

  let entitledUntil: Date | null = null;
  if (effectiveSubscription.status === "ACTIVE") {
    entitledUntil = null;
  } else if (
    effectiveSubscription.status === "CANCELLED" &&
    effectiveSubscription.currentPeriodEnd
  ) {
    entitledUntil = parseDate(effectiveSubscription.currentPeriodEnd);
  }

  return {
    effectiveSubscription,
    plan: detectedPlan,
    entitledUntil,
    hasActiveSubscription: effectiveSubscription.status === "ACTIVE",
    hasEntitlement:
      effectiveSubscription.status === "ACTIVE" ||
      (effectiveSubscription.status === "CANCELLED" &&
        (parseDateMs(effectiveSubscription.currentPeriodEnd) ?? 0) > nowMs),
  };
}
