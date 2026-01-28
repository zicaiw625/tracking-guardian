import { BlockStack, Box, Text } from "@shopify/polaris";
import type { RealtimeEvent } from "../RealtimeEventMonitor";
import { EventItem } from "./EventItem";

interface EventStreamProps {
  events: RealtimeEvent[];
  filteredEvents: RealtimeEvent[];
  selectedEvent: RealtimeEvent | null;
  onSelectEvent: (event: RealtimeEvent | null) => void;
  isConnected: boolean;
}

export function EventStream({
  events,
  filteredEvents,
  selectedEvent,
  onSelectEvent,
  isConnected,
}: EventStreamProps) {
  if (events.length === 0) {
    return (
      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
        <BlockStack gap="200" align="center">
          <Text as="p" tone="subdued">
            {isConnected
              ? "等待事件触发..."
              : "点击「开始监控」开始接收实时事件"}
          </Text>
        </BlockStack>
      </Box>
    );
  }
  if (filteredEvents.length === 0) {
    return (
      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
        <BlockStack gap="200" align="center">
          <Text as="p" tone="subdued">
            没有符合过滤条件的事件
          </Text>
        </BlockStack>
      </Box>
    );
  }
  return (
    <BlockStack gap="200">
      {filteredEvents.map((event) => (
        <EventItem
          key={event.id}
          event={event}
          isSelected={selectedEvent?.id === event.id}
          onSelect={() => onSelectEvent(event.id === selectedEvent?.id ? null : event)}
        />
      ))}
    </BlockStack>
  );
}
