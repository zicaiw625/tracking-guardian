import { Text, InlineStack , Icon } from "@shopify/polaris";
import { ClockIcon } from "../icons";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const formatTime = (): string => {
    if (minutes < 60) {
      return t("timeEstimate.minutes", { count: minutes });
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return t("timeEstimate.hours", { count: hours });
    }
    return t("timeEstimate.hoursAndMinutes", { hours, minutes: remainingMinutes });
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
