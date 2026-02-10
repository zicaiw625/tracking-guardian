import { useState, useCallback } from "react";
import {
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Banner,
  Badge,
  Box,
  Button,
  List,
} from "@shopify/polaris";
import { useTranslation, Trans } from "react-i18next";
import { BILLING_PLANS, type PlanId, getUpgradeOptions } from "~/services/billing/plans";
import { useToastContext } from "~/components/ui";
import { DEPRECATION_DATES, formatDeadlineDate } from "~/utils/migration-deadlines";

interface SubscriptionTabProps {
  currentPlan: PlanId;
  subscriptionStatus?: {
    hasActiveSubscription: boolean;
    isTrialing?: boolean;
    trialDays?: number;
    trialDaysRemaining?: number;
    currentPeriodEnd?: string;
  };
}

export function SubscriptionTab({ currentPlan, subscriptionStatus }: SubscriptionTabProps) {
  useToastContext();
  const { t } = useTranslation();
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);
  const handleUpgrade = useCallback((planId: PlanId) => {
    setUpgradingPlan(planId);
    window.location.href = `/app/billing?upgrade=${planId}`;
  }, []);
  const currentPlanConfig = BILLING_PLANS[currentPlan];
  const upgradeOptions = getUpgradeOptions(currentPlan);

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

  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                {t("settings.subscription.currentPlan")}
              </Text>
              <Badge tone={currentPlan === "free" ? "info" : "success"}>
                {t(currentPlanConfig.name)}
              </Badge>
            </InlineStack>
            {subscriptionStatus?.isTrialing && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("settings.subscription.trialDaysRemaining", {
                    days: subscriptionStatus.trialDaysRemaining ?? subscriptionStatus.trialDays ?? 0,
                  })}
                </Text>
              </Banner>
            )}
            <Divider />
            <Box
              background="bg-surface-selected"
              padding="400"
              borderRadius="200"
              borderWidth="025"
              borderColor="border"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">
                      {t(currentPlanConfig.name)}
                    </Text>
                    {currentPlanConfig.tagline && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t(currentPlanConfig.tagline)}
                      </Text>
                    )}
                  </BlockStack>
                  <Badge tone="success">{t("settings.subscription.currentPlan")}</Badge>
                </InlineStack>
                <List type="bullet">
                  {currentPlanConfig.features.map((feature, idx) => (
                    <List.Item key={idx}>
                      <Text as="span" variant="bodySm">{renderFeature(feature)}</Text>
                    </List.Item>
                  ))}
                </List>
                {currentPlanConfig.price > 0 && (
                  <Text as="p" variant="headingMd" fontWeight="bold">
                    ${currentPlanConfig.price}/{t("common.months", { count: 1 }).replace("1 ", "")}
                  </Text>
                )}
              </BlockStack>
            </Box>
            {upgradeOptions.length > 0 && (
              <>
                <Divider />
                <Text as="h3" variant="headingMd">
                  {t("settings.subscription.upgradePlan")}
                </Text>
                <BlockStack gap="300">
                  {upgradeOptions.map((planId) => {
                    const planConfig = BILLING_PLANS[planId];
                    return (
                      <Box
                        key={planId}
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor="border"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="start">
                            <BlockStack gap="100">
                              <Text as="h4" variant="headingSm">
                                {t(planConfig.name)}
                              </Text>
                              {planConfig.tagline && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {t(planConfig.tagline)}
                                </Text>
                              )}
                            </BlockStack>
                            <Text as="span" variant="headingMd" fontWeight="bold">
                              ${planConfig.price}/{t("common.months", { count: 1 }).replace("1 ", "")}
                            </Text>
                          </InlineStack>
                          <List type="bullet">
                            {planConfig.features.slice(0, 5).map((feature, idx) => (
                              <List.Item key={idx}>
                                <Text as="span" variant="bodySm">{renderFeature(feature)}</Text>
                              </List.Item>
                            ))}
                          </List>
                          <Button
                            variant="primary"
                            onClick={() => handleUpgrade(planId)}
                            loading={upgradingPlan === planId}
                          >
                            {t("settings.subscription.upgradeTo", { plan: t(planConfig.name) })}
                          </Button>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              </>
            )}
            <Divider />
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("settings.subscription.moreInfoTitle")}
                </Text>
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="settings.subscription.moreInfoContent" components={{ 1: <a href="/app/billing" /> }} />
                </Text>
              </BlockStack>
            </Banner>
            <Divider />
            <Text as="h3" variant="headingMd">
              {t("settings.subscription.comparePlans")}
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("settings.subscription.helpText")}
              </Text>
            </Banner>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
