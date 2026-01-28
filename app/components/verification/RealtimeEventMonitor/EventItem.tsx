import { useMemo } from "react";
import { Box, InlineStack, BlockStack, Text, Badge, Icon } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";
import { checkParamCompleteness } from "~/utils/event-param-completeness";
import type { RealtimeEvent } from "../RealtimeEventMonitor";

function getCompletenessTone(rate: number): "success" | "warning" | "critical" | "info" {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "critical";
}

interface EventItemProps {
  event: RealtimeEvent;
  isSelected: boolean;
  onSelect: () => void;
}

export function EventItem({ event, isSelected, onSelect }: EventItemProps) {
  const timeStr = new Date(event.timestamp).toLocaleTimeString("zh-CN");
  const completeness = useMemo(() => {
    return checkParamCompleteness(event.eventType, event.platform, event.params);
  }, [event.eventType, event.platform, event.params]);
  return (
    <div onClick={onSelect} style={{ cursor: "pointer" }}>
      <Box
        background={isSelected ? "bg-surface-info" : "bg-surface-secondary"}
        padding="300"
        borderRadius="200"
      >
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Icon
              source={event.status === "success" ? CheckCircleIcon : AlertCircleIcon}
              tone={event.status === "success" ? "success" : "critical"}
            />
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  {event.eventType}
                </Text>
                <Badge>{event.platform}</Badge>
                {event.orderNumber && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    订单 #{event.orderNumber}
                  </Text>
                )}
                <Badge
                  tone={getCompletenessTone(completeness.completenessRate)}
                >
                  {`参数: ${completeness.completenessRate}%`}
                </Badge>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {timeStr}
              </Text>
            </BlockStack>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={event.status === "success" ? "success" : "critical"}>
              {event.status === "success" ? "成功" : "失败"}
            </Badge>
          </InlineStack>
        </InlineStack>
      </Box>
    </div>
  );
}
