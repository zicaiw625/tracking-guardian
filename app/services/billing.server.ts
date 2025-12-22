
interface AdminGraphQL {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}
import prisma from "../db.server";
import { createAuditLog } from "./audit.server";

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

    await prisma.shop.update({
      where: { shopDomain },
      data: { plan: "free", monthlyOrderLimit: BILLING_PLANS.free.monthlyOrderLimit },
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
    console.error("Cancel subscription error:", error);
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

export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

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

async function isOrderAlreadyCounted(
  shopId: string,
  orderId: string,
  yearMonth: string
): Promise<boolean> {
  
  const existingJob = await prisma.conversionJob.findUnique({
    where: { shopId_orderId: { shopId, orderId } },
    select: { status: true },
  });
  
  if (existingJob?.status === "completed") {
    return true;
  }

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

export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {

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

    if (sentLog) {
      const usage = await tx.monthlyUsage.findUnique({
        where: { shopId_yearMonth: { shopId, yearMonth } },
        select: { sentCount: true },
      });
      return { incremented: false, count: usage?.sentCount || 0 };
    }

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

export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<{ incremented: boolean; current: number }> {
  const yearMonth = getCurrentYearMonth();
  
  const result = await prisma.$transaction(async (tx) => {
    
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

    const usage = await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 1 },
      update: { sentCount: { increment: 1 } },
    });
    
    return { incremented: true, current: usage.sentCount };
  });
  
  return result;
}

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

export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<{ success: boolean; current: number; alreadyCounted: boolean }> {
  const yearMonth = getCurrentYearMonth();
  
  const result = await prisma.$transaction(async (tx) => {
    
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

    await tx.monthlyUsage.upsert({
      where: { shopId_yearMonth: { shopId, yearMonth } },
      create: { shopId, yearMonth, sentCount: 0 },
      update: {},
    });

    const updated = await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = "sentCount" + 1, "updatedAt" = NOW()
      WHERE "shopId" = ${shopId} 
        AND "yearMonth" = ${yearMonth}
        AND "sentCount" < ${limit}
    `;

    const finalUsage = await tx.monthlyUsage.findUnique({
      where: { shopId_yearMonth: { shopId, yearMonth } },
    });
    
    if (updated === 0) {
      
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

export async function handleSubscriptionConfirmation(
  admin: AdminGraphQL,
  shopDomain: string,
  chargeId: string
): Promise<{ success: boolean; plan?: PlanId; error?: string }> {
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
    console.error("Subscription confirmation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
