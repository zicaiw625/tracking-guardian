import { Text, InlineStack , Icon } from "@shopify/polaris";
import { ClockIcon } from "../icons";

export interface TimeEstimateProps {
  minutes: number;
  variant?: "bodySm" | "bodyMd" | "bodyLg";
  showIcon?: boolean;
}

export function TimeEstimate({
  minutes,
  variant = "bodySm",
  showIcon = true,
}: TimeEstimateProps) {
  const formatTime = (): string => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (remainingMinutes === 0) {
      return `${hours} 小时`;
    }

    return `${hours} 小时 ${remainingMinutes} 分钟`;
  };

  return (
    <InlineStack gap="100" blockAlign="center">
      {showIcon && <Icon source={ClockIcon} tone="subdued" />}
      <Text as="span" variant={variant} tone="subdued">
        {formatTime()}
      </Text>
    </InlineStack>
  );
}
