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
 * P0-5: Check if an order has already been counted for usage this month
 * Uses ConversionLog.serverSideSent as the indicator that an order was successfully sent
 * 
 * @param shopId - Shop ID
 * @param orderId - Order ID
 * @param yearMonth - Year-month string (YYYY-MM)
 * @returns true if order was already counted
 */
async function isOrderAlreadyCounted(
  shopId: string,
  orderId: string,
  yearMonth: string
): Promise<boolean> {
  // First check ConversionJob if it exists
  const existingJob = await prisma.conversionJob.findUnique({
    where: { shopId_orderId: { shopId, orderId } },
    select: { status: true },
  });
  
  if (existingJob?.status === "completed") {
    return true;
  }
  
  // Fallback: Check if any ConversionLog for this order has serverSideSent=true
  // and was created in the current month
  const startOfMonth = new Date(`${yearMonth}-01T00:00:00.000Z`);
  const endOfMonth = new Date(startOfMonth);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1);
  
  const sentLog = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      serverSideSent: true,
      sentAt: {
        gte: startOfMonth,
        lt: endOfMonth,
      },
    },
    select: { id: true },
  });
  
  return !!sentLog;
}

/**
 * P0-1 & P0-5: Increment monthly usage count when an order is successfully sent
 * 
 * IMPORTANT: This is idempotent - each order is only counted ONCE per month,
 * regardless of how many platforms it was sent to.
 * 
 * @param shopId - Shop ID
 * @param orderId - Order ID (for deduplication - we only count each order once)
 * @returns Object with incremented flag and current count
 */
export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();
  
  // Use a transaction to ensure atomicity and prevent double-counting
  const result = await prisma.$transaction(async (tx) => {
    // P0-5: Check if this order was already counted this month
    // First check ConversionJob if it exists
    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });
    
    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return { incremented: false, count: usage?.sentCount || 0 };
    }
    
    // Fallback: Check if any ConversionLog for this order has serverSideSent=true
    const startOfMonth = new Date(`${yearMonth}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    
    const sentLog = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        serverSideSent: true,
        sentAt: {
          gte: startOfMonth,
          lt: endOfMonth,
        },
      },
      select: { id: true },
    });
    
    // If already sent, don't increment
    if (sentLog) {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return { incremented: false, count: usage?.sentCount || 0 };
    }
    
    // Increment usage - this is the first successful send for this order
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
    
    return { incremented: true, count: usage.sentCount };
  });
  
  if (result.incremented) {
    console.log(`Usage incremented for shop ${shopId}, order ${orderId}: ${result.count}`);
  }
  
  return result.count;
}

/**
 * P0-5: Idempotent version that explicitly returns whether increment happened
 * Use this when you need to know if this was the first successful send
 */
export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<{ incremented: boolean; current: number }> {
  const yearMonth = getCurrentYearMonth();
  
  const result = await prisma.$transaction(async (tx) => {
    // Check ConversionJob first
    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });
    
    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { incremented: false, current: usage?.sentCount || 0 };
    }
    
    // Check ConversionLog fallback
    const startOfMonth = new Date(`${yearMonth}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    
    const sentLog = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        serverSideSent: true,
        sentAt: { gte: startOfMonth, lt: endOfMonth },
      },
      select: { id: true },
    });
    
    if (sentLog) {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { incremented: false, current: usage?.sentCount || 0 };
    }
    
    // Increment usage
    const usage = await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 1 },
      update: { sentCount: { increment: 1 } },
    });
    
    return { incremented: true, current: usage.sentCount };
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
 * P0-12: Atomic usage increment with limit check
 * 
 * This function prevents concurrent "overselling" by combining the
 * limit check and increment into a single atomic transaction.
 * 
 * Uses a conditional UPDATE to ensure sentCount never exceeds limit:
 * - If sentCount < limit, increment and return success
 * - If sentCount >= limit, return failure without incrementing
 * 
 * @param shopId - Shop ID
 * @param orderId - Order ID (for idempotency)
 * @param limit - Maximum allowed count
 * @returns { success: true, current } if increment succeeded
 * @returns { success: false, current } if limit exceeded
 */
export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<{ success: boolean; current: number; alreadyCounted: boolean }> {
  const yearMonth = getCurrentYearMonth();
  
  const result = await prisma.$transaction(async (tx) => {
    // Step 1: Check if this order was already counted (idempotency)
    const existingJob = await tx.conversionJob.findUnique({
      where: { shopId_orderId: { shopId, orderId } },
      select: { status: true },
    });
    
    if (existingJob?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
      });
      return { success: true, current: usage?.sentCount || 0, alreadyCounted: true };
    }
    
    // Step 2: Ensure usage record exists
    await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 0 },
      update: {},
    });
    
    // Step 3: Atomic conditional update
    // This raw query ensures we only increment if under limit
    const updated = await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = "sentCount" + 1, "updatedAt" = NOW()
      WHERE "shopId" = ${shopId} 
        AND "yearMonth" = ${yearMonth}
        AND "sentCount" < ${limit}
    `;
    
    // Step 4: Get final count
    const finalUsage = await tx.monthlyUsage.findUnique({
      where: { shopId_yearMonth: { shopId, yearMonth } },
    });
    
    if (updated === 0) {
      // Either no record (shouldn't happen) or limit exceeded
      return { 
        success: false, 
        current: finalUsage?.sentCount || 0, 
        alreadyCounted: false 
      };
    }
    
    return { 
      success: true, 
      current: finalUsage?.sentCount || 1, 
      alreadyCounted: false 
    };
  });
  
  return result;
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
