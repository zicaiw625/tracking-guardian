/**
 * Shopify Billing API Service
 * 
 * P0-3: Implements subscription management for App Store compliance
 * 
 * Supports:
 * - Free trial (7 days)
 * - Monthly subscription plans
 * - Plan upgrades/downgrades
 * - Subscription status verification
 */

// Admin type for GraphQL operations
interface AdminGraphQL {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}
import prisma from "../db.server";
import { createAuditLog } from "./audit.server";

// Plan definitions
export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "免费版",
    price: 0,
    monthlyOrderLimit: 100,
    features: [
      "每月100笔订单追踪",
      "3个广告平台集成",
      "基础邮件警报",
      "7天数据保留",
    ],
  },
  starter: {
    id: "starter",
    name: "入门版",
    price: 9.99,
    monthlyOrderLimit: 1000,
    trialDays: 7,
    features: [
      "每月1,000笔订单追踪",
      "全部广告平台集成",
      "Slack + Telegram 警报",
      "30天数据保留",
      "基础对账报告",
    ],
  },
  pro: {
    id: "pro",
    name: "专业版",
    price: 29.99,
    monthlyOrderLimit: 10000,
    trialDays: 7,
    features: [
      "每月10,000笔订单追踪",
      "全部广告平台集成",
      "所有警报渠道",
      "90天数据保留",
      "高级对账报告",
      "优先技术支持",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "企业版",
    price: 99.99,
    monthlyOrderLimit: 100000,
    trialDays: 14,
    features: [
      "每月100,000笔订单追踪",
      "全部广告平台集成",
      "所有警报渠道",
      "无限数据保留",
      "专属客户成功经理",
      "自定义集成支持",
      "SLA保障",
    ],
  },
} as const;

export type PlanId = keyof typeof BILLING_PLANS;

// GraphQL mutation for creating subscription
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

// GraphQL query for getting current subscription
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

// GraphQL mutation for canceling subscription
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

interface SubscriptionResult {
  success: boolean;
  confirmationUrl?: string;
  subscriptionId?: string;
  error?: string;
}

interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  plan: PlanId;
  subscriptionId?: string;
  status?: string;
  trialDays?: number;
  currentPeriodEnd?: string;
  isTrialing?: boolean;
}

/**
 * Create a new subscription for the shop
 */
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
      const errorMessage = result.userErrors.map((e: { message: string }) => e.message).join(", ");
      console.error("Billing API error:", errorMessage);
      return { success: false, error: errorMessage };
    }

    if (result?.confirmationUrl) {
      // Log the subscription attempt
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
    console.error("Subscription creation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get current subscription status for a shop
 */
export async function getSubscriptionStatus(
  admin: AdminGraphQL,
  shopDomain: string
): Promise<SubscriptionStatus> {
  try {
    const response = await admin.graphql(GET_SUBSCRIPTION_QUERY);
    const data = await response.json();
    
    const subscriptions = data.data?.appInstallation?.activeSubscriptions || [];
    
    if (subscriptions.length === 0) {
      // No active subscription - check if shop has free plan in our DB
      const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { plan: true },
      });
      
      return {
        hasActiveSubscription: false,
        plan: (shop?.plan as PlanId) || "free",
      };
    }

    // Get the first active subscription
    const subscription = subscriptions[0];
    const price = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    
    // Determine plan from price
    let detectedPlan: PlanId = "free";
    if (price) {
      const priceNum = parseFloat(price);
      if (priceNum >= 99) detectedPlan = "enterprise";
      else if (priceNum >= 29) detectedPlan = "pro";
      else if (priceNum >= 9) detectedPlan = "starter";
    }

    const isTrialing = subscription.status === "ACTIVE" && 
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
    console.error("Get subscription status error:", error);
    return {
      hasActiveSubscription: false,
      plan: "free",
    };
  }
}

/**
 * Cancel an active subscription
 */
