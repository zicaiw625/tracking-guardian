import { Badge, InlineStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

interface FreeFeatureBadgeProps {
  feature: "scan" | "report" | "checklist" | "migration";
}

export function FreeFeatureBadge({ feature }: FreeFeatureBadgeProps) {
  const { t } = useTranslation();
  return (
    <InlineStack gap="100" blockAlign="center">
      <Badge tone="success" size="small">
        {t(`scan.freeFeatureBadge.${feature}`)}
      </Badge>
    </InlineStack>
  );
}
