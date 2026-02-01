import {
  Banner,
  Button,
  BlockStack,
  InlineStack,
  Text,
  List,
  Card,
} from "@shopify/polaris";
import { LockIcon } from "~/components/icons";
import { type PlanId } from "~/services/billing/plans";
import { isPlanAtLeast, getPlanDefinition } from "~/utils/plans";
import type { FeatureGateResult } from "~/services/billing/feature-gates.server";
import { useTranslation, Trans } from "react-i18next";

export interface UpgradePromptProps {
  feature: "pixel_destinations" | "ui_modules" | "verification" | "alerts" | "reconciliation" | "agency";
  currentPlan: PlanId;
  gateResult?: FeatureGateResult;
  current?: number;
  limit?: number;
  onUpgrade?: () => void;
  tone?: "info" | "warning" | "critical";
  compact?: boolean;
}

const FEATURE_CONFIG: Record<UpgradePromptProps["feature"], { requiredPlan: PlanId }> = {
  pixel_destinations: { requiredPlan: "starter" },
  ui_modules: { requiredPlan: "starter" },
  verification: { requiredPlan: "starter" },
  alerts: { requiredPlan: "growth" },
  reconciliation: { requiredPlan: "growth" },
  agency: { requiredPlan: "agency" },
};

export function UpgradePrompt({
  feature,
  currentPlan,
  gateResult,
  current,
  limit,
  onUpgrade,
  tone = "info",
  compact = false,
}: UpgradePromptProps) {
  const { t } = useTranslation();
  const config = FEATURE_CONFIG[feature];
  
  // Get translated info
  const name = t(`ui.upgrade.features.${feature}.name`);
  const description = t(`ui.upgrade.features.${feature}.description`);
  const listObj = t(`ui.upgrade.features.${feature}.list`, { returnObjects: true });
  const featureList = typeof listObj === 'object' && listObj !== null ? Object.values(listObj) : [];

  const requiredPlan = getPlanDefinition(config.requiredPlan);
  const currentPlanDef = getPlanDefinition(currentPlan);
  const isUpgradeNeeded = currentPlan !== "free" && !isPlanAtLeast(currentPlan, config.requiredPlan);
  const needsUpgrade = isUpgradeNeeded || (gateResult && !gateResult.allowed);
  
  if (!needsUpgrade && !gateResult) {
    return null;
  }
  
  const showLimitInfo = limit !== undefined && current !== undefined && current >= limit;
  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      window.location.href = "/app/billing";
    }
  };
  
  if (compact) {
    return (
      <Banner tone={tone}>
        <InlineStack gap="300" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodySm">
            {gateResult?.reason || t("ui.upgrade.lock.title", { name })}
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            {t("ui.upgrade.upgradeAction")}
          </Button>
        </InlineStack>
      </Banner>
    );
  }
  
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          <LockIcon />
          <Text as="h3" variant="headingMd">
            {t("ui.upgrade.lock.title", { name })}
          </Text>
        </InlineStack>
        <Text as="p" tone="subdued">
          {description}
        </Text>
        {showLimitInfo && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              {t("ui.upgrade.limit.info", { current, limit, name })}
              {limit === 0 && " " + t("ui.upgrade.limit.unsupported")}
            </Text>
          </Banner>
        )}
        {gateResult?.reason && (
          <Banner tone={tone}>
            <Text as="p" variant="bodySm">
              {gateResult.reason}
            </Text>
          </Banner>
        )}
        {featureList.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("ui.upgrade.requiredPlan.includes", { requiredPlan: requiredPlan.name })}
            </Text>
            <List type="bullet">
              {featureList.map((item, index) => (
                <List.Item key={index}>{item as string}</List.Item>
              ))}
            </List>
          </BlockStack>
        )}
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            <Trans i18nKey="ui.upgrade.currentPlan" values={{ plan: currentPlanDef.name }} components={{ strong: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Trans i18nKey="ui.upgrade.requiredPlan.label" values={{ plan: requiredPlan.name, price: requiredPlan.priceLabel }} components={{ strong: <strong /> }} />
          </Text>
        </BlockStack>
        <Button variant="primary" onClick={handleUpgrade} fullWidth>
          {t("ui.upgrade.upgradeTo", { plan: requiredPlan.name })}
        </Button>
      </BlockStack>
    </Card>
  );
}
