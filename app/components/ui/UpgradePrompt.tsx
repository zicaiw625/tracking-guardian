import {
  Banner,
  Button,
  BlockStack,
  InlineStack,
  Text,
  List,
  Card,
} from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { LockIcon } from "~/components/icons";
import { type PlanId } from "~/services/billing/plans";
import { isPlanAtLeast, getPlanDefinition } from "~/utils/plans";
import type { FeatureGateResult } from "~/services/billing/feature-gates.server";
import { useTranslation } from "react-i18next";

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
  { key: string; requiredPlan: PlanId }
> = {
  pixel_destinations: { key: "pixelDestinations", requiredPlan: "starter" },
  ui_modules: { key: "uiModules", requiredPlan: "starter" },
  verification: { key: "verification", requiredPlan: "starter" },
  alerts: { key: "alerts", requiredPlan: "growth" },
  reconciliation: { key: "reconciliation", requiredPlan: "growth" },
  agency: { key: "agency", requiredPlan: "agency" },
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
  const navigate = useNavigate();
  const featureInfo = FEATURE_KEYS[feature];
  const requiredPlan = getPlanDefinition(featureInfo.requiredPlan);
  const currentPlanDef = getPlanDefinition(currentPlan);
  const isUpgradeNeeded = currentPlan !== "free" && !isPlanAtLeast(currentPlan, featureInfo.requiredPlan);
  const needsUpgrade = isUpgradeNeeded || (gateResult && !gateResult.allowed);
  if (!needsUpgrade && !gateResult) {
    return null;
  }
  const showLimitInfo = limit !== undefined && current !== undefined && current >= limit;
  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      navigate("/app/billing");
    }
  };

  const featureName = t(`upgradePrompt.features.${featureInfo.key}.name`);
  const featureDesc = t(`upgradePrompt.features.${featureInfo.key}.description`);
  const featureListKeys: string[] = t(`upgradePrompt.features.${featureInfo.key}.featureList`, { returnObjects: true }) as unknown as string[];
  const translatedRequiredPlan = t(requiredPlan.name);
  const translatedCurrentPlan = t(currentPlanDef.name);

  if (compact) {
    return (
      <Banner tone={tone}>
        <InlineStack gap="300" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodySm">
            {gateResult?.reasonKey
              ? t(gateResult.reasonKey, gateResult.reasonParams)
              : gateResult?.reason || t("upgradePrompt.requiresPlan", { feature: featureName, plan: translatedRequiredPlan })}
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            {t("upgradePrompt.upgradeButton")}
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
              {t("upgradePrompt.limitReached", { current, limit, feature: featureName })}
              {limit === 0 && t("upgradePrompt.notSupported")}
            </Text>
          </Banner>
        )}
        {gateResult?.reason && (
          <Banner tone={tone}>
            <Text as="p" variant="bodySm">
              {gateResult.reasonKey
                ? t(gateResult.reasonKey, gateResult.reasonParams)
                : gateResult.reason}
            </Text>
          </Banner>
        )}
        {Array.isArray(featureListKeys) && featureListKeys.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("upgradePrompt.planIncludes", { plan: translatedRequiredPlan })}
            </Text>
            <List type="bullet">
              {featureListKeys.map((item, index) => (
                <List.Item key={index}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        )}
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("upgradePrompt.currentPlan")}<strong>{translatedCurrentPlan}</strong>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("upgradePrompt.requiredPlan")}<strong>{translatedRequiredPlan}</strong>{t("upgradePrompt.pricePerMonth", { price: requiredPlan.priceLabel })}
          </Text>
        </BlockStack>
        <Button variant="primary" onClick={handleUpgrade} fullWidth>
          {t("upgradePrompt.upgradeTo", { plan: translatedRequiredPlan })}
        </Button>
      </BlockStack>
    </Card>
  );
}
