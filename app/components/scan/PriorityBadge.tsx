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
  const getLabel = (): string => {
    if (priority >= 8) {
      return t("priorityBadge.high");
    } else if (priority >= 5) {
      return t("priorityBadge.medium");
    } else if (priority >= 3) {
      return t("priorityBadge.low");
    }
    return t("priorityBadge.lowest");
  };
  return (
    <Badge tone={getTone()} size={size}>
      {`${getLabel()} (${priority}/10)`}
    </Badge>
  );
}
