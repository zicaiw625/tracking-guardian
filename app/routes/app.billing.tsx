import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, Box, Divider, Banner, ProgressBar, List, Icon, } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BILLING_PLANS, createSubscription, getSubscriptionStatus, cancelSubscription, checkOrderLimit, handleSubscriptionConfirmation, type PlanId, } from "../services/billing.server";
import { getUsageHistory } from "../services/billing/usage-history.server";
import { handleOneTimePurchaseConfirmation, createOneTimePurchase } from "../services/billing/subscription.server";
import { logger } from "../utils/logger.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    const purchaseId = url.searchParams.get("purchase_id");
    
    // P1-7: 处理一次性收费确认
    if (purchaseId) {
        await handleOneTimePurchaseConfirmation(admin, shopDomain, purchaseId);
        return redirect("/app/billing?success=true&type=oneTime");
    }
    
    if (chargeId) {
        await handleSubscriptionConfirmation(admin, shopDomain, chargeId);
        return redirect("/app/billing?success=true");
    }
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
    const subscriptionStatus = await getSubscriptionStatus(admin, shopDomain);
    const orderUsage = await checkOrderLimit(shop.id, subscriptionStatus.plan);
    const usageHistory = await getUsageHistory(shop.id, 30).catch((err) => {
      logger.warn("Failed to get usage history", {
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : "Unknown",
        shopId: shop.id,
        shopDomain,
      });
      return null;
    });
    return json({
        shopDomain,
        subscription: subscriptionStatus,
        usage: orderUsage,
        usageHistory,
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
            const result = await createSubscription(admin, shopDomain, planId, returnUrl, process.env.NODE_ENV !== "production");
            if (result.success && result.confirmationUrl) {
                return redirect(result.confirmationUrl);
            }
            return json({
                success: false,
                error: result.error || "订阅创建失败",
            });
        }
        // P1-7: 一次性收费（用于 Go-Live 验收报告等）
        case "purchaseOneTime": {
            const planId = formData.get("planId") as PlanId;
            const appUrl = process.env.SHOPIFY_APP_URL || "";
            const returnUrl = `${appUrl}/app/billing`;
            const result = await createOneTimePurchase(admin, shopDomain, planId, returnUrl, process.env.NODE_ENV !== "production");
            if (result.success && result.confirmationUrl) {
                return redirect(result.confirmationUrl);
            }
            return json({
                success: false,
                error: result.error || "一次性收费创建失败",
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
    const loaderData = useLoaderData<typeof loader>();
    const { subscription, usage, plans } = loaderData;
    const usageHistory = "usageHistory" in loaderData ? loaderData.usageHistory : null;
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const { showSuccess, showError } = useToastContext();

    useEffect(() => {
        if (actionData) {
            const data = actionData as { success?: boolean; error?: string; actionType?: string };
            if (data.success) {
                if (data.actionType === "cancel") {
                    showSuccess("订阅已取消");
                } else {
                    showSuccess("操作成功");
                }
            } else if (data.error) {
                showError("操作失败：" + data.error);
            }
        }
    }, [actionData, showSuccess, showError]);
    const [searchParams] = useSearchParams();
    const isSubmitting = navigation.state === "submitting";
    const showSuccessBanner = searchParams.get("success") === "true";
    const isOneTimePurchase = searchParams.get("type") === "oneTime";
    const currentPlan = plans[subscription.plan as PlanId];
    const usagePercent = Math.min((usage.current / usage.limit) * 100, 100);
    const handleSubscribe = (planId: string) => {
        const formData = new FormData();
        formData.append("_action", "subscribe");
        formData.append("planId", planId);
        submit(formData, { method: "post" });
    };
    const handleCancel = () => {
        if (!subscription.subscriptionId)
            return;
        if (!confirm("确定要取消订阅吗？取消后将降级到免费版。")) {
            return;
        }
        const formData = new FormData();
        formData.append("_action", "cancel");
        formData.append("subscriptionId", subscription.subscriptionId);
        submit(formData, { method: "post" });
    };
    return (<Page title="订阅与计费">
      <BlockStack gap="500">
        {showSuccessBanner && (<Banner title={isOneTimePurchase ? "购买成功！" : "订阅成功！"} tone="success" onDismiss={() => { }}>
            <p>{isOneTimePurchase ? "Go-Live 交付包已激活，现在可以导出验收报告（PDF/CSV）了。" : "您的订阅已激活，现在可以享受所有功能了。"}</p>
          </Banner>)}

        {subscription.isTrialing && (<Banner title="试用期" tone="info">
            <p>
              您正在使用 {currentPlan.name} 的免费试用。
              试用期将于 {subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN") : "即将"} 结束。
            </p>
          </Banner>)}

        {usage.exceeded && (<Banner title="已达到订单限额" tone="critical">
            <p>
              本月订单追踪已达到 {usage.limit} 笔上限。
              请升级套餐以继续追踪更多订单。
            </p>
          </Banner>)}

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

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">本月订单追踪</Text>
                    <Text as="span" variant="bodySm">
                      {usage.current.toLocaleString()} / {usage.limit.toLocaleString()}
                    </Text>
                  </InlineStack>
                  <ProgressBar progress={usagePercent} tone={usagePercent >= 90 ? "critical" : undefined}/>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="span" variant="headingSm">套餐功能</Text>
                  <List>
                    {currentPlan.features.map((feature, index) => (<List.Item key={index}>{feature}</List.Item>))}
                  </List>
                </BlockStack>

                {subscription.hasActiveSubscription && subscription.plan !== "free" && (<>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">订阅状态</Text>
                        <Badge tone="success">{subscription.isTrialing ? "试用中" : "已激活"}</Badge>
                      </InlineStack>
                      {subscription.currentPeriodEnd && (<InlineStack align="space-between">
                          <Text as="span" tone="subdued">下次扣费日期</Text>
                          <Text as="span">
                            {new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN")}
                          </Text>
                        </InlineStack>)}
                    </BlockStack>
                    <Button variant="plain" tone="critical" onClick={handleCancel} loading={isSubmitting}>
                      取消订阅
                    </Button>
                  </>)}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Text as="h2" variant="headingMd">可用套餐</Text>

        <Layout>
          {Object.entries(plans).map(([planId, plan]) => {
            const isCurrentPlan = subscription.plan === planId;
            const isUpgrade = plan.price > (plans[subscription.plan as PlanId]?.price || 0);
            const isDowngrade = plan.price < (plans[subscription.plan as PlanId]?.price || 0);
            return (<Layout.Section key={planId} variant="oneThird">
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
                        {plan.price > 0 && !("isOneTime" in plan && plan.isOneTime) && (<Text as="span" tone="subdued">/月</Text>)}
                        {"isOneTime" in plan && plan.isOneTime && (<Text as="span" tone="subdued">一次性</Text>)}
                      </InlineStack>
                      {"trialDays" in plan && plan.trialDays > 0 && !("isOneTime" in plan && plan.isOneTime) && (<Text as="span" variant="bodySm" tone="success">
                          {plan.trialDays} 天免费试用
                        </Text>)}
                      {"isOneTime" in plan && plan.isOneTime && (<Text as="span" variant="bodySm">
                          Go-Live 交付包（一次性收费）
                        </Text>)}
                    </BlockStack>

                    <Divider />

                    <List>
                      {plan.features.map((feature, index) => (<List.Item key={index}>{feature}</List.Item>))}
                    </List>

                    <Box paddingBlockStart="200">
                      {isCurrentPlan ? (<Button disabled fullWidth>当前套餐</Button>) : plan.price === 0 ? (<Button variant="secondary" fullWidth onClick={handleCancel} loading={isSubmitting} disabled={subscription.plan === "free"}>
                          降级到免费版
                        </Button>) : "isOneTime" in plan && plan.isOneTime ? (
                        // P1-7: Go-Live 一次性收费按钮
                        <Button 
                          variant="primary" 
                          fullWidth 
                          onClick={() => {
                            const formData = new FormData();
                            formData.append("_action", "purchaseOneTime");
                            formData.append("planId", planId);
                            submit(formData, { method: "post" });
                          }} 
                          loading={isSubmitting}
                        >
                          {`购买（$${plan.price} 一次性）`}
                        </Button>
                      ) : (<Button variant={isUpgrade ? "primary" : "secondary"} fullWidth onClick={() => handleSubscribe(planId)} loading={isSubmitting}>
                          {isUpgrade ? "升级" : isDowngrade ? "降级" : "选择"}
                        </Button>)}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>);
        })}
        </Layout>

        {}
        {subscription.plan === "agency" && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200">
                    <Text as="h2" variant="headingMd">🏢 Agency 多店管理</Text>
                    <Badge tone="success">已解锁</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    管理多个店铺、批量配置、团队协作
                  </Text>
                </BlockStack>
                <Button url="/app/workspace" variant="primary">
                  进入多店管理
                </Button>
              </InlineStack>
              <Divider />
              <InlineStack gap="400" wrap>
                <InlineStack gap="100">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="span" variant="bodySm">最多 50 个店铺</Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="span" variant="bodySm">批量 Audit</Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="span" variant="bodySm">团队协作</Text>
                </InlineStack>
                <InlineStack gap="100">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="span" variant="bodySm">报告导出</Text>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">常见问题</Text>
            <Divider />

            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">什么时候开始计费？</Text>
                <Text as="p" tone="subdued">
                  付费套餐提供 7 天免费试用（Agency 版 14 天）。试用期结束后自动开始计费。
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

              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">Agency 版有哪些额外功能？</Text>
                <Text as="p" tone="subdued">
                  Agency 版支持多店管理（最多 50 个店铺）、批量配置、团队协作（Owner/Admin/Viewer 权限）、
                  验收报告导出（PDF/CSV）以及专属客户成功经理。
                </Text>
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>);
}
