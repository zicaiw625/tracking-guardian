import prisma from "../../db.server";
import { createAuditLog } from "../audit.server";
import { logger } from "../../utils/logger.server";
import { assertSafeRedirect } from "../../utils/redirect-validation.server";
import {
  BILLING_PLANS,
  type PlanId,
  getPlanDisplayName,
  isHigherTier,
} from "./plans";
import { resolveEffectivePlan } from "./effective-plan.server";
import { getShopPlan } from "../shop-tier.server";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type {
  AdminGraphQL,
  BillingHistoryItem,
  BillingHistorySubscriptionNode,
  CancelResult,
  ConfirmationResult,
  OneTimePurchaseNode,
  OneTimePurchaseResult,
  OneTimePurchaseStatus,
  SubscriptionResult,
  SubscriptionStatus,
  SubscriptionNode,
} from "./subscription.types";
import {
  adminGraphqlOrThrow,
  getAllSubscriptions,
  GET_SUBSCRIPTION_QUERY,
  GET_ONE_TIME_PURCHASES_QUERY,
  CREATE_SUBSCRIPTION_MUTATION,
  CANCEL_SUBSCRIPTION_MUTATION,
  CREATE_ONE_TIME_PURCHASE_MUTATION,
} from "./subscription-graphql.server";
import {
  deriveEffectivePlan,
  detectPlanFromSubscription,
  parseDateMs,
  parseDate,
} from "./subscription-derive.server";

export function getConfirmationUrlAllowedDomains(shopDomain: string): string[] {
  return [
    "admin.shopify.com",
    "myshopify.com",
    "partners.shopify.com",
    "shopify.com",
    shopDomain,
  ];
}

