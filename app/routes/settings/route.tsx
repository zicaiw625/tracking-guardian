import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, Button, InlineStack, Text, Card, Badge } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useToastContext } from "~/components/ui";
import { getShopifyAdminUrl } from "~/utils/helpers";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { shop, hmacSecurityStats, pixelStrictOrigin, alertChannelsEnabled, typOspStatus } =
    useLoaderData<typeof settingsLoader>();
  const actionData = useActionData<SettingsActionResponse>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showSuccess(actionData.message || t("settings.toast.saved"));
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
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tabId);
      return next;
    });
  }, [setSearchParams]);
  const handleRotateSecret = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "rotateIngestionSecret");
    submit(formData, { method: "post" });
  }, [submit]);
  const isSubmitting = navigation.state === "submitting";
  const tabs = [
    { id: "security", content: t("settings.tabs.security") },
    { id: "subscription", content: t("settings.tabs.subscription") },
    { id: "alerts", content: t("settings.tabs.alerts") },
  ];
  return (
    <Page title={t("settings.page.title")}>
      <BlockStack gap="500">
        <PageIntroCard
          title={t("settings.intro.title")}
          description={t("settings.intro.description")}
          items={[
            t("settings.intro.items.0"),
            t("settings.intro.items.1"),
            t("settings.intro.items.2"),
          ]}
          primaryAction={{ content: t("settings.intro.action.billing"), url: "/app/billing" }}
          secondaryAction={{ content: t("settings.intro.action.privacy"), url: "/app/privacy" }}
        />
        <Banner tone="warning" title={t("settings.banner.quickAccess.title")}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("settings.banner.quickAccess.description")}
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/billing" variant="primary" size="large">
                {t("settings.intro.action.billing")}
              </Button>
              <Button url="/app/privacy" variant="secondary" size="large">
                {t("settings.intro.action.privacy")}
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("settings.banner.quickAccess.footer")}
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="info" title={t("settings.banner.billing.title")}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("settings.banner.billing.description")}
            </Text>
            <InlineStack gap="200">
              <Button url="/app/billing" variant="primary">
                {t("settings.banner.billing.action.goToBilling")}
              </Button>
              <Button onClick={() => handleTabChange(1)} variant="secondary">
                {t("settings.banner.billing.action.viewTab")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("settings.card.modules.title")}
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
                    ? t("settings.card.modules.status.enabled")
                    : typOspStatus.status === "disabled"
                      ? t("settings.card.modules.status.disabled")
                      : t("settings.card.modules.status.unknown")}
                </Badge>
              )}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("settings.card.modules.description")}
            </Text>
            {shop?.domain && (
              <Button url={getShopifyAdminUrl(shop.domain, "/settings/checkout")} external variant="primary">
                {t("settings.card.modules.action.openSettings")}
              </Button>
            )}
            {typOspStatus?.status === "unknown" && typOspStatus.unknownReason && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("settings.card.modules.status.explanation")}{typOspStatus.unknownReason === "NOT_PLUS" ? t("settings.card.modules.reason.notPlus") : typOspStatus.unknownReason === "NO_EDITOR_ACCESS" ? t("settings.card.modules.reason.noAccess") : typOspStatus.unknownReason}
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
