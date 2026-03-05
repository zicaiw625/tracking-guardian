import prisma from "../../db.server";
import { createAuditLog } from "../audit.server";
import { logger } from "../../utils/logger.server";
import { assertSafeRedirect } from "../../utils/redirect-validation.server";
import { BILLING_PLANS, type PlanId, detectPlanFromPrice, isHigherTier, getPlanDisplayName, detectPlanIdFromDisplayName } from "./plans";
import { resolveEffectivePlan } from "./effective-plan.server";
import { getShopPlan } from "../shop-tier.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

function detectPlanFromName(name: string): PlanId | null {
  return detectPlanIdFromDisplayName(name);
}

interface SubscriptionNode {
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

interface DerivedPlanResult {
  effectiveSubscription: SubscriptionNode | null;
  plan: PlanId;
  entitledUntil: Date | null;
  hasActiveSubscription: boolean;
  hasEntitlement: boolean;
}

function deriveEffectivePlan(
  subscriptions: SubscriptionNode[],
  now: Date
): DerivedPlanResult {
  const validSubscriptions = subscriptions.filter((sub) => {
    if (sub.status === "ACTIVE") {
      return true;
    }
    if (sub.status === "CANCELLED" && sub.currentPeriodEnd) {
      const periodEnd = new Date(sub.currentPeriodEnd);
      return periodEnd > now;
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
      .map((sub) => ({
        sub,
        plan: detectPlanFromSubscription(sub),
        periodEnd: sub.currentPeriodEnd
          ? new Date(sub.currentPeriodEnd).getTime()
          : Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => {
        if (a.plan === b.plan) {
          return b.periodEnd - a.periodEnd;
        }
        return isHigherTier(a.plan, b.plan) ? -1 : 1;
      });
    effectiveSubscription = rankedActive[0]?.sub ?? null;
  } else if (cancelledSubscriptions.length > 0) {
    cancelledSubscriptions.sort((a, b) => {
      const aEnd = a.currentPeriodEnd ? new Date(a.currentPeriodEnd).getTime() : 0;
      const bEnd = b.currentPeriodEnd ? new Date(b.currentPeriodEnd).getTime() : 0;
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
    entitledUntil = new Date(effectiveSubscription.currentPeriodEnd);
  }

  return {
    effectiveSubscription,
    plan: detectedPlan,
    entitledUntil,
    hasActiveSubscription: effectiveSubscription.status === "ACTIVE",
    hasEntitlement:
      effectiveSubscription.status === "ACTIVE" ||
      (
        effectiveSubscription.status === "CANCELLED" &&
        Boolean(effectiveSubscription.currentPeriodEnd) &&
        new Date(effectiveSubscription.currentPeriodEnd as string) > now
      ),
  };
}

function detectPlanFromSubscription(subscription: SubscriptionNode): PlanId {
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
  plan?: PlanId;
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

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      replacementBehavior: $replacementBehavior
    ) {
      appSubscription {
        id
        status
        trialDays
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_SUBSCRIPTION_QUERY = `
  query GetSubscription {
    appInstallation {
      allSubscriptions(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            status
            trialDays
            createdAt
            currentPeriodEnd
            test
            lineItems {
              id
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_ONE_TIME_PURCHASE_MUTATION = `
  mutation AppPurchaseOneTimeCreate(
    $name: String!
    $price: MoneyInput!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appPurchaseOneTimeCreate(
      name: $name
      price: $price
      returnUrl: $returnUrl
      test: $test
    ) {
      appPurchaseOneTime {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ONE_TIME_PURCHASES_QUERY = `
  query GetOneTimePurchases {
    appInstallation {
      oneTimePurchases(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            status
            price {
              amount
              currencyCode
            }
            createdAt
          }
        }
      }
    }
  }
`;

async function getAllSubscriptions(admin: AdminGraphQL): Promise<SubscriptionNode[]> {
  const response = await admin.graphql(GET_SUBSCRIPTION_QUERY);
  const data = await response.json();
  const subscriptionsConnection = data.data?.appInstallation?.allSubscriptions;
  return subscriptionsConnection?.edges?.map((edge: { node: unknown }) => edge.node as SubscriptionNode) || [];
}

export async function getBillingHistory(
  admin: AdminGraphQL
): Promise<BillingHistoryItem[]> {
  try {
    const [subscriptionResponse, purchaseResponse] = await Promise.all([
      admin.graphql(GET_SUBSCRIPTION_QUERY),
      admin.graphql(GET_ONE_TIME_PURCHASES_QUERY),
    ]);
    const subscriptionData = await subscriptionResponse.json();
    const purchaseData = await purchaseResponse.json();
    const subscriptionsConnection = subscriptionData.data?.appInstallation?.allSubscriptions;
    const subscriptions = subscriptionsConnection?.edges?.map((edge: { node: unknown }) => edge.node) || [];
    const purchasesConnection = purchaseData.data?.appInstallation?.oneTimePurchases;
    const purchases = purchasesConnection?.edges?.map((edge: { node: unknown }) => edge.node) || [];
    const subscriptionItems = subscriptions.flatMap(
      (subscription: {
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
      }) => {
        const pricingEntries = (subscription.lineItems ?? [])
          .map((lineItem) => lineItem.plan?.pricingDetails?.price)
          .filter((price): price is { amount?: string; currencyCode?: string } => Boolean(price));
        const amount = pricingEntries.reduce((sum, price) => {
          const parsed = parseFloat(price.amount || "0");
          return Number.isFinite(parsed) ? sum + parsed : sum;
        }, 0);
        return [
          {
            id: subscription.id,
            type: "subscription",
            name: subscription.name,
            status: subscription.status,
            amount: pricingEntries.length > 0 ? amount : undefined,
            currency: pricingEntries.find((entry) => entry.currencyCode)?.currencyCode,
            periodEnd: subscription.currentPeriodEnd,
          },
        ];
      }
    );
    const purchaseItems = purchases.map((purchase: {
      id: string;
      name: string;
      status: string;
      price?: { amount?: string; currencyCode?: string };
      createdAt?: string;
    }) => ({
      id: purchase.id,
      type: "one_time",
      name: purchase.name,
      status: purchase.status,
      amount: purchase.price ? parseFloat(purchase.price.amount || "0") : undefined,
      currency: purchase.price?.currencyCode,
      createdAt: purchase.createdAt,
    }));
    return [...subscriptionItems, ...purchaseItems];
  } catch (error) {
    logger.error("Get billing history error", error);
    return [];
  }
}

export async function createSubscription(
  admin: AdminGraphQL,
  shopDomain: string,
  planId: PlanId,
  returnUrl: string,
  isTest = false
): Promise<SubscriptionResult> {
  const plan = BILLING_PLANS[planId];
  if (!plan || planId === "free") {
    return { success: false, error: "Invalid plan selected" };
  }
  try {
    const now = new Date();
    const pendingAttempt = await prisma.billingAttempt.findFirst({
      where: {
        shopDomain,
        planId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: {
        confirmationUrl: true,
        subscriptionId: true,
      },
    });
    if (pendingAttempt) {
      return {
        success: true,
        confirmationUrl: pendingAttempt.confirmationUrl,
        subscriptionId: pendingAttempt.subscriptionId ?? undefined,
      };
    }

    const currentStatus = await getSubscriptionStatus(admin, shopDomain);
    const currentPlan = currentStatus.plan;
    const hasCurrentPlanEntitlement =
      currentPlan === planId &&
      (
        currentStatus.hasActiveSubscription ||
        (
          currentStatus.status === "CANCELLED" &&
          !!currentStatus.currentPeriodEnd &&
          new Date(currentStatus.currentPeriodEnd).getTime() > Date.now()
        )
      );
    if (hasCurrentPlanEntitlement) {
      return { success: false, error: "You are already on this plan. No need to subscribe again." };
    }

    const planInfo = await getShopPlan(admin as AdminApiContext);
    const testMode =
      isTest ||
      planInfo?.partnerDevelopment === true;
    const isUpgrade = isHigherTier(planId, currentPlan);
    const replacementBehavior = isUpgrade ? "APPLY_IMMEDIATELY" : "APPLY_ON_NEXT_BILLING_CYCLE";

    const response = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
      variables: {
        name: `Tracking Guardian - ${getPlanDisplayName(planId)}`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price.toFixed(2), currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
        returnUrl,
        trialDays: ("trialDays" in plan ? plan.trialDays : 0) || 0,
        test: testMode,
        replacementBehavior,
      },
    });
    const data = await response.json();
    const result = data.data?.appSubscriptionCreate;
    logger.info("Subscription create response", {
      shopDomain,
      planId,
      testMode,
      confirmationUrl: result?.confirmationUrl ?? null,
      userErrors: result?.userErrors ?? [],
    });
    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`Billing API error: ${errorMessage}`);
      let friendlyError = errorMessage;
      if (errorMessage.includes("Apps without a public distribution cannot use the Billing API")) {
        friendlyError = "The app has not been publicly distributed on the Shopify App Store and cannot use billing features. Please contact the developer or wait for the app to be published.";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError = "The app must be publicly distributed to use billing features.";
      } else if (errorMessage.includes("test mode") || errorMessage.includes("test subscription")) {
        friendlyError = "Cannot create a real subscription in test mode.";
      }
      return { success: false, error: friendlyError };
    }
    if (result?.confirmationUrl) {
      const allowedDomains = [
        "admin.shopify.com",
        "myshopify.com",
        "partners.shopify.com",
        "shopify.com",
        shopDomain,
      ];
      const validation = assertSafeRedirect(result.confirmationUrl, allowedDomains);
      if (!validation.valid) {
        logger.error(`Invalid confirmationUrl: ${validation.error}`, {
          shopDomain,
          confirmationUrl: result.confirmationUrl,
        });
        return { success: false, error: validation.error || "Invalid confirmation URL" };
      }
      
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });
      const attemptExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await prisma.billingAttempt.create({
        data: {
          shopId: shop?.id ?? null,
          shopDomain,
          planId,
          subscriptionId: result.appSubscription?.id ?? null,
          confirmationUrl: result.confirmationUrl,
          status: "PENDING",
          expiresAt: attemptExpiresAt,
        },
      });
      if (shop) {
        await createAuditLog({
          shopId: shop.id,
          actorType: "user",
          actorId: shopDomain,
          action: "subscription_created",
          resourceType: "billing",
          resourceId: result.appSubscription?.id || "unknown",
          metadata: { planId, price: plan.price },
        });
      }
      return {
        success: true,
        confirmationUrl: result.confirmationUrl,
        subscriptionId: result.appSubscription?.id,
      };
    }
    return { success: false, error: "Failed to create subscription" };
  } catch (error) {
    logger.error("Subscription creation error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getSubscriptionStatus(
  admin: AdminGraphQL,
  shopDomain: string
): Promise<SubscriptionStatus> {
  try {
    const subscriptions = await getAllSubscriptions(admin);
    
    const now = new Date();
    const derived = deriveEffectivePlan(subscriptions as SubscriptionNode[], now);
    
    if (!derived.effectiveSubscription) {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true, entitledUntil: true },
      });
      const effectivePlan = resolveEffectivePlan(shop?.plan, shop?.entitledUntil, now);
      const hasEntitlement =
        effectivePlan !== "free" &&
        (!shop?.entitledUntil || shop.entitledUntil > now);
      return {
        hasActiveSubscription: false,
        plan: effectivePlan,
        hasEntitlement,
        entitledUntil: shop?.entitledUntil ? shop.entitledUntil.toISOString() : undefined,
      };
    }
    
    const subscription = derived.effectiveSubscription;
    let isTrialing = false;
    let trialDaysRemaining = 0;
    
    if (subscription.status === "ACTIVE" && subscription.trialDays && subscription.trialDays > 0 && subscription.createdAt) {
      const createdAt = new Date(subscription.createdAt);
      const trialEnd = new Date(createdAt.getTime() + subscription.trialDays * 24 * 60 * 60 * 1000);
      
      isTrialing = now < trialEnd;
      if (isTrialing) {
        trialDaysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      }
    }
    
    return {
      hasActiveSubscription: derived.hasActiveSubscription && subscription.status === "ACTIVE",
      hasEntitlement: derived.hasEntitlement,
      plan: derived.plan,
      subscriptionId: subscription.id,
      status: subscription.status,
      trialDays: subscription.trialDays,
      trialDaysRemaining,
      currentPeriodEnd: subscription.currentPeriodEnd,
      isTrialing,
      entitledUntil: derived.entitledUntil ? derived.entitledUntil.toISOString() : undefined,
    };
  } catch (error) {
    logger.error("Get subscription status error", error);
    const now = new Date();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { plan: true, entitledUntil: true },
    });
    const effectivePlan = resolveEffectivePlan(shop?.plan, shop?.entitledUntil, now);
    const hasEntitlement =
      effectivePlan !== "free" &&
      (!shop?.entitledUntil || shop.entitledUntil > now);
    return {
      hasActiveSubscription: false,
      hasEntitlement,
      plan: effectivePlan,
      entitledUntil: shop?.entitledUntil ? shop.entitledUntil.toISOString() : undefined,
    };
  }
}

export async function cancelSubscription(
  admin: AdminGraphQL,
  shopDomain: string,
  subscriptionId: string
): Promise<CancelResult> {
  try {
    const subscriptions = await getAllSubscriptions(admin);
    const candidateIds = subscriptionId.startsWith("gid://")
      ? [subscriptionId]
      : [subscriptionId, `gid://shopify/AppSubscription/${subscriptionId}`];
    const targetSubscription = subscriptions.find((sub) =>
      candidateIds.includes(sub.id) || (!subscriptionId.startsWith("gid://") && sub.id.endsWith(`/${subscriptionId}`))
    );

    if (!targetSubscription) {
      return {
        success: false,
        error: "Subscription not found",
      };
    }

    if (targetSubscription.status !== "ACTIVE") {
      return {
        success: false,
        error: `Cannot cancel subscription: current status is ${targetSubscription.status}. Only active subscriptions can be cancelled.`,
      };
    }

    const response = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: targetSubscription.id },
    });
    const data = await response.json();
    const result = data.data?.appSubscriptionCancel;
    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { success: false, error: errorMessage };
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (shop && targetSubscription.currentPeriodEnd) {
      const entitledUntil = new Date(targetSubscription.currentPeriodEnd);
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          entitledUntil,
        },
      });
      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: shopDomain,
        action: "subscription_cancelled",
        resourceType: "billing",
          resourceId: targetSubscription.id,
          metadata: { entitledUntil: targetSubscription.currentPeriodEnd },
      });
    } else if (shop) {
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: "free",
          monthlyOrderLimit: BILLING_PLANS.free.monthlyOrderLimit,
        },
      });
      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: shopDomain,
        action: "subscription_cancelled",
        resourceType: "billing",
          resourceId: targetSubscription.id,
        metadata: {},
      });
    }
    await syncSubscriptionStatus(admin, shopDomain);
    return { success: true };
  } catch (error) {
    logger.error("Cancel subscription error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function syncSubscriptionStatus(
  admin: AdminGraphQL,
  shopDomain: string
): Promise<void> {
  try {
    const subscriptions = await getAllSubscriptions(admin);
    
    const now = new Date();
    const derived = deriveEffectivePlan(subscriptions as SubscriptionNode[], now);

    if (!derived.effectiveSubscription) {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true, entitledUntil: true },
      });
      if (shop?.entitledUntil && shop.entitledUntil > now) {
        return;
      }
      const planConfig = BILLING_PLANS.free;
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: "free",
          monthlyOrderLimit: planConfig.monthlyOrderLimit,
          entitledUntil: null,
        },
      });
      return;
    }

    const plan = derived.plan;
    const planConfig = BILLING_PLANS[plan];

    await prisma.shop.update({
      where: { shopDomain },
      data: {
        plan,
        monthlyOrderLimit: planConfig.monthlyOrderLimit,
        entitledUntil: derived.entitledUntil,
      },
    });
  } catch (error) {
    logger.error("Sync subscription status error", error);
  }
}

