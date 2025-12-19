/**
 * Billing Management Page
 * 
 * P0-3: Required for Shopify App Store compliance
 * 
 * Features:
 * - View current plan and usage
 * - Upgrade/downgrade plans
 * - Cancel subscription
 * - View billing history
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Box,
  Divider,
  Banner,
  ProgressBar,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  BILLING_PLANS,
  createSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  checkOrderLimit,
  handleSubscriptionConfirmation,
  type PlanId,
} from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Check for subscription confirmation callback
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  
  if (chargeId) {
    // Handle subscription confirmation
    await handleSubscriptionConfirmation(admin, shopDomain, chargeId);
    // Redirect to remove charge_id from URL
    return redirect("/app/billing");
  }

  // Get shop from database
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({
      shopDomain,
      subscription: { 
        hasActiveSubscription: false, 
        plan: "free" as PlanId,
        subscriptionId: undefined as string | undefined,
        isTrialing: false,
        currentPeriodEnd: undefined as string | undefined,
      },
      usage: { exceeded: false, current: 0, limit: 100 },
      plans: BILLING_PLANS,
      appUrl: process.env.SHOPIFY_APP_URL || "",
    });
  }

  // Get current subscription status
  const subscriptionStatus = await getSubscriptionStatus(admin, shopDomain);
  
  // Get order usage
  const orderUsage = await checkOrderLimit(
    shop.id,
    subscriptionStatus.plan
  );

  return json({
    shopDomain,
    subscription: subscriptionStatus,
    usage: orderUsage,
    plans: BILLING_PLANS,
    appUrl: process.env.SHOPIFY_APP_URL || "",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const formData = await request.formData();
  const action = formData.get("_action");

  switch (action) {
    case "subscribe": {
      const planId = formData.get("planId") as PlanId;
      const appUrl = process.env.SHOPIFY_APP_URL || "";
      const returnUrl = `${appUrl}/app/billing`;
      
      const result = await createSubscription(
        admin,
        shopDomain,
        planId,
        returnUrl,
        process.env.NODE_ENV !== "production"
      );

      if (result.success && result.confirmationUrl) {
        return redirect(result.confirmationUrl);
      }

      return json({
        success: false,
        error: result.error || "订阅创建失败",
      });
    }

    case "cancel": {
      const subscriptionId = formData.get("subscriptionId") as string;
      
      if (!subscriptionId) {
        return json({ success: false, error: "缺少订阅 ID" });
      }

      const result = await cancelSubscription(admin, shopDomain, subscriptionId);
      
      return json(result);
    }

    default:
      return json({ success: false, error: "未知操作" });
  }
};

export default function BillingPage() {
  const { subscription, usage, plans } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  
  const isSubmitting = navigation.state === "submitting";
  const showSuccess = searchParams.get("success") === "true";

  const currentPlan = plans[subscription.plan as PlanId];
  const usagePercent = Math.min((usage.current / usage.limit) * 100, 100);

  const handleSubscribe = (planId: string) => {
    const formData = new FormData();
    formData.append("_action", "subscribe");
    formData.append("planId", planId);
    submit(formData, { method: "post" });
  };

  const handleCancel = () => {
    if (!subscription.subscriptionId) return;
    
    if (!confirm("确定要取消订阅吗？取消后将降级到免费版。")) {
      return;
    }

    const formData = new FormData();
    formData.append("_action", "cancel");
    formData.append("subscriptionId", subscription.subscriptionId);
    submit(formData, { method: "post" });
  };

  return (
    <Page title="订阅与计费">
      <BlockStack gap="500">
        {showSuccess && (
          <Banner
            title="订阅成功！"
            tone="success"
            onDismiss={() => {}}
          >
            <p>您的订阅已激活，现在可以享受所有功能了。</p>
          </Banner>
        )}

        {subscription.isTrialing && (
          <Banner title="试用期" tone="info">
            <p>
              您正在使用 {currentPlan.name} 的免费试用。
              试用期将于 {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN") : "即将"} 结束。
            </p>
          </Banner>
        )}

        {usage.exceeded && (
          <Banner title="已达到订单限额" tone="critical">
            <p>
              本月订单追踪已达到 {usage.limit} 笔上限。
              请升级套餐以继续追踪更多订单。
            </p>
          </Banner>
        )}

        {/* Current Plan */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">当前套餐</Text>
                  <Badge tone={subscription.hasActiveSubscription ? "success" : "info"}>
                    {currentPlan.name}
                  </Badge>
                </InlineStack>

                <Divider />

                {/* Usage */}
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">本月订单追踪</Text>
                    <Text as="span" variant="bodySm">
                      {usage.current.toLocaleString()} / {usage.limit.toLocaleString()}
                    </Text>
                  </InlineStack>
                  <ProgressBar 
                    progress={usagePercent} 
                    tone={usagePercent >= 90 ? "critical" : undefined}
                  />
                </BlockStack>

                {/* Plan Features */}
                <BlockStack gap="200">
                  <Text as="span" variant="headingSm">套餐功能</Text>
                  <List>
                    {currentPlan.features.map((feature, index) => (
                      <List.Item key={index}>{feature}</List.Item>
                    ))}
                  </List>
                </BlockStack>

                {/* Subscription Info */}
                {subscription.hasActiveSubscription && subscription.plan !== "free" && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">订阅状态</Text>
                        <Badge tone="success">{subscription.isTrialing ? "试用中" : "已激活"}</Badge>
                      </InlineStack>
                      {subscription.currentPeriodEnd && (
                        <InlineStack align="space-between">
                          <Text as="span" tone="subdued">下次扣费日期</Text>
                          <Text as="span">
                            {new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN")}
                          </Text>
                        </InlineStack>
                      )}
                    </BlockStack>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={handleCancel}
                      loading={isSubmitting}
                    >
                      取消订阅
                    </Button>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Available Plans */}
        <Text as="h2" variant="headingMd">可用套餐</Text>
        
        <Layout>
          {Object.entries(plans).map(([planId, plan]) => {
            const isCurrentPlan = subscription.plan === planId;
            const isUpgrade = plan.price > (plans[subscription.plan as PlanId]?.price || 0);
            const isDowngrade = plan.price < (plans[subscription.plan as PlanId]?.price || 0);
            
            return (
              <Layout.Section key={planId} variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text as="h3" variant="headingMd">{plan.name}</Text>
                      {isCurrentPlan && <Badge tone="success">当前</Badge>}
                    </InlineStack>

                    <BlockStack gap="100">
                      <InlineStack align="start" blockAlign="baseline" gap="100">
                        <Text as="span" variant="heading2xl">
                          ${plan.price}
                        </Text>
                        {plan.price > 0 && (
                          <Text as="span" tone="subdued">/月</Text>
                        )}
                      </InlineStack>
                      {"trialDays" in plan && plan.trialDays > 0 && (
                        <Text as="span" variant="bodySm" tone="success">
                          {plan.trialDays} 天免费试用
                        </Text>
                      )}
                    </BlockStack>

                    <Divider />

                    <List>
                      {plan.features.map((feature, index) => (
                        <List.Item key={index}>{feature}</List.Item>
                      ))}
                    </List>

                    <Box paddingBlockStart="200">
                      {isCurrentPlan ? (
                        <Button disabled fullWidth>当前套餐</Button>
                      ) : plan.price === 0 ? (
                        <Button
                          variant="secondary"
                          fullWidth
                          onClick={handleCancel}
                          loading={isSubmitting}
                          disabled={subscription.plan === "free"}
                        >
                          降级到免费版
                        </Button>
                      ) : (
                        <Button
                          variant={isUpgrade ? "primary" : "secondary"}
                          fullWidth
                          onClick={() => handleSubscribe(planId)}
                          loading={isSubmitting}
                        >
                          {isUpgrade ? "升级" : isDowngrade ? "降级" : "选择"}
                        </Button>
                      )}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        {/* FAQ */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">常见问题</Text>
            <Divider />
            
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">什么时候开始计费？</Text>
                <Text as="p" tone="subdued">
                  付费套餐提供 7 天免费试用（企业版 14 天）。试用期结束后自动开始计费。
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">可以随时取消吗？</Text>
                <Text as="p" tone="subdued">
                  是的，您可以随时取消订阅。取消后，当前计费周期结束前仍可使用付费功能。
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">超过订单限额会怎样？</Text>
                <Text as="p" tone="subdued">
                  达到月度限额后，新订单将不会被追踪。您可以升级套餐来增加限额。
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">如何升级或降级套餐？</Text>
                <Text as="p" tone="subdued">
                  您可以随时更改套餐。升级立即生效，降级在当前计费周期结束后生效。
                </Text>
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
