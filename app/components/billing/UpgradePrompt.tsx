import {
  Card,
  Banner,
  BlockStack,
  InlineStack,
  Button,
  Text,
  List,
  Badge,
  Divider,
} from "@shopify/polaris";
import type { PlanId } from "~/services/billing/plans";
import { getUpgradeOptions, getPlanConfig } from "~/services/billing/plans";

export interface UpgradePromptProps {
  currentPlan: PlanId;
  requiredFeature?: "verification" | "alerts" | "reconciliation" | "agency" | "pixel_destinations" | "ui_modules";
  currentUsage?: number;
  limit?: number;
  onUpgrade?: (targetPlan: PlanId) => void;
}

export function UpgradePrompt({
  currentPlan,
  requiredFeature,
  currentUsage,
  limit,
  onUpgrade,
}: UpgradePromptProps) {
  const upgradeOptions = getUpgradeOptions(currentPlan);
  const recommendedPlan = upgradeOptions[0];

  if (!recommendedPlan) {
    return null;
  }

  const recommendedPlanConfig = getPlanConfig(recommendedPlan);
  const currentPlanConfig = getPlanConfig(currentPlan);

  const getFeatureRequirement = () => {
    if (!requiredFeature) return null;

    const featureNames: Record<typeof requiredFeature, string> = {
      verification: "验收功能",
      alerts: "告警功能",
      reconciliation: "事件对账",
      agency: "Agency 多店功能",
      pixel_destinations: "更多像素目的地",
      ui_modules: "更多 UI 模块",
    };

    const requiredPlans: Record<typeof requiredFeature, PlanId> = {
      verification: "starter",
      alerts: "growth",
      reconciliation: "growth",
      agency: "agency",
      pixel_destinations: "starter",
      ui_modules: "starter",
    };

    return {
      name: featureNames[requiredFeature],
      requiredPlan: requiredPlans[requiredFeature],
    };
  };

  const featureReq = getFeatureRequirement();

  return (
    <Card>
      <Banner tone="info" title="功能需要升级套餐">
        <BlockStack gap="400">
          {featureReq && (
            <Text as="p" variant="bodySm">
              <strong>{featureReq.name}</strong> 需要 <strong>{getPlanConfig(featureReq.requiredPlan).name}</strong> 及以上套餐。
              当前套餐：<strong>{currentPlanConfig.name}</strong>
            </Text>
          )}

          {currentUsage !== undefined && limit !== undefined && (
            <Text as="p" variant="bodySm">
              当前使用量：<strong>{currentUsage}</strong> / {limit === -1 ? "无限" : limit}
              {limit !== -1 && currentUsage >= limit && "（已达上限）"}
            </Text>
          )}

          <Divider />

          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              推荐升级：{recommendedPlanConfig.name}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {recommendedPlanConfig.tagline}
            </Text>

            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                包含功能：
              </Text>
              <List type="bullet">
                {recommendedPlanConfig.features.slice(0, 5).map((feature, index) => (
                  <List.Item key={index}>
                    <Text as="span" variant="bodySm">
                      {feature}
                    </Text>
                  </List.Item>
                ))}
                {recommendedPlanConfig.features.length > 5 && (
                  <List.Item>
                    <Text as="span" variant="bodySm" tone="subdued">
                      还有 {recommendedPlanConfig.features.length - 5} 项功能...
                    </Text>
                  </List.Item>
                )}
              </List>
            </BlockStack>

            <InlineStack gap="200" align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="headingLg" fontWeight="bold">
                  ${recommendedPlanConfig.price}/月
                </Text>
                {"trialDays" in recommendedPlanConfig && recommendedPlanConfig.trialDays && (
                  <Badge tone="info">
                    {`${String(recommendedPlanConfig.trialDays)} 天免费试用`}
                  </Badge>
                )}
              </BlockStack>
              <Button
                variant="primary"
                size="large"
                onClick={() => {
                  if (onUpgrade) {
                    onUpgrade(recommendedPlan);
                  } else {
                    window.location.href = `/app/billing?upgrade=${recommendedPlan}`;
                  }
                }}
              >
                立即升级
              </Button>
            </InlineStack>
          </BlockStack>

          {upgradeOptions.length > 1 && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                也可以选择其他套餐：
                {upgradeOptions.slice(1).map((planId) => {
                  const plan = getPlanConfig(planId);
                  return (
                    <Button
                      key={planId}
                      size="slim"
                      variant="plain"
                      onClick={() => {
                        if (onUpgrade) {
                          onUpgrade(planId);
                        } else {
                          window.location.href = `/app/billing?upgrade=${planId}`;
                        }
                      }}
                    >
                      {plan.name} (${String(plan.price)}/月)
                    </Button>
                  );
                })}
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Banner>
    </Card>
  );
}
