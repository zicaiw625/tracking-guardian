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
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { BILLING_PLANS, type PlanId, getUpgradeOptions, isHigherTier } from "~/services/billing/plans";
import { useToastContext } from "~/components/ui";

interface SubscriptionTabProps {
  currentPlan: PlanId;
  subscriptionStatus?: {
    hasActiveSubscription: boolean;
    isTrialing?: boolean;
    trialDays?: number;
    currentPeriodEnd?: string;
  };
}

export function SubscriptionTab({ currentPlan, subscriptionStatus }: SubscriptionTabProps) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  const [upgradingPlan, setUpgradingPlan] = useState<PlanId | null>(null);
  const handleUpgrade = useCallback((planId: PlanId) => {
    setUpgradingPlan(planId);
    const formData = new FormData();
    formData.append("_action", "upgrade_subscription");
    formData.append("planId", planId);
    submit(formData, { method: "post" });
  }, [submit]);
  const currentPlanConfig = BILLING_PLANS[currentPlan];
  const upgradeOptions = getUpgradeOptions(currentPlan);
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                当前计划
              </Text>
              <Badge tone={currentPlan === "free" ? "info" : "success"}>
                {currentPlanConfig.name}
              </Badge>
            </InlineStack>
            {subscriptionStatus?.isTrialing && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  试用期剩余 {subscriptionStatus.trialDays} 天
                  {subscriptionStatus.currentPeriodEnd && (
                    <>，将于 {new Date(subscriptionStatus.currentPeriodEnd).toLocaleDateString()} 结束</>
                  )}
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
                      {currentPlanConfig.name}
                    </Text>
                    {currentPlanConfig.tagline && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {currentPlanConfig.tagline}
                      </Text>
                    )}
                  </BlockStack>
                  <Badge tone="success">当前计划</Badge>
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
                  升级套餐
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
                                {planConfig.name}
                              </Text>
                              {planConfig.tagline && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {planConfig.tagline}
                                </Text>
                              )}
                            </BlockStack>
                            <Text as="span" variant="headingMd" fontWeight="bold">
                              ${planConfig.price}/月
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
                            loading={upgradingPlan === planId && navigation.state === "submitting"}
                            disabled={navigation.state === "submitting"}
                          >
                            升级到 {planConfig.name}
                          </Button>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              </>
            )}
            <Divider />
            <Text as="h3" variant="headingMd">
              套餐对比
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                需要帮助选择套餐？<a href="/app/support">联系我们的销售团队</a>获取个性化建议。
              </Text>
            </Banner>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
