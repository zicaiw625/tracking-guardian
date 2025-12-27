

import prisma from "../../db.server";
import { createAuditLog } from "../audit.server";
import { logger } from "../../utils/logger.server";
import { BILLING_PLANS, type PlanId, detectPlanFromPrice } from "./plans";

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
  plan: PlanId;
  subscriptionId?: string;
  status?: string;
  trialDays?: number;
  currentPeriodEnd?: string;
  isTrialing?: boolean;
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

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
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
      activeSubscriptions {
        id
        name
        status
        trialDays
        currentPeriodEnd
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
    const response = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
      variables: {
        name: `Tracking Guardian - ${plan.name}`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
        returnUrl,
        trialDays: ("trialDays" in plan ? plan.trialDays : 0) || 0,
        test: isTest || process.env.NODE_ENV !== "production",
      },
    });

    const data = await response.json();
    const result = data.data?.appSubscriptionCreate;

    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`Billing API error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    if (result?.confirmationUrl) {

      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
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
    const response = await admin.graphql(GET_SUBSCRIPTION_QUERY);
    const data = await response.json();
    const subscriptions = data.data?.appInstallation?.activeSubscriptions || [];

    if (subscriptions.length === 0) {

      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true },
      });

      return {
        hasActiveSubscription: false,
        plan: (shop?.plan as PlanId) || "free",
      };
    }

    const subscription = subscriptions[0];
    const price = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const detectedPlan = price ? detectPlanFromPrice(parseFloat(price)) : "free";

    const isTrialing =
      subscription.status === "ACTIVE" &&
      subscription.trialDays > 0 &&
      new Date(subscription.currentPeriodEnd) > new Date();

    return {
      hasActiveSubscription: subscription.status === "ACTIVE",
      plan: detectedPlan,
      subscriptionId: subscription.id,
      status: subscription.status,
      trialDays: subscription.trialDays,
      currentPeriodEnd: subscription.currentPeriodEnd,
      isTrialing,
    };
  } catch (error) {
    logger.error("Get subscription status error", error);
    return {
      hasActiveSubscription: false,
      plan: "free",
    };
  }
}

export async function cancelSubscription(
  admin: AdminGraphQL,
  shopDomain: string,
  subscriptionId: string
): Promise<CancelResult> {
  try {
    const response = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: subscriptionId },
    });

    const data = await response.json();
    const result = data.data?.appSubscriptionCancel;

    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      return { success: false, error: errorMessage };
    }

    await prisma.shop.update({
      where: { shopDomain },
      data: {
        plan: "free",
        monthlyOrderLimit: BILLING_PLANS.free.monthlyOrderLimit,
      },
    });

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (shop) {
      await createAuditLog({
        shopId: shop.id,
        actorType: "user",
        actorId: shopDomain,
        action: "subscription_cancelled",
        resourceType: "billing",
        resourceId: subscriptionId,
        metadata: {},
      });
    }

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
  const status = await getSubscriptionStatus(admin, shopDomain);
  const plan = status.hasActiveSubscription ? status.plan : "free";
  const planConfig = BILLING_PLANS[plan];

  await prisma.shop.update({
    where: { shopDomain },
    data: {
      plan,
      monthlyOrderLimit: planConfig.monthlyOrderLimit,
    },
  });
}

export async function handleSubscriptionConfirmation(
  admin: AdminGraphQL,
  shopDomain: string,
  chargeId: string
): Promise<ConfirmationResult> {
  try {
    const status = await getSubscriptionStatus(admin, shopDomain);

    if (status.hasActiveSubscription) {
      const planConfig = BILLING_PLANS[status.plan];

      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: status.plan,
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
          action: "subscription_activated",
          resourceType: "billing",
          resourceId: chargeId,
          metadata: { plan: status.plan, isTrialing: status.isTrialing },
        });
      }

      return { success: true, plan: status.plan };
    }

    return { success: false, error: "Subscription not active" };
  } catch (error) {
    logger.error("Subscription confirmation error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

