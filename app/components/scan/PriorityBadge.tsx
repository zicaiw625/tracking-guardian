import { Badge } from "@shopify/polaris";

export interface PriorityBadgeProps {
  priority: number;
  size?: "small" | "medium" | "large";
}

export function PriorityBadge({ priority, size = "medium" }: PriorityBadgeProps) {
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
      return "高优先级";
    } else if (priority >= 5) {
      return "中优先级";
    } else if (priority >= 3) {
      return "低优先级";
    }
    return "最低优先级";
  };
  return (
    <Badge tone={getTone()} size={size}>
      {`${getLabel()} (${priority}/10)`}
    </Badge>
  );
}
