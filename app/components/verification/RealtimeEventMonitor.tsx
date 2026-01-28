import { useState } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Divider,
} from "@shopify/polaris";
import {
  PlayIcon,
  PauseIcon,
} from "~/components/icons";
import { useRealtimeEvents } from "./RealtimeEventMonitor/useRealtimeEvents";
import { useEventFilters } from "./RealtimeEventMonitor/useEventFilters";
import { EventStream } from "./RealtimeEventMonitor/EventStream";
import { EventFilters } from "./RealtimeEventMonitor/EventFilters";
import { EventDetails } from "./RealtimeEventMonitor/EventDetails";
import { EventStats } from "./RealtimeEventMonitor/EventStats";


export interface RealtimeEvent {
  id: string;
  eventType: string;
  orderId?: string;
  orderNumber?: string;
  platform: string;
  timestamp: string | Date;
  status: "success" | "failed" | "pending" | "missing_params" | "not_tested";
  params?: {
    value?: number;
    currency?: string;
    items?: number;
    hasEventId?: boolean;
  };
  paramCompleteness?: {
    hasValue: boolean;
    hasCurrency: boolean;
    hasEventId: boolean;
    missingParams: string[];
    completeness: number;
  };
  trust?: {
    isTrusted: boolean;
    trustLevel: string;
    hasConsent: boolean;
  };
  errors?: string[];
  shopifyOrder?: {
    value: number;
    currency: string;
    itemCount: number;
  };
  discrepancies?: string[];
  platformResponse?: unknown;
}

export interface RealtimeEventMonitorProps {
  shopId: string;
  platforms?: string[];
  autoStart?: boolean;
  runId?: string;
  eventTypes?: string[];
  useVerificationEndpoint?: boolean;
}

export function RealtimeEventMonitor({
  shopId,
  platforms = [],
  autoStart = false,
  runId,
  eventTypes = [],
  useVerificationEndpoint = false,
}: RealtimeEventMonitorProps) {
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(null);
  const realtimeEvents = useRealtimeEvents({
    shopId,
    platforms,
    autoStart,
    runId,
    eventTypes,
    useVerificationEndpoint,
  });
  const {
    events,
    isConnected,
    isPaused,
    error,
    connect,
    disconnect,
    handlePauseToggle,
    handleClear,
  } = realtimeEvents;
  const filters = useEventFilters(events);
  const { filteredEvents } = filters;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              实时事件监控
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              实时查看像素事件的触发情况和参数
            </Text>
          </BlockStack>
          <InlineStack gap="200">
            {!isConnected ? (
              <Button onClick={connect} icon={PlayIcon} variant="primary">
                开始监控
              </Button>
            ) : (
              <>
                <Button
                  onClick={handlePauseToggle}
                  icon={isPaused ? PlayIcon : PauseIcon}
                  tone={isPaused ? "success" : undefined}
                >
                  {isPaused ? "恢复" : "暂停"}
                </Button>
                <Button onClick={disconnect}>停止</Button>
                <Button onClick={handleClear}>清空</Button>
              </>
            )}
          </InlineStack>
        </InlineStack>
        {error && (
          <Banner tone="critical" title="连接错误">
            {error}
          </Banner>
        )}
        {isConnected && !error && (
          <Banner tone="success" title="已连接">
            正在实时接收事件数据
            {isPaused && "（已暂停）"}
          </Banner>
        )}
        <EventStats filteredEvents={filteredEvents} events={events} />
        {events.length > 0 && <EventFilters filters={filters} />}
        <Divider />
        <EventStream
          events={events}
          filteredEvents={filteredEvents}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEvent}
          isConnected={isConnected}
        />
        {selectedEvent && (
          <>
            <Divider />
            <EventDetails event={selectedEvent} />
          </>
        )}
      </BlockStack>
    </Card>
  );
}

