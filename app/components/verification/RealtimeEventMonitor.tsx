

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  Icon,
  Collapsible,
  ProgressBar,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  RefreshIcon,
  PlayIcon,
  PauseIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";

export interface RealtimeEvent {
  id: string;
  eventType: string;
  orderId?: string;
  orderNumber?: string;
  platform: string;
  timestamp: string | Date;
  status: "success" | "failed" | "pending";
  params?: {
    value?: number;
    currency?: string;
    items?: number;
    hasEventId?: boolean;
  };
  errors?: string[];
  shopifyOrder?: {
    value: number;
    currency: string;
    itemCount: number;
  };
  discrepancies?: string[];
}

export interface RealtimeEventMonitorProps {
  shopId: string;
  platforms?: string[];
  autoStart?: boolean;
}

export function RealtimeEventMonitor({
  shopId,
  platforms = [],
  autoStart = false,
}: RealtimeEventMonitorProps) {
  const { showError } = useToastContext();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const params = new URLSearchParams({
        shopId,
        ...(platforms.length > 0 && { platforms: platforms.join(",") }),
      });
      const eventSource = new EventSource(`/api/realtime-events?${params.toString()}`);

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        if (isPaused) return;

        try {
          const data = JSON.parse(event.data) as RealtimeEvent;

          if (typeof data.timestamp === "string") {
            data.timestamp = new Date(data.timestamp);
          }

          setEvents((prev) => {

            const eventKey = data.id || `${data.timestamp}_${data.orderId || ""}`;
            const existingIndex = prev.findIndex(e =>
              e.id === eventKey ||
              (e.timestamp === data.timestamp && e.orderId === data.orderId)
            );

            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = data;
              return updated.slice(0, 100);
            }

            return [data, ...prev].slice(0, 100);
          });
        } catch (err) {
          console.error("Failed to parse event data:", err);
        }
      };

      eventSource.onerror = (err) => {
        console.error("SSE error:", err);
        setIsConnected(false);
        setError("连接中断，请刷新页面重试");
        eventSource.close();
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      setError("无法建立连接");
      showError("无法建立实时监控连接");
    }
  }, [shopId, platforms, isPaused, showError]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (autoStart) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoStart, connect, disconnect]);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
  }, []);

  const stats = {
    total: events.length,
    success: events.filter((e) => e.status === "success").length,
    failed: events.filter((e) => e.status === "failed").length,
    pending: events.filter((e) => e.status === "pending").length,
  };

  const successRate = stats.total > 0
    ? Math.round((stats.success / stats.total) * 100)
    : 0;

  return (
    <Card>
      <BlockStack gap="400">
        {}
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

        {}
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

        {}
        {stats.total > 0 && (
          <BlockStack gap="300">
            <InlineStack gap="400" align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                总计: {stats.total} 条事件
              </Text>
              <InlineStack gap="200">
                <Badge tone="success">成功: {stats.success}</Badge>
                <Badge tone="critical">失败: {stats.failed}</Badge>
                <Badge tone="info">成功率: {successRate}%</Badge>
              </InlineStack>
            </InlineStack>
            <ProgressBar
              progress={successRate}
              tone="success"
              size="small"
            />
          </BlockStack>
        )}

        <Divider />

        {}
        {events.length === 0 ? (
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200" align="center">
              <Text as="p" tone="subdued">
                {isConnected
                  ? "等待事件触发..."
                  : "点击「开始监控」开始接收实时事件"}
              </Text>
            </BlockStack>
          </Box>
        ) : (
          <BlockStack gap="200">
            {events.map((event) => (
              <EventItem
                key={event.id}
                event={event}
                isSelected={selectedEvent?.id === event.id}
                onSelect={() => setSelectedEvent(event.id === selectedEvent?.id ? null : event)}
              />
            ))}
          </BlockStack>
        )}

        {}
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

function EventItem({
  event,
  isSelected,
  onSelect,
}: {
  event: RealtimeEvent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const timeStr = new Date(event.timestamp).toLocaleTimeString("zh-CN");

  return (
    <Box
      background={isSelected ? "bg-surface-info" : "bg-surface-secondary"}
      padding="300"
      borderRadius="200"
      onClick={onSelect}
      style={{ cursor: "pointer" }}
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
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">
              {timeStr}
            </Text>
          </BlockStack>
        </InlineStack>
        <Badge tone={event.status === "success" ? "success" : "critical"}>
          {event.status === "success" ? "成功" : "失败"}
        </Badge>
      </InlineStack>
    </Box>
  );
}

function EventDetails({ event }: { event: RealtimeEvent }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <BlockStack gap="300">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
        style={{ cursor: "pointer" }}
      >
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" fontWeight="semibold">
            事件详情
          </Text>
          <Text as="span" tone="subdued">
            {expanded ? "▲ 收起" : "▼ 展开"}
          </Text>
        </InlineStack>
      </div>

      <Collapsible open={expanded} id="event-details">
        <BlockStack gap="300">
          {}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  事件类型
                </Text>
                <Text as="span" fontWeight="semibold">
                  {event.eventType}
                </Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  平台
                </Text>
                <Badge>{event.platform}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  时间
                </Text>
                <Text as="span">
                  {new Date(event.timestamp).toLocaleString("zh-CN")}
                </Text>
              </InlineStack>
              {event.orderId && (
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    订单 ID
                  </Text>
                  <Text as="span">{event.orderId}</Text>
                </InlineStack>
              )}
            </BlockStack>
          </Box>

          {}
          {event.params && (
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text as="h4" variant="headingSm" fontWeight="semibold">
                事件参数
              </Text>
              <BlockStack gap="200">
                {event.params.value !== undefined && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      金额
                    </Text>
                    <Text as="span">
                      {event.params.currency} {event.params.value.toFixed(2)}
                    </Text>
                  </InlineStack>
                )}
                {event.params.items !== undefined && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      商品数量
                    </Text>
                    <Text as="span">{event.params.items}</Text>
                  </InlineStack>
                )}
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    包含 Event ID
                  </Text>
                  <Badge tone={event.params.hasEventId ? "success" : "warning"}>
                    {event.params.hasEventId ? "是" : "否"}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          {}
          {event.shopifyOrder && (
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text as="h4" variant="headingSm" fontWeight="semibold">
                Shopify 订单对比
              </Text>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    订单金额
                  </Text>
                  <Text as="span">
                    {event.shopifyOrder.currency} {event.shopifyOrder.value.toFixed(2)}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    商品数量
                  </Text>
                  <Text as="span">{event.shopifyOrder.itemCount}</Text>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          {}
          {event.discrepancies && event.discrepancies.length > 0 && (
            <Banner tone="warning" title="发现差异">
              <List type="bullet">
                {event.discrepancies.map((disc, index) => (
                  <List.Item key={index}>{disc}</List.Item>
                ))}
              </List>
            </Banner>
          )}

          {}
          {event.errors && event.errors.length > 0 && (
            <Banner tone="critical" title="错误">
              <List type="bullet">
                {event.errors.map((err, index) => (
                  <List.Item key={index}>{err}</List.Item>
                ))}
              </List>
            </Banner>
          )}
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}

