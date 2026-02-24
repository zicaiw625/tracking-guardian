import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Layout, Card, Text, BlockStack, InlineStack, Button, Badge, Box, Divider, Banner, ProgressBar, List, DataTable, Modal } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createSubscription, getSubscriptionStatus, cancelSubscription, checkOrderLimit, handleSubscriptionConfirmation, getBillingHistory, type BillingHistoryItem, type PlanId } from "../services/billing.server";
import { getUsageHistory } from "../services/billing/usage-history.server";
import { DEPRECATION_DATES, formatDeadlineDate } from "~/utils/migration-deadlines";

import { assertSafeRedirect } from "../utils/redirect-validation.server";
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

        url.searchParams.delete("charge_id");
        url.searchParams.set("success", confirmation.success ? "true" : "false");
        if (!confirmation.success && confirmation.error) {
            url.searchParams.set("error", confirmation.error);
        }
        return redirect(`${url.pathname}?${url.searchParams.toString()}`);
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
                status: undefined as string | undefined,
                trialDays: undefined as number | undefined,
                trialDaysRemaining: undefined as number | undefined,
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
    try {
        const { session, admin, redirect: shopifyRedirect } = await authenticate.admin(request);
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
            const current = new URL(request.url);
            const host = current.searchParams.get("host");

            const returnUrlObj = new URL("/app/billing", appUrl);
            if (host) returnUrlObj.searchParams.set("host", host);
            returnUrlObj.searchParams.set("shop", shopDomain);

            const returnUrl = returnUrlObj.toString();

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
                const allowedDomains = [
                    "admin.shopify.com",
                    "myshopify.com",
                    "partners.shopify.com",
                    "shopify.com",
                    shopDomain,
                ];
                const validation = assertSafeRedirect(result.confirmationUrl, allowedDomains);
                if (!validation.valid) {
                    logger.error(`Invalid confirmationUrl in redirect: ${validation.error}`, {
                        shopDomain,
                        confirmationUrl: result.confirmationUrl,
                    });
                    return json({
                        success: false,
                        error: validation.error || "Invalid confirmation URL",
                    });
                }
                return shopifyRedirect(result.confirmationUrl, { target: "_parent" });
            }

            return json({
                success: false,
                error: result.error || "Subscription creation failed",
            });
        }
        case "cancel": {
            const subscriptionId = formData.get("subscriptionId") as string;
            if (!subscriptionId) {
                return json({ success: false, error: "Missing subscription ID" });
            }
            const result = await cancelSubscription(admin, shopDomain, subscriptionId);
            return json(result);
        }
        default:
            return json({ success: false, error: "Unknown action" });
        }
    } catch (error) {
        if (error instanceof Response) {
            return error;
        }
        logger.error("Billing action error", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        return json(
            { success: false, error: "Authentication failed, please refresh and try again" },
            { status: 401 }
        );
    }
};