function subscriptionStatusFromShop(
  shop: { plan: string | null; entitledUntil: Date | null } | null,
  now: Date
): SubscriptionStatus {
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

export async function getBillingHistory(
  admin: AdminGraphQL
): Promise<BillingHistoryItem[]> {
  try {
    const [subscriptionData, purchaseData] = await Promise.all([
      adminGraphqlOrThrow<{
        appInstallation?: {
          allSubscriptions?: { edges?: Array<{ node: unknown }> };
        };
      }>(admin, GET_SUBSCRIPTION_QUERY, undefined, "GET_SUBSCRIPTION_QUERY"),
      adminGraphqlOrThrow<{
        appInstallation?: {
          oneTimePurchases?: { edges?: Array<{ node: unknown }> };
        };
      }>(
        admin,
        GET_ONE_TIME_PURCHASES_QUERY,
        undefined,
        "GET_ONE_TIME_PURCHASES_QUERY"
      ),
    ]);
    const subscriptionsConnection =
      subscriptionData.appInstallation?.allSubscriptions;
    const subscriptions =
      subscriptionsConnection?.edges?.map(
        (edge: { node: unknown }) => edge.node as BillingHistorySubscriptionNode
      ) || [];
    const purchasesConnection = purchaseData.appInstallation?.oneTimePurchases;
    const purchases =
      purchasesConnection?.edges?.map(
        (edge: { node: unknown }) => edge.node as OneTimePurchaseNode
      ) || [];
    const subscriptionItems: BillingHistoryItem[] = subscriptions.flatMap(
      (subscription: BillingHistorySubscriptionNode) => {
        const pricingEntries = (subscription.lineItems ?? [])
          .map((lineItem) => lineItem.plan?.pricingDetails?.price)
          .filter(
            (price): price is { amount?: string; currencyCode?: string } =>
              Boolean(price)
          );
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
            currency: pricingEntries.find((entry) => entry.currencyCode)
              ?.currencyCode,
            periodEnd: subscription.currentPeriodEnd,
          },
        ];
      }
    );
    const purchaseItems: BillingHistoryItem[] = purchases.map(
      (purchase: OneTimePurchaseNode) => ({
        id: purchase.id,
        type: "one_time",
        name: purchase.name,
        status: purchase.status,
        amount: purchase.price
          ? parseFloat(purchase.price.amount || "0")
          : undefined,
        currency: purchase.price?.currencyCode,
        createdAt: purchase.createdAt,
      })
    );
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
      (currentStatus.hasActiveSubscription ||
        (currentStatus.status === "CANCELLED" &&
          !!currentStatus.currentPeriodEnd &&
          (parseDateMs(currentStatus.currentPeriodEnd) ?? 0) > Date.now()));
    if (hasCurrentPlanEntitlement) {
      return {
        success: false,
        error: "You are already on this plan. No need to subscribe again.",
      };
    }

    const planInfo = await getShopPlan(admin as AdminApiContext);
    const testMode = isTest || planInfo?.partnerDevelopment === true;
    const isUpgrade = isHigherTier(planId, currentPlan);
    const replacementBehavior = isUpgrade
      ? "APPLY_IMMEDIATELY"
      : "APPLY_ON_NEXT_BILLING_CYCLE";

    const data = await adminGraphqlOrThrow<{
      appSubscriptionCreate?: {
        appSubscription?: { id?: string };
        confirmationUrl?: string;
        userErrors?: Array<{ message: string }>;
      };
    }>(
      admin,
      CREATE_SUBSCRIPTION_MUTATION,
      {
        variables: {
          name: `Tracking Guardian - ${getPlanDisplayName(planId)}`,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: {
                    amount: plan.price.toFixed(2),
                    currencyCode: "USD",
                  },
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
      },
      "CREATE_SUBSCRIPTION_MUTATION"
    );
    const result = data.appSubscriptionCreate;
    if (!result) {
      return { success: false, error: "Invalid subscription create response" };
    }
    logger.info("Subscription create response", {
      shopDomain,
      planId,
      testMode,
      confirmationUrl: result?.confirmationUrl ?? null,
      userErrors: result?.userErrors ?? [],
    });
    if ((result.userErrors ?? []).length > 0) {
      const errorMessage = (result.userErrors ?? [])
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`Billing API error: ${errorMessage}`);
      let friendlyError = errorMessage;
      if (
        errorMessage.includes(
          "Apps without a public distribution cannot use the Billing API"
        )
      ) {
        friendlyError =
          "The app has not been publicly distributed on the Shopify App Store and cannot use billing features. Please contact the developer or wait for the app to be published.";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError =
          "The app must be publicly distributed to use billing features.";
      } else if (
        errorMessage.includes("test mode") ||
        errorMessage.includes("test subscription")
      ) {
        friendlyError =
          "Cannot create a real subscription in test mode.";
      }
      return { success: false, error: friendlyError };
    }
    if (result.confirmationUrl) {
      const allowedDomains = getConfirmationUrlAllowedDomains(shopDomain);
      const validation = assertSafeRedirect(
        result.confirmationUrl,
        allowedDomains
      );
      if (!validation.valid) {
        logger.error(`Invalid confirmationUrl: ${validation.error}`, {
          shopDomain,
          confirmationUrl: result.confirmationUrl,
        });
        return {
          success: false,
          error: validation.error || "Invalid confirmation URL",
        };
      }

      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });
      const attemptExpiresAt = new Date(
        Date.now() + 48 * 60 * 60 * 1000
      );
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
    const derived = deriveEffectivePlan(subscriptions, now);

    if (!derived.effectiveSubscription) {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true, entitledUntil: true },
      });
      return subscriptionStatusFromShop(shop, now);
    }

    const subscription = derived.effectiveSubscription;
    let isTrialing = false;
    let trialDaysRemaining: number | undefined;

    if (
      subscription.status === "ACTIVE" &&
      subscription.trialDays &&
      subscription.trialDays > 0
    ) {
      const confirmedAttempt = await prisma.billingAttempt.findFirst({
        where: {
          shopDomain,
          status: "CONFIRMED",
          OR: [
            { subscriptionId: subscription.id },
            { planId: derived.plan },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: { confirmedAt: true },
      });
      if (confirmedAttempt?.confirmedAt) {
        const trialEndMs =
          confirmedAttempt.confirmedAt.getTime() +
          subscription.trialDays * 24 * 60 * 60 * 1000;
        isTrialing = now.getTime() < trialEndMs;
        if (isTrialing) {
          trialDaysRemaining = Math.ceil(
            (trialEndMs - now.getTime()) / (24 * 60 * 60 * 1000)
          );
        }
      }
    }

    return {
      hasActiveSubscription:
        derived.hasActiveSubscription && subscription.status === "ACTIVE",
      hasEntitlement: derived.hasEntitlement,
      plan: derived.plan,
      subscriptionId: subscription.id,
      status: subscription.status,
      trialDays: subscription.trialDays,
      trialDaysRemaining,
      currentPeriodEnd: subscription.currentPeriodEnd,
      isTrialing,
      entitledUntil: derived.entitledUntil
        ? derived.entitledUntil.toISOString()
        : undefined,
    };
  } catch (error) {
    logger.error("Get subscription status error", error);
    const now = new Date();
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { plan: true, entitledUntil: true },
    });
    return subscriptionStatusFromShop(shop, now);
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
      : [
          subscriptionId,
          `gid://shopify/AppSubscription/${subscriptionId}`,
        ];
    const targetSubscription = subscriptions.find(
      (sub) =>
        candidateIds.includes(sub.id) ||
        (!subscriptionId.startsWith("gid://") &&
          sub.id.endsWith(`/${subscriptionId}`))
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

    const data = await adminGraphqlOrThrow<{
      appSubscriptionCancel?: {
        userErrors?: Array<{ message: string }>;
      };
    }>(
      admin,
      CANCEL_SUBSCRIPTION_MUTATION,
      { variables: { id: targetSubscription.id } },
      "CANCEL_SUBSCRIPTION_MUTATION"
    );
    const result = data.appSubscriptionCancel;
    if (!result) {
      return { success: false, error: "Invalid subscription cancel response" };
    }
    if ((result.userErrors ?? []).length > 0) {
      const errorMessage = (result.userErrors ?? [])
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { success: false, error: errorMessage };
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (shop && targetSubscription.currentPeriodEnd) {
      const entitledUntil = parseDate(targetSubscription.currentPeriodEnd);
      if (entitledUntil) {
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
      } else {
        logger.warn("Invalid currentPeriodEnd while cancelling subscription", {
          shopDomain,
          subscriptionId: targetSubscription.id,
          currentPeriodEnd: targetSubscription.currentPeriodEnd,
        });
      }
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
    const derived = deriveEffectivePlan(subscriptions, now);

    if (!derived.effectiveSubscription) {
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true, entitledUntil: true },
      });
      if (shop?.entitledUntil && shop.entitledUntil > now) {
        await prisma.shop.update({
          where: { shopDomain },
          data: { billingLastSyncedAt: now },
        });
        return;
      }
      const planConfig = BILLING_PLANS.free;
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: "free",
          monthlyOrderLimit: planConfig.monthlyOrderLimit,
          entitledUntil: null,
          billingLastSyncedAt: now,
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
        billingLastSyncedAt: now,
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
    const data = await adminGraphqlOrThrow<{
      appInstallation?: {
        allSubscriptions?: { edges?: Array<{ node: unknown }> };
      };
    }>(admin, GET_SUBSCRIPTION_QUERY, undefined, "GET_SUBSCRIPTION_QUERY");
    const subscriptionsConnection = data.appInstallation?.allSubscriptions;
    const subscriptions: SubscriptionNode[] =
      subscriptionsConnection?.edges?.map(
        (edge: { node: unknown }) => edge.node as SubscriptionNode
      ) || [];

    const candidates = chargeId.startsWith("gid://")
      ? [chargeId]
      : [chargeId, `gid://shopify/AppSubscription/${chargeId}`];

    const matchingSubscription = subscriptions.find(
      (sub) =>
        candidates.includes(sub.id) ||
        (!chargeId.startsWith("gid://") && sub.id.endsWith(`/${chargeId}`))
    );

    if (!matchingSubscription) {
      return { success: false, error: "Subscription not found for charge_id" };
    }

    if (matchingSubscription.status !== "ACTIVE") {
      const status = matchingSubscription.status;
      if (status === "PENDING" || status === "ACCEPTED") {
        return {
          success: false,
          pending: true,
          status,
        };
      }
      return {
        success: false,
        status,
        error: `Subscription status is ${status}. Please return to the Shopify billing page to confirm completion, or refresh the page later.`,
      };
    }

    const matchedPlanId = detectPlanFromSubscription(matchingSubscription);
    await prisma.billingAttempt.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { subscriptionId: matchingSubscription.id },
          { shopDomain, planId: matchedPlanId },
        ],
      },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
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
        metadata: {
          plan: status.plan,
          subscriptionId: matchingSubscription.id,
        },
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
  if (
    !plan ||
    !("isOneTime" in plan) ||
    !plan.isOneTime
  ) {
    return {
      success: false,
      error:
        "This plan does not support one-time charges (all v1.0 plans are monthly subscriptions per PRD 11.1 requirements).",
    };
  }
  try {
    const planInfo = await getShopPlan(admin as AdminApiContext);
    const testMode = isTest || planInfo?.partnerDevelopment === true;
    const data = await adminGraphqlOrThrow<{
      appPurchaseOneTimeCreate?: {
        appPurchaseOneTime?: { id?: string };
        confirmationUrl?: string;
        userErrors?: Array<{ message: string }>;
      };
    }>(
      admin,
      CREATE_ONE_TIME_PURCHASE_MUTATION,
      {
        variables: {
          name: `Tracking Guardian - ${getPlanDisplayName(planId)} (One-time)`,
          price: {
            amount: plan.price.toFixed(2),
            currencyCode: "USD",
          },
          returnUrl,
          test: testMode,
        },
      },
      "CREATE_ONE_TIME_PURCHASE_MUTATION"
    );
    const result = data.appPurchaseOneTimeCreate;
    if (!result) {
      return { success: false, error: "Invalid one-time purchase response" };
    }
    if ((result.userErrors ?? []).length > 0) {
      const errorMessage = (result.userErrors ?? [])
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`One-time purchase API error: ${errorMessage}`);
      let friendlyError = errorMessage;
      if (
        errorMessage.includes(
          "Apps without a public distribution cannot use the Billing API"
        )
      ) {
        friendlyError =
          "The app has not been publicly distributed on the Shopify App Store and cannot use billing features. Please contact the developer or wait for the app to be published.";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError =
          "The app must be publicly distributed to use billing features.";
      } else if (
        errorMessage.includes("test mode") ||
        errorMessage.includes("test purchase")
      ) {
        friendlyError = "Cannot create a real purchase in test mode.";
      }
      return { success: false, error: friendlyError };
    }
    if (result.confirmationUrl) {
      const allowedDomains = getConfirmationUrlAllowedDomains(shopDomain);
      const validation = assertSafeRedirect(
        result.confirmationUrl,
        allowedDomains
      );
      if (!validation.valid) {
        logger.error(`Invalid confirmationUrl: ${validation.error}`, {
          shopDomain,
          confirmationUrl: result.confirmationUrl,
        });
        return {
          success: false,
          error: validation.error || "Invalid confirmation URL",
        };
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
    const data = await adminGraphqlOrThrow<{
      appInstallation?: {
        oneTimePurchases?: { edges?: Array<{ node: unknown }> };
      };
    }>(
      admin,
      GET_ONE_TIME_PURCHASES_QUERY,
      undefined,
      "GET_ONE_TIME_PURCHASES_QUERY"
    );
    const purchasesConnection = data.appInstallation?.oneTimePurchases;
    const purchases =
      purchasesConnection?.edges?.map(
        (edge: { node: unknown }) => edge.node as OneTimePurchaseNode
      ) || [];
    const activePurchase = purchases.find((p) => p.status === "ACTIVE");
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