export async function handleSubscriptionConfirmation(
  admin: AdminGraphQL,
  shopDomain: string,
  chargeId: string
): Promise<ConfirmationResult> {
  try {
    const response = await admin.graphql(GET_SUBSCRIPTION_QUERY);
    const data = await response.json();
    const subscriptionsConnection = data.data?.appInstallation?.allSubscriptions;
    const subscriptions = subscriptionsConnection?.edges?.map((edge: { node: unknown }) => edge.node) || [];
    
    const candidates = chargeId.startsWith("gid://")
      ? [chargeId]
      : [chargeId, `gid://shopify/AppSubscription/${chargeId}`];

    const matchingSubscription = subscriptions.find((sub: { id: string }) =>
      candidates.includes(sub.id) || (!chargeId.startsWith("gid://") && sub.id.endsWith(`/${chargeId}`))
    );
    
    if (!matchingSubscription) {
      return { success: false, error: "Subscription not found for charge_id" };
    }
    
    if (matchingSubscription.status !== "ACTIVE") {
      return {
        success: false,
        error: `Subscription status is ${matchingSubscription.status}. Please return to the Shopify billing page to confirm completion, or refresh the page later.`,
      };
    }

    const matchedPlanId = detectPlanFromSubscription(matchingSubscription as SubscriptionNode);
    await prisma.billingAttempt.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { subscriptionId: matchingSubscription.id },
          { shopDomain, planId: matchedPlanId },
        ],
      },
      data: { status: "CONFIRMED" },
    });
    
    await syncSubscriptionStatus(admin, shopDomain);
    
    const status = await getSubscriptionStatus(admin, shopDomain);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (shop) {
      await createAuditLog({
        shopId: shop.id,
        actorType: "system",
        actorId: "billing",
        action: "subscription_activated",
        resourceType: "billing",
        resourceId: chargeId,
        metadata: { plan: status.plan, subscriptionId: matchingSubscription.id },
      });
    }
    return { success: true, plan: status.plan };
  } catch (error) {
    logger.error("Subscription confirmation error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function createOneTimePurchase(
  admin: AdminGraphQL,
  shopDomain: string,
  planId: PlanId,
  returnUrl: string,
  isTest = false
): Promise<OneTimePurchaseResult> {
  const plan = BILLING_PLANS[planId];
  if (!plan || !("isOneTime" in plan) || !plan.isOneTime) {
    return { success: false, error: "This plan does not support one-time charges (all v1.0 plans are monthly subscriptions per PRD 11.1 requirements)." };
  }
  try {
    const planInfo = await getShopPlan(admin as AdminApiContext);
    const testMode =
      isTest ||
      planInfo?.partnerDevelopment === true;
    const response = await admin.graphql(CREATE_ONE_TIME_PURCHASE_MUTATION, {
      variables: {
        name: `Tracking Guardian - ${getPlanDisplayName(planId)} (One-time)`,
        price: {
          amount: plan.price.toFixed(2),
          currencyCode: "USD",
        },
        returnUrl,
        test: testMode,
      },
    });
    const data = await response.json();
    const result = data.data?.appPurchaseOneTimeCreate;
    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`One-time purchase API error: ${errorMessage}`);
      let friendlyError = errorMessage;
      if (errorMessage.includes("Apps without a public distribution cannot use the Billing API")) {
        friendlyError = "The app has not been publicly distributed on the Shopify App Store and cannot use billing features. Please contact the developer or wait for the app to be published.";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError = "The app must be publicly distributed to use billing features.";
      } else if (errorMessage.includes("test mode") || errorMessage.includes("test purchase")) {
        friendlyError = "Cannot create a real purchase in test mode.";
      }
      return { success: false, error: friendlyError };
    }
    if (result?.confirmationUrl) {
      const allowedDomains = [
        "admin.shopify.com",
        "myshopify.com",
        "partners.shopify.com",
        "shopify.com",
        shopDomain,
      ];
      const validation = assertSafeRedirect(result.confirmationUrl, allowedDomains);
      if (!validation.valid) {
        logger.error(`Invalid confirmationUrl: ${validation.error}`, {
          shopDomain,
          confirmationUrl: result.confirmationUrl,
        });
        return { success: false, error: validation.error || "Invalid confirmation URL" };
      }
      
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });
      if (shop) {
        await createAuditLog({
          shopId: shop.id,
          actorType: "user",
          actorId: shopDomain,
          action: "one_time_purchase_created",
          resourceType: "billing",
          resourceId: result.appPurchaseOneTime?.id || "unknown",
          metadata: { planId, price: plan.price },
        });
      }
      return {
        success: true,
        confirmationUrl: result.confirmationUrl,
        purchaseId: result.appPurchaseOneTime?.id,
      };
    }
    return { success: false, error: "Failed to create one-time purchase" };
  } catch (error) {
    logger.error("One-time purchase creation error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getOneTimePurchaseStatus(
  admin: AdminGraphQL,
  _shopDomain: string
): Promise<OneTimePurchaseStatus> {
  try {
    const response = await admin.graphql(GET_ONE_TIME_PURCHASES_QUERY);
    const data = await response.json();
    const purchasesConnection = data.data?.appInstallation?.oneTimePurchases;
    const purchases = purchasesConnection?.edges?.map((edge: { node: unknown }) => edge.node) || [];
    const activePurchase = purchases.find(
      (p: { status: string }) => p.status === "ACTIVE"
    );
    if (!activePurchase) {
      return { hasActivePurchase: false };
    }
    return {
      hasActivePurchase: true,
      purchaseId: activePurchase.id,
      status: activePurchase.status,
      price: parseFloat(activePurchase.price?.amount || "0"),
      createdAt: activePurchase.createdAt,
    };
  } catch (error) {
    logger.error("Get one-time purchase status error", error);
    return { hasActivePurchase: false };
  }
}

export async function handleOneTimePurchaseConfirmation(
  admin: AdminGraphQL,
  shopDomain: string,
  purchaseId: string
): Promise<ConfirmationResult> {
  try {
    const status = await getOneTimePurchaseStatus(admin, shopDomain);
    if (status.hasActivePurchase && status.purchaseId === purchaseId) {
      const planId: PlanId = "growth";
      const planConfig = BILLING_PLANS[planId];
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: planId,
          monthlyOrderLimit: planConfig.monthlyOrderLimit,
        },
      });
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });
      if (shop) {
        await createAuditLog({
          shopId: shop.id,
          actorType: "system",
          actorId: "billing",
          action: "one_time_purchase_activated",
          resourceType: "billing",
          resourceId: purchaseId,
          metadata: { plan: planId, price: status.price },
        });
      }
      return { success: true, plan: planId };
    }
    return { success: false, error: "One-time purchase not active" };
  } catch (error) {
    logger.error("One-time purchase confirmation error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