export async function cancelSubscription(
  admin: AdminGraphQL,
  shopDomain: string,
  subscriptionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: subscriptionId },
    });

    const data = await response.json();
    const result = data.data?.appSubscriptionCancel;

    if (result?.userErrors?.length > 0) {
      const errorMessage = result.userErrors.map((e: { message: string }) => e.message).join(", ");
      return { success: false, error: errorMessage };
    }

    // Update shop plan to free
    await prisma.shop.update({
      where: { shopDomain },
      data: { plan: "free", monthlyOrderLimit: BILLING_PLANS.free.monthlyOrderLimit },
    });

    // Log the cancellation
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
    console.error("Cancel subscription error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Verify and sync subscription status from Shopify to our database
 */
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

/**
 * P0-1: Get current year-month string in YYYY-MM format
 */
export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * P0-1: Get or create MonthlyUsage record for a shop
 */
export async function getOrCreateMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<{ id: string; sentCount: number }> {
  const ym = yearMonth || getCurrentYearMonth();
  
  const usage = await prisma.monthlyUsage.upsert({
    where: {
      shopId_yearMonth: { shopId, yearMonth: ym },
    },
    create: {
      shopId,
      yearMonth: ym,
      sentCount: 0,
    },
    update: {},
    select: { id: true, sentCount: true },
  });
  
  return usage;
}

/**
 * P0-1: Increment monthly usage count when an order is successfully sent
 * This should be called ONLY when CAPI is successfully sent to at least one platform
 * 
 * @param shopId - Shop ID
 * @param orderId - Order ID (for deduplication - we only count each order once)
 * @returns Updated sent count
 */
export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();
  
  // Use a transaction to ensure atomicity and prevent double-counting
  const result = await prisma.$transaction(async (tx) => {
    // Check if this order was already counted this month
    // We track via ConversionJob to avoid double counting
    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });
    
    // If job is already completed, don't increment again
    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return usage?.sentCount || 0;
    }
    
    // Increment usage
    const usage = await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: { shopId, yearMonth },
      },
      create: {
        shopId,
        yearMonth,
        sentCount: 1,
      },
      update: {
        sentCount: { increment: 1 },
      },
      select: { sentCount: true },
    });
    
    return usage.sentCount;
  });
  
  return result;
}

/**
 * P0-1: Check if shop has exceeded their monthly order limit
 * Uses MonthlyUsage table for accurate tracking (only counts successfully sent orders)
 */
export async function checkOrderLimit(
  shopId: string,
  shopPlan: PlanId
): Promise<{ exceeded: boolean; current: number; limit: number; remaining: number }> {
  const planConfig = BILLING_PLANS[shopPlan] || BILLING_PLANS.free;
  const limit = planConfig.monthlyOrderLimit;
  
  const usage = await getOrCreateMonthlyUsage(shopId);
  const current = usage.sentCount;
  
  return {
    exceeded: current >= limit,
    current,
    limit,
    remaining: Math.max(0, limit - current),
  };
}

/**
 * P0-1: Check billing gate before processing an order
 * Returns whether the order can be processed and why not if blocked
 */
export async function checkBillingGate(
  shopId: string,
  shopPlan: PlanId
): Promise<{
  allowed: boolean;
  reason?: "limit_exceeded" | "inactive_subscription";
  usage: { current: number; limit: number; remaining: number };
}> {
  const planConfig = BILLING_PLANS[shopPlan] || BILLING_PLANS.free;
  const limit = planConfig.monthlyOrderLimit;
  
  const usageRecord = await getOrCreateMonthlyUsage(shopId);
  const current = usageRecord.sentCount;
  const remaining = Math.max(0, limit - current);
  
  const usage = { current, limit, remaining };
  
  if (current >= limit) {
    return {
      allowed: false,
      reason: "limit_exceeded",
      usage,
    };
  }
  
  return {
    allowed: true,
    usage,
  };
}

/**
 * Handle subscription confirmation callback
 * Called when merchant returns from Shopify billing confirmation page
 */
export async function handleSubscriptionConfirmation(
  admin: AdminGraphQL,
  shopDomain: string,
  chargeId: string
): Promise<{ success: boolean; plan?: PlanId; error?: string }> {
  try {
    // Verify the subscription is active
    const status = await getSubscriptionStatus(admin, shopDomain);
    
    if (status.hasActiveSubscription) {
      // Update shop plan
      const planConfig = BILLING_PLANS[status.plan];
      await prisma.shop.update({
        where: { shopDomain },
        data: {
          plan: status.plan,
          monthlyOrderLimit: planConfig.monthlyOrderLimit,
        },
      });

      // Log the activation
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
    console.error("Subscription confirmation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
