import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, Box, Divider, Banner, ProgressBar, List, Icon, DataTable, } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, getSubscriptionStatus, cancelSubscription, checkOrderLimit, handleSubscriptionConfirmation, getBillingHistory, type BillingHistoryItem, type PlanId } from "../services/billing.server";
import { getUsageHistory } from "../services/billing/usage-history.server";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";

import { logger } from "../utils/logger.server";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { BILLING_PLANS, PLAN_IDS } = await import("../services/billing.server");
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    if (chargeId) {
        const confirmation = await handleSubscriptionConfirmation(admin, shopDomain, chargeId);
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
            select: { id: true, shopDomain: true },
        });
        if (shop) {
            safeFireAndForget(
                trackEvent({
                    shopId: shop.id,
                    shopDomain: shop.shopDomain,
                    event: confirmation.success ? "app_subscription_created" : "app_subscription_failed",
                    eventId: confirmation.success
                        ? `app_subscription_created_${chargeId}`
                        : `app_subscription_failed_${chargeId}`,
                    metadata: confirmation.success
                        ? { plan: confirmation.plan }
                        : { error: confirmation.error },
                })
            );
        }
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
            planIds: PLAN_IDS,
            appUrl: process.env.SHOPIFY_APP_URL || "",
            billingHistory: [] as BillingHistoryItem[],
            billingPortalUrl: `https://${shopDomain}/admin/settings/billing`,
        });
    }
    const subscriptionStatus = await getSubscriptionStatus(admin, shopDomain);
    const orderUsage = await checkOrderLimit(shop.id, subscriptionStatus.plan);
    const billingHistory = await getBillingHistory(admin);
    const usageHistory = await getUsageHistory(shop.id, 30).catch((err) => {
      logger.warn("Failed to get usage history", {
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : "Unknown",
        shopId: shop.id,
        shopDomain,
      });
      return null;
    });
        safeFireAndForget(
        trackEvent({
            shopId: shop.id,
            shopDomain,
            event: "app_paywall_viewed",
            metadata: {
                plan: subscriptionStatus.plan,
                hasActiveSubscription: subscriptionStatus.hasActiveSubscription,
                triggerPage: "billing",
            },
        })
    );
    return json({
        shopDomain,
        subscription: subscriptionStatus,
        usage: orderUsage,
        usageHistory,
        plans: BILLING_PLANS,
        planIds: PLAN_IDS,
        appUrl: process.env.SHOPIFY_APP_URL || "",
        billingHistory,
        billingPortalUrl: `https://${shopDomain}/admin/settings/billing`,
    });
};
export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const formData = await request.formData();
    const action = formData.get("_action");
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true, shopDomain: true },
    });
    switch (action) {
        case "subscribe": {
            const planId = formData.get("planId") as PlanId;
            const appUrl = process.env.SHOPIFY_APP_URL || "";
            const returnUrl = `${appUrl}/app/billing`;
            if (shop) {
                safeFireAndForget(
                    trackEvent({
                        shopId: shop.id,
                        shopDomain: shop.shopDomain,
                        event: "app_upgrade_clicked",
                        metadata: { planId },
                    })
                );
            }
            const result = await createSubscription(admin, shopDomain, planId, returnUrl, process.env.NODE_ENV !== "production");
            if (shop && !result.success) {
                safeFireAndForget(
                    trackEvent({
                        shopId: shop.id,
                        shopDomain: shop.shopDomain,
                        event: "app_subscription_failed",
                        metadata: { planId, error: result.error },
                    })
                );
            }
            if (result.success && result.confirmationUrl) {
                try {
                    const confirmationUrlObj = new URL(result.confirmationUrl);
                    const allowedDomains = [
                        "admin.shopify.com",
                        "partners.shopify.com",
                        "shopify.com",
                    ];
                    const hostname = confirmationUrlObj.hostname.toLowerCase();
                    const isAllowed = allowedDomains.some(domain => 
                        hostname === domain || hostname.endsWith(`.${domain}`)
                    );
                    if (!isAllowed) {
                        logger.error(`Invalid confirmationUrl domain in redirect: ${hostname}`, {
                            shopDomain,
                            confirmationUrl: result.confirmationUrl,
                        });
                        return json({
                            success: false,
                            error: "Invalid confirmation URL domain",
                        });
                    }
                } catch (error) {
                    logger.error(`Invalid confirmationUrl format in redirect: ${result.confirmationUrl}`, {
                        shopDomain,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return json({
                        success: false,
                        error: "Invalid confirmation URL format",
                    });
                }
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
    const loaderData = useLoaderData<typeof loader>();
    const { subscription, usage, plans, planIds, billingHistory, billingPortalUrl } = loaderData;
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
    const currentPlan = plans[subscription.plan as PlanId];
    const usagePercent = Math.min((usage.current / usage.limit) * 100, 100);
    const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
    });
    const billingRows = (billingHistory || []).map((item: BillingHistoryItem) => {
        const amount = item.amount !== undefined ? `${item.amount.toFixed(2)} ${item.currency || ""}` : "—";
        const timeframe = item.periodEnd
            ? `周期至 ${dateFormatter.format(new Date(item.periodEnd))}`
            : item.createdAt
                ? dateFormatter.format(new Date(item.createdAt))
                : "—";
        return [
            item.type === "subscription" ? "订阅" : "一次性购买",
            item.name,
            amount,
            item.status,
            timeframe,
        ];
    });
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
    const hasError = actionData && !actionData.success && actionData.error;
    return (<Page title="订阅与计费">
      <BlockStack gap="500">
        {showSuccessBanner && (<Banner title="订阅成功！" tone="success" onDismiss={() => { }}>
            <p>您的订阅已激活，现在可以享受所有功能了。</p>
          </Banner>)}
        {hasError && (<Banner title="订阅失败" tone="critical" onDismiss={() => { }}>
            <p>{actionData.error}</p>
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
        <PageIntroCard
          title="订阅与账单概览"
          description="查看当前套餐、使用量、账单历史，并管理续费与升级。"
          items={[
            "套餐权益与用量一目了然",
            "支持在 Shopify 账单中心查看发票",
            "升级后自动解锁对应功能",
          ]}
          primaryAction={{ content: "查看套餐", url: "/app/billing" }}
          secondaryAction={{ content: "账单中心", url: billingPortalUrl }}
        />
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
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">发票/账单历史</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  展示当前订阅与一次性购买记录，完整发票请在 Shopify 后台查看。
                </Text>
              </BlockStack>
              <Button url={billingPortalUrl} external>
                前往 Shopify 账单中心
              </Button>
            </InlineStack>
            {billingRows.length === 0 ? (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  暂无账单记录。完成首次订阅后，这里会展示发票与账单摘要。
                </Text>
              </Banner>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["类型", "项目", "金额", "状态", "周期/时间"]}
                rows={billingRows}
              />
            )}
          </BlockStack>
        </Card>
        <Text as="h2" variant="headingMd">可用套餐</Text>
        <Layout>
          {planIds.map((planId) => {
            const plan = plans[planId];
            if (!plan) return null;
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
                        {plan.price > 0 && (<Text as="span" tone="subdued">/月</Text>)}
                      </InlineStack>
                      {"trialDays" in plan && plan.trialDays > 0 && (<Text as="span" variant="bodySm" tone="success">
                          {plan.trialDays} 天免费试用
                        </Text>)}
                    </BlockStack>
                    <Divider />
                    <List>
                      {plan.features.map((feature, index) => (<List.Item key={index}>{feature}</List.Item>))}
                    </List>
                    <Box paddingBlockStart="200">
                      {isCurrentPlan ? (<Button disabled fullWidth>当前套餐</Button>) : plan.price === 0 ? (<Button variant="secondary" fullWidth onClick={handleCancel} loading={isSubmitting} disabled={subscription.plan === "free"}>
                          降级到免费版
                        </Button>) : (<Button variant={isUpgrade ? "primary" : "secondary"} fullWidth onClick={() => handleSubscribe(planId)} loading={isSubmitting}>
                          {isUpgrade ? "升级" : isDowngrade ? "降级" : "选择"}
                        </Button>)}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>);
        })}
        </Layout>
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
                  Agency 版支持多店管理（最多 50 个店铺，v1.1+ 推出）、批量配置、团队协作（Owner/Admin/Viewer 权限，v1.1+ 推出）、
                  验收报告导出（PDF/CSV）以及专属客户成功经理。
                </Text>
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>);
}
