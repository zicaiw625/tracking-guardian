import { Badge } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export interface PriorityBadgeProps {
  priority: number;
  size?: "small" | "medium" | "large";
}

export function PriorityBadge({ priority, size = "medium" }: PriorityBadgeProps) {
  const { t } = useTranslation();
  const getTone = (): "critical" | "warning" | "info" | "success" => {
    if (priority >= 8) {
      return "critical";
    } else if (priority >= 5) {
      return "warning";
    } else if (priority >= 3) {
      return "info";
    }
    return "success";
  };
  const getLabelKey = (): string => {
    if (priority >= 8) {
      return "high";
    } else if (priority >= 5) {
      return "medium";
    } else if (priority >= 3) {
      return "low";
    }
    return "lowest";
  };
  const label = t(`scan.priority.${getLabelKey()}`);
  return (
    <Badge tone={getTone()} size={size}>
      {t("scan.priority.label", { label, priority })}
    </Badge>
  );
}
