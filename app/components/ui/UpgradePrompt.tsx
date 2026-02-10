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

const FEATURE_KEYS: Record<
  UpgradePromptProps["feature"],
  {
    nameKey: string;
    descKey: string;
    listKey: string;
    requiredPlan: PlanId;
  }
> = {
  pixel_destinations: {
    nameKey: "upgradePrompt.features.pixel_destinations.name",
    descKey: "upgradePrompt.features.pixel_destinations.description",
    listKey: "upgradePrompt.features.pixel_destinations.list",
    requiredPlan: "starter",
  },
  ui_modules: {
    nameKey: "upgradePrompt.features.ui_modules.name",
    descKey: "upgradePrompt.features.ui_modules.description",
    listKey: "upgradePrompt.features.ui_modules.list",
    requiredPlan: "starter",
  },
  verification: {
    nameKey: "upgradePrompt.features.verification.name",
    descKey: "upgradePrompt.features.verification.description",
    listKey: "upgradePrompt.features.verification.list",
    requiredPlan: "starter",
  },
  alerts: {
    nameKey: "upgradePrompt.features.alerts.name",
    descKey: "upgradePrompt.features.alerts.description",
    listKey: "upgradePrompt.features.alerts.list",
    requiredPlan: "growth",
  },
  reconciliation: {
    nameKey: "upgradePrompt.features.reconciliation.name",
    descKey: "upgradePrompt.features.reconciliation.description",
    listKey: "upgradePrompt.features.reconciliation.list",
    requiredPlan: "growth",
  },
  agency: {
    nameKey: "upgradePrompt.features.agency.name",
    descKey: "upgradePrompt.features.agency.description",
    listKey: "upgradePrompt.features.agency.list",
    requiredPlan: "agency",
  },
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
  const info = FEATURE_KEYS[feature];
  const requiredPlan = getPlanDefinition(info.requiredPlan);
  const currentPlanDef = getPlanDefinition(currentPlan);
  const isUpgradeNeeded = currentPlan !== "free" && !isPlanAtLeast(currentPlan, info.requiredPlan);
  const needsUpgrade = isUpgradeNeeded || (gateResult && !gateResult.allowed);
  
  if (!needsUpgrade && !gateResult) {
    return null;
  }
  
  const featureName = t(info.nameKey);
  const featureDesc = t(info.descKey);
  const featureList = t(info.listKey, { returnObjects: true }) as string[];

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
            {gateResult?.reason || t("upgradePrompt.required", { feature: featureName, plan: requiredPlan.name })}
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            {t("upgradePrompt.upgrade")}
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
            {t("upgradePrompt.title", { feature: featureName })}
          </Text>
        </InlineStack>
        <Text as="p" tone="subdued">
          {featureDesc}
        </Text>
        {showLimitInfo && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              {t("upgradePrompt.usage", { current, limit, feature: featureName })}
              {limit === 0 && t("upgradePrompt.notSupported")}
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
        {featureList && featureList.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("upgradePrompt.planIncludes", { plan: requiredPlan.name })}
            </Text>
            <List type="bullet">
              {featureList.map((item, index) => (
                <List.Item key={index}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        )}
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            <Trans i18nKey="upgradePrompt.currentPlan" values={{ plan: currentPlanDef.name }} components={{ bold: <strong /> }} />
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Trans i18nKey="upgradePrompt.neededPlan" values={{ plan: requiredPlan.name, price: requiredPlan.priceLabel }} components={{ bold: <strong /> }} />
          </Text>
        </BlockStack>
        <Button variant="primary" onClick={handleUpgrade} fullWidth>
          {t("upgradePrompt.upgradeTo", { plan: requiredPlan.name })}
        </Button>
      </BlockStack>
    </Card>
  );
}
