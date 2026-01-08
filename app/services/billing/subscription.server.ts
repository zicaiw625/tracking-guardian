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
      oneTimePurchases(first: 250) {
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

    const subscriptions = subscriptionData.data?.appInstallation?.activeSubscriptions || [];
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
        const priceDetails = subscription.lineItems?.[0]?.plan?.pricingDetails?.price;
        return [
          {
            id: subscription.id,
            type: "subscription",
            name: subscription.name,
            status: subscription.status,
            amount: priceDetails ? parseFloat(priceDetails.amount || "0") : undefined,
            currency: priceDetails?.currencyCode,
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

  if (planId === "monitor") {
    return {
      success: false,
      error: "Monitor 计划不在 v1.0 正式套餐中。Monitor 是可选叠加功能，将在后续版本中作为独立附加服务提供。"
    };
  }

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
      
      // 将 Shopify 错误消息转换为更友好的中文提示
      let friendlyError = errorMessage;
      if (errorMessage.includes("Apps without a public distribution cannot use the Billing API")) {
        friendlyError = "应用尚未在 Shopify App Store 公开发布，无法使用计费功能。请联系开发者或等待应用发布。";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError = "应用需要公开发布才能使用计费功能。";
      } else if (errorMessage.includes("test mode") || errorMessage.includes("test subscription")) {
        friendlyError = "测试模式下无法创建真实订阅。";
      }
      
      return { success: false, error: friendlyError };
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

export async function createOneTimePurchase(
  admin: AdminGraphQL,
  shopDomain: string,
  planId: PlanId,
  returnUrl: string,
  isTest = false
): Promise<OneTimePurchaseResult> {
  const plan = BILLING_PLANS[planId];

  if (!plan || !("isOneTime" in plan) || !plan.isOneTime) {
    return { success: false, error: "此套餐不支持一次性收费（v1.0 中所有计划均为月付，符合 PRD 11.1 要求）" };
  }

  try {
    const response = await admin.graphql(CREATE_ONE_TIME_PURCHASE_MUTATION, {
      variables: {
        name: `Tracking Guardian - ${plan.name} (一次性)`,
        price: {
          amount: plan.price,
          currencyCode: "USD",
        },
        returnUrl,
        test: isTest || process.env.NODE_ENV !== "production",
      },
    });

    const data = await response.json();
    const result = data.data?.appPurchaseOneTimeCreate;

    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors
        .map((e: { message: string }) => e.message)
        .join(", ");
      logger.error(`One-time purchase API error: ${errorMessage}`);
      
      // 将 Shopify 错误消息转换为更友好的中文提示
      let friendlyError = errorMessage;
      if (errorMessage.includes("Apps without a public distribution cannot use the Billing API")) {
        friendlyError = "应用尚未在 Shopify App Store 公开发布，无法使用计费功能。请联系开发者或等待应用发布。";
      } else if (errorMessage.includes("public distribution")) {
        friendlyError = "应用需要公开发布才能使用计费功能。";
      } else if (errorMessage.includes("test mode") || errorMessage.includes("test purchase")) {
        friendlyError = "测试模式下无法创建真实购买。";
      }
      
      return { success: false, error: friendlyError };
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
  shopDomain: string
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
