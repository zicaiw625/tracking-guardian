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
import { BILLING_PLANS, type PlanId, getUpgradeOptions } from "~/services/billing/plans";
import { useToastContext } from "~/components/ui";
import { useLocale } from "~/context/LocaleContext";

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
  const { t, locale } = useLocale();
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);
  const handleUpgrade = useCallback((planId: PlanId) => {
    setUpgradingPlan(planId);
    window.location.href = `/app/billing?upgrade=${planId}`;
  }, []);
  const currentPlanConfig = BILLING_PLANS[currentPlan] ?? BILLING_PLANS.free;
  const upgradeOptions = getUpgradeOptions(currentPlan);
  const planName = locale === "zh" ? currentPlanConfig.name : currentPlanConfig.nameEn;
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                {t("settings.currentPlan")}
              </Text>
              <Badge tone={currentPlan === "free" ? "info" : "success"}>
                {planName}
              </Badge>
            </InlineStack>
            {subscriptionStatus?.isTrialing && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("settings.trialDaysRemaining", { days: subscriptionStatus.trialDaysRemaining ?? subscriptionStatus.trialDays ?? 0 })}
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
                      {planName}
                    </Text>
                    {currentPlanConfig.tagline && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {currentPlanConfig.tagline}
                      </Text>
                    )}
                  </BlockStack>
                  <Badge tone="success">{t("settings.currentPlan")}</Badge>
                </InlineStack>
                <List type="bullet">
                  {currentPlanConfig.features.map((feature, idx) => (
                    <List.Item key={idx}>
                      <Text as="span" variant="bodySm">{feature}</Text>
                    </List.Item>
                  ))}
                </List>
                {currentPlanConfig.price > 0 && (
                  <Text as="p" variant="headingMd" fontWeight="bold">
                    ${currentPlanConfig.price}/月
                  </Text>
                )}
              </BlockStack>
            </Box>
            {upgradeOptions.length > 0 && (
              <>
                <Divider />
                <Text as="h3" variant="headingMd">
                  {t("settings.upgradePlans")}
                </Text>
                <BlockStack gap="300">
                  {upgradeOptions.map((planId) => {
                    const planConfig = BILLING_PLANS[planId];
                    const upgradePlanName = locale === "zh" ? planConfig.name : planConfig.nameEn;
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
                                {upgradePlanName}
                              </Text>
                              {planConfig.tagline && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {planConfig.tagline}
                                </Text>
                              )}
                            </BlockStack>
                            <Text as="span" variant="headingMd" fontWeight="bold">
                              ${planConfig.price}/mo
                            </Text>
                          </InlineStack>
                          <List type="bullet">
                            {planConfig.features.slice(0, 5).map((feature, idx) => (
                              <List.Item key={idx}>
                                <Text as="span" variant="bodySm">{feature}</Text>
                              </List.Item>
                            ))}
                          </List>
                          <Button
                            variant="primary"
                            onClick={() => handleUpgrade(planId)}
                            loading={upgradingPlan === planId}
                          >
                            {t("settings.upgradeTo", { plan: upgradePlanName })}
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
                  {t("settings.needBillingInfo")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("settings.billingInfoDescBefore")}<a href="/app/billing">{t("settings.subscriptionBilling")}</a>{t("settings.billingInfoDescAfter")}
                </Text>
              </BlockStack>
            </Banner>
            <Divider />
            <Text as="h3" variant="headingMd">
              {t("settings.planComparison")}
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("settings.needHelpChoose")}
              </Text>
            </Banner>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
