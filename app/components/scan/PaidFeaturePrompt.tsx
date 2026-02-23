import { Banner, Button, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { useNavigate } from "@remix-run/react";
import { LockIcon } from "~/components/icons";
import type { PlanId } from "~/services/billing/plans";
import { getPlanDefinition } from "~/utils/plans";
import { useTranslation, Trans } from "react-i18next";

interface PaidFeaturePromptProps {
  feature: "pixel_migration" | "batch_audit" | "export_report" | "verification";
  currentPlan: PlanId;
  compact?: boolean;
}

export function PaidFeaturePrompt({
  feature,
  currentPlan,
  compact = false,
}: PaidFeaturePromptProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const requiredPlanId = {
    pixel_migration: "starter",
    batch_audit: "agency",
    export_report: "growth",
    verification: "starter",
  }[feature] as PlanId;

  const featureKey = {
    pixel_migration: "pixelMigration",
    batch_audit: "batchAudit",
    export_report: "exportReport",
    verification: "verification",
  }[feature];

  const requiredPlan = getPlanDefinition(requiredPlanId);
  const currentPlanDef = getPlanDefinition(currentPlan);

  const handleUpgrade = () => {
    navigate("/app/billing");
  };

  if (compact) {
    return (
      <Banner tone="info">
        <InlineStack gap="300" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodySm">
            {t("scan.paidFeature.requirementCompact", {
              name: t(`scan.paidFeature.${featureKey}.name`),
              plan: requiredPlan.name
            })}
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            {t(`scan.paidFeature.${featureKey}.cta`)}
          </Button>
        </InlineStack>
      </Banner>
    );
  }
  return (
    <Banner tone="info">
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {t(`scan.paidFeature.${featureKey}.name`)}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm">
          {t(`scan.paidFeature.${featureKey}.desc`)}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          <Trans
            i18nKey="scan.paidFeature.requirement"
            values={{ current: t(currentPlanDef.name), required: t(requiredPlan.name) }}
            components={{ bold: <strong /> }}
          />
        </Text>
        <Button variant="primary" size="medium" onClick={handleUpgrade}>
          {t(`scan.paidFeature.${featureKey}.cta`)}
        </Button>
      </BlockStack>
    </Banner>
  );
}