export default function BillingPage() {
    const loaderData = useLoaderData<typeof loader>();
    const { subscription, usage, plans, planIds, billingHistory, billingPortalUrl } = loaderData;
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const { t, i18n } = useTranslation();
    const { showSuccess, showError } = useToastContext();

    useEffect(() => {
        if (actionData) {
            const data = actionData as { success?: boolean; error?: string; actionType?: string; confirmationUrl?: string };
            if (data.success) {
                if (data.actionType === "cancel") {
                    showSuccess(t("billing.subscriptionCancelled"));
                } else {
                    showSuccess(t("common.operationSuccess"));
                }
            } else if (data.error) {
                showError(t("billing.failPrefix") + data.error);
            }
        }
    }, [actionData, showSuccess, showError, t]);

    const [searchParams] = useSearchParams();
    const isSubmitting = navigation.state === "submitting";
    const showSuccessBanner = searchParams.get("success") === "true";
    const showErrorBanner = searchParams.get("success") === "false";
    const errorMessage = searchParams.get("error");
    const upgradePlanId = searchParams.get("upgrade");
    const [showCancelModal, setShowCancelModal] = useState(false);
    
    useEffect(() => {
        if (upgradePlanId && !isSubmitting && !showSuccessBanner && !showErrorBanner) {
            const formData = new FormData();
            formData.append("_action", "subscribe");
            formData.append("planId", upgradePlanId);
            submit(formData, { method: "post" });
        }
    }, [upgradePlanId, isSubmitting, showSuccessBanner, showErrorBanner, submit]);

    const currentPlan = plans[subscription.plan as PlanId];
    const usagePercent = Math.min((usage.current / usage.limit) * 100, 100);

    const locale = i18n.resolvedLanguage || i18n.language || undefined;
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
    });

    const formatBillingItemName = (item: BillingHistoryItem): string => {
        const rawName = item.name || "";
        const nameLower = rawName.toLowerCase();
        if (
            nameLower.includes("agency") ||
            nameLower.includes("agency版")
        ) {
            return t(plans.agency.name);
        }
        if (
            nameLower.includes("growth") ||
            nameLower.includes("成长版") ||
            nameLower.includes("pro")
        ) {
            return t(plans.growth.name);
        }
        if (
            nameLower.includes("starter") ||
            nameLower.includes("入门版") ||
            nameLower.includes("migration") ||
            nameLower.includes("monitor") ||
            nameLower.includes("监控版")
        ) {
            return t(plans.starter.name);
        }
        if (nameLower.includes("free") || nameLower.includes("免费版")) {
            return t(plans.free.name);
        }
        return rawName || t("common.unknown");
    };

    const formatBillingStatus = (status: string): string => {
        const normalized = (status || "").toUpperCase();
        switch (normalized) {
            case "ACTIVE":
                return t("billing.invoiceTable.statusMap.active");
            case "CANCELLED":
                return t("billing.invoiceTable.statusMap.cancelled");
            case "PENDING":
                return t("billing.invoiceTable.statusMap.pending");
            case "PAUSED":
                return t("billing.invoiceTable.statusMap.paused");
            case "DECLINED":
                return t("billing.invoiceTable.statusMap.declined");
            case "EXPIRED":
                return t("billing.invoiceTable.statusMap.expired");
            case "FROZEN":
                return t("billing.invoiceTable.statusMap.frozen");
            default:
                return status || t("common.unknown");
        }
    };

    const formatBillingType = (item: BillingHistoryItem): string => {
        const normalized = (item.status || "").toUpperCase();
        if (item.type === "subscription") {
            if (normalized === "PENDING") {
                return t("billing.invoiceTable.typeMap.subscriptionPending");
            }
            if (normalized === "CANCELLED") {
                return t("billing.invoiceTable.typeMap.subscriptionCancelled");
            }
            return t("billing.invoiceTable.typeMap.subscription");
        }
        if (item.type === "one_time") {
            if (normalized === "PENDING") {
                return t("billing.invoiceTable.typeMap.oneTimePending");
            }
            return t("billing.invoiceTable.typeMap.oneTime");
        }
        return t("common.unknown");
    };

    const billingRows = (billingHistory || []).map((item: BillingHistoryItem) => {
        const amount = item.amount !== undefined ? `${item.amount.toFixed(2)} ${item.currency || ""}` : "—";
        const timeframe = item.periodEnd
            ? t("billing.invoiceTable.periodTo", { date: dateFormatter.format(new Date(item.periodEnd)) })
            : item.createdAt
                ? dateFormatter.format(new Date(item.createdAt))
                : "—";

        return [
            formatBillingType(item),
            formatBillingItemName(item),
            amount,
            formatBillingStatus(item.status),
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
        setShowCancelModal(true);
    };

    const confirmCancel = () => {
        if (!subscription.subscriptionId) {
            setShowCancelModal(false);
            return;
        }
        const formData = new FormData();
        formData.append("_action", "cancel");
        formData.append("subscriptionId", subscription.subscriptionId);
        submit(formData, { method: "post" });
        setShowCancelModal(false);
    };

    const actionDataTyped = actionData as { success?: boolean; error?: string; confirmationUrl?: string } | undefined;
    const hasError = actionDataTyped && !actionDataTyped.success && actionDataTyped.error;

    const renderFeature = (feature: string) => {
        if (feature === "subscriptionPlans.free.features.countdown") {
            return t(feature, {
                plusDate: formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff),
                autoUpgradeDate: formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month"),
                nonPlusDate: formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff),
            });
        }
        return t(feature);
    };

    return (<Page title={t("billing.pageTitle")}>
      <BlockStack gap="500">
        {showSuccessBanner && (<Banner title={t("billing.successTitle")} tone="success" onDismiss={() => { }}>
            <p>{t("billing.successMessage")}</p>
          </Banner>)}

        {(showErrorBanner && errorMessage) && (<Banner title={t("billing.failTitle")} tone="critical" onDismiss={() => { }}>
            <p>{errorMessage}</p>
          </Banner>)}

        {hasError && (<Banner title={t("billing.failTitle")} tone="critical" onDismiss={() => { }}>
            <p>{actionDataTyped.error}</p>
          </Banner>)}

        {subscription.isTrialing && (<Banner title={t("billing.trialBannerTitle")} tone="info">
            <p>
              {t("billing.trialBannerMessage", {
                planName: t(currentPlan.name),
                days: (subscription as typeof subscription & { trialDaysRemaining?: number; trialDays?: number }).trialDaysRemaining ?? (subscription as typeof subscription & { trialDaysRemaining?: number; trialDays?: number }).trialDays ?? 0
              })}
            </p>
          </Banner>)}

        {usage.exceeded && (<Banner title={t("billing.limitBannerTitle")} tone="critical">
            <p>
              {t("billing.limitBannerMessage", { limit: usage.limit })}
            </p>
          </Banner>)}

        <PageIntroCard
          title={t("billing.introTitle")}
          description={t("billing.introDescription")}
          items={t("billing.introItems", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("billing.viewPlan"), url: "/app/billing" }}
          secondaryAction={{ content: t("billing.billingCenter"), url: billingPortalUrl }}
        />

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">{t("billing.currentPlan")}</Text>
                  <Badge tone={subscription.hasActiveSubscription ? "success" : "info"}>
                    {t(currentPlan.name)}
                  </Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">{t("billing.usageTitle")}</Text>
                    <Text as="span" variant="bodySm">
                      {usage.current.toLocaleString(locale)} / {usage.limit.toLocaleString(locale)}
                    </Text>
                  </InlineStack>
                  <ProgressBar progress={usagePercent} tone={usagePercent >= 90 ? "critical" : undefined}/>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="span" variant="headingSm">{t("billing.featuresTitle")}</Text>
                  <List>
                    {currentPlan.features.map((feature, index) => (<List.Item key={index}>{renderFeature(feature)}</List.Item>))}
                  </List>
                </BlockStack>

                {subscription.hasActiveSubscription && subscription.plan !== "free" && (<>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">{t("billing.subscriptionStatus")}</Text>
                        <Badge tone="success">{subscription.isTrialing ? t("billing.trialing") : t("billing.active")}</Badge>
                      </InlineStack>
                      {subscription.currentPeriodEnd && (<InlineStack align="space-between">
                          <Text as="span" tone="subdued">{t("billing.nextBillingDate")}</Text>
                          <Text as="span">
                            {new Date(subscription.currentPeriodEnd).toLocaleDateString(locale)}
                          </Text>
                        </InlineStack>)}
                    </BlockStack>
                    {(subscription as typeof subscription & { status?: string }).status === "ACTIVE" && (
                      <Button variant="plain" tone="critical" onClick={handleCancel} loading={isSubmitting}>
                        {t("billing.cancelSubscription")}
                      </Button>
                    )}
                    {(subscription as typeof subscription & { status?: string }).status === "CANCELLED" && subscription.currentPeriodEnd && (
                      <Banner tone="info" title={t("billing.subscriptionCancelled")}>
                        <p>{t("billing.cancelledMessage", { date: new Date(subscription.currentPeriodEnd).toLocaleDateString(locale) })}</p>
                      </Banner>
                    )}
                  </>)}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">{t("billing.invoiceHistory")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("billing.invoiceDescription")}
                </Text>
              </BlockStack>
              <Button url={billingPortalUrl} external>
                {t("billing.goToShopifyBilling")}
              </Button>
            </InlineStack>

            {billingRows.length === 0 ? (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("billing.noInvoices")}
                </Text>
              </Banner>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={[
                    t("billing.invoiceTable.type"),
                    t("billing.invoiceTable.item"),
                    t("billing.invoiceTable.amount"),
                    t("billing.invoiceTable.status"),
                    t("billing.invoiceTable.period")
                ]}
                rows={billingRows}
              />
            )}
          </BlockStack>
        </Card>

        <Text as="h2" variant="headingMd">{t("billing.availablePlans")}</Text>
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
                      <Text as="h3" variant="headingMd">{t(plan.name)}</Text>
                      {isCurrentPlan && <Badge tone="success">{t("billing.current")}</Badge>}
                    </InlineStack>
                    <BlockStack gap="100">
                      <InlineStack align="start" blockAlign="baseline" gap="100">
                        <Text as="span" variant="heading2xl">
                          ${plan.price}
                        </Text>
                        {plan.price > 0 && (<Text as="span" tone="subdued">{t("billing.month")}</Text>)}
                      </InlineStack>
                      {"trialDays" in plan && plan.trialDays > 0 && (<Text as="span" variant="bodySm" tone="success">
                          {t("billing.trialDays", { days: plan.trialDays })}
                        </Text>)}
                    </BlockStack>
                    <Divider />
                    <List>
                      {plan.features.map((feature, index) => (<List.Item key={index}>{renderFeature(feature)}</List.Item>))}
                    </List>
                    <Box paddingBlockStart="200">
                      {isCurrentPlan ? (<Button disabled fullWidth>{t("billing.currentPlan")}</Button>) : plan.price === 0 ? (<Button variant="secondary" fullWidth onClick={handleCancel} loading={isSubmitting} disabled={subscription.plan === "free"}>
                          {t("billing.downgradeToFree")}
                        </Button>) : (<Button variant={isUpgrade ? "primary" : "secondary"} fullWidth onClick={() => handleSubscribe(planId)} loading={isSubmitting}>
                          {isUpgrade ? t("billing.upgrade") : isDowngrade ? t("billing.downgrade") : t("billing.select")}
                        </Button>)}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>);
        })}
        </Layout>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("billing.faq.title")}</Text>
            <Divider />
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">{t("billing.faq.q1")}</Text>
                <Text as="p" tone="subdued">
                  {t("billing.faq.a1")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">{t("billing.faq.q2")}</Text>
                <Text as="p" tone="subdued">
                  {t("billing.faq.a2")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">{t("billing.faq.q3")}</Text>
                <Text as="p" tone="subdued">
                  {t("billing.faq.a3")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">{t("billing.faq.q4")}</Text>
                <Text as="p" tone="subdued">
                  {t("billing.faq.a4")}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" fontWeight="semibold">{t("billing.faq.q5")}</Text>
                <Text as="p" tone="subdued">
                  {t("billing.faq.a5")}
                </Text>
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>

        <Modal
          open={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title={t("billing.cancelModal.title")}
          primaryAction={{
            content: t("billing.cancelModal.confirm"),
            destructive: true,
            onAction: confirmCancel,
            loading: isSubmitting,
          }}
          secondaryActions={[
            {
              content: t("billing.cancelModal.cancel"),
              onAction: () => setShowCancelModal(false),
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">{t("billing.cancelModal.content")}</Text>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>);
}
