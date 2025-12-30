
import { Badge, InlineStack, Text } from "@shopify/polaris";

interface FreeFeatureBadgeProps {
  feature: "scan" | "report" | "checklist" | "migration";
}

const FEATURE_LABELS: Record<FreeFeatureBadgeProps["feature"], string> = {
  scan: "免费扫描",
  report: "免费报告",
  checklist: "免费清单",
  migration: "免费建议",
};

export function FreeFeatureBadge({ feature }: FreeFeatureBadgeProps) {
  return (
    <InlineStack gap="100" blockAlign="center">
      <Badge tone="success" size="small">
        {FEATURE_LABELS[feature]}
      </Badge>
    </InlineStack>
  );
}

