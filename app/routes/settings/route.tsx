import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, Button, InlineStack, Text, Card, Badge } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useToastContext } from "~/components/ui";
import { getShopifyAdminUrl } from "~/utils/helpers";
import { useLocale } from "~/context/LocaleContext";

import { settingsLoader } from "./loader.server";
import { settingsAction } from "./actions.server";
import type { SettingsActionResponse } from "./types";
import {
  SecurityTab,
  SubscriptionTab,
  AlertsTab,
} from "./_components";
import type { PlanId } from "~/services/billing/plans";

export const loader = settingsLoader;
export const action = settingsAction;

export default function SettingsPage() {
  const { t, tArray } = useLocale();
  const { shop, hmacSecurityStats, pixelStrictOrigin, alertChannelsEnabled, typOspStatus } =
    useLoaderData<typeof settingsLoader>();
  const actionData = useActionData<SettingsActionResponse>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showSuccess(actionData.message || t("settings.saved"));
      } else if (actionData.error) {
        showError(actionData.error);
      }
    }
  }, [actionData, showSuccess, showError, t]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const getTabIndex = (tab: string | null): number => {
    if (tab === "alerts") return 2;
    if (tab === "billing" || tab === "subscription") return 1;
    if (tab === "security") return 0;
    return 0;
  };
  const getTabId = (index: number): string => {
    if (index === 0) return "security";
    if (index === 1) return "subscription";
    if (index === 2) return "alerts";
    return "security";
  };
  const [selectedTab, setSelectedTab] = useState(() => getTabIndex(tabParam));
  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    setSelectedTab(newTabIndex);
  }, [tabParam]);
  const handleTabChange = useCallback((index: number) => {
    const tabId = getTabId(index);
    setSearchParams({ tab: tabId });
  }, [setSearchParams]);
  const handleRotateSecret = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "rotateIngestionSecret");
    submit(formData, { method: "post" });
  }, [submit]);
  const isSubmitting = navigation.state === "submitting";
  const tabs = [
    { id: "security", content: t("settings.tabSecurity") },
    { id: "subscription", content: t("settings.tabSubscription") },
    { id: "alerts", content: t("settings.tabAlerts") },
  ];
  return (
    <Page title={t("settings.pageTitle")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("settings.introTitle")}
          description={t("settings.introDesc")}
          items={tArray("settings.introItems")}
          primaryAction={{ content: t("settings.subscriptionBilling"), url: "/app/billing" }}
          secondaryAction={{ content: t("settings.privacySettings"), url: "/app/privacy" }}
        />
        <Banner tone="warning" title={t("settings.quickAccessTitle")}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("settings.quickAccessDesc")}
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/billing" variant="primary" size="large">
                {t("settings.subscriptionBilling")}
              </Button>
              <Button url="/app/privacy" variant="secondary" size="large">
                {t("settings.privacySettings")}
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("settings.billingManagementDesc")}
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="info" title={t("settings.billingManagementTitle")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("settings.billingManagementDesc")}
            </Text>
            <InlineStack gap="200">
              <Button url="/app/billing" variant="primary">
                {t("settings.goToBilling")}
              </Button>
              <Button onClick={() => handleTabChange(1)} variant="secondary">
                {t("settings.viewSubscriptionTab")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("settings.pageModulesTitle")}
              </Text>
              {typOspStatus && (
                <Badge
                  tone={
                    typOspStatus.status === "enabled"
                      ? "success"
                      : typOspStatus.status === "disabled"
                        ? "warning"
                        : "info"
                  }
                >
                  {typOspStatus.status === "enabled"
                    ? t("settings.enabled")
                    : typOspStatus.status === "disabled"
                      ? t("settings.disabled")
                      : t("settings.pendingCheck")}
                </Badge>
              )}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("settings.pageModulesDesc")}
            </Text>
            {shop?.domain && (
              <Button url={getShopifyAdminUrl(shop.domain, "/settings/checkout")} external variant="primary">
                {t("settings.openCheckoutSettings")}
              </Button>
            )}
            {typOspStatus?.status === "unknown" && typOspStatus.unknownReason && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.statusNote", {
                  reason: typOspStatus.unknownReason === "NOT_PLUS" ? t("settings.statusNotPlus") : typOspStatus.unknownReason === "NO_EDITOR_ACCESS" ? t("settings.statusNoEditorAccess") : typOspStatus.unknownReason,
                })}
              </Text>
            )}
          </BlockStack>
        </Card>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
          {selectedTab === 0 && (
            <SecurityTab
              shop={shop}
              isSubmitting={isSubmitting}
              onRotateSecret={handleRotateSecret}
              hmacSecurityStats={hmacSecurityStats}
              pixelStrictOrigin={pixelStrictOrigin}
            />
          )}
          {selectedTab === 1 && <SubscriptionTab currentPlan={shop?.plan as PlanId || "free"} />}
          {selectedTab === 2 && (
            <AlertsTab
              alertConfigs={shop?.alertConfigs ?? []}
              isSubmitting={isSubmitting}
              alertChannelsEnabled={alertChannelsEnabled ?? false}
            />
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
