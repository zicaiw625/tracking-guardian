import { Badge, InlineStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

interface FreeFeatureBadgeProps {
  feature: "scan" | "report" | "checklist" | "migration";
}

const FEATURE_KEYS: Record<FreeFeatureBadgeProps["feature"], string> = {
  scan: "freeFeatureBadge.scan",
  report: "freeFeatureBadge.report",
  checklist: "freeFeatureBadge.checklist",
  migration: "freeFeatureBadge.migration",
};

export function FreeFeatureBadge({ feature }: FreeFeatureBadgeProps) {
  const { t } = useTranslation();
  return (
    <InlineStack gap="100" blockAlign="center">
      <Badge tone="success" size="small">
        {t(FEATURE_KEYS[feature])}
      </Badge>
    </InlineStack>
  );
}
