

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Select,
  TextField,
  Filters,
  ChoiceList,
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
  
  // 过滤状态
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterEventType, setFilterEventType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

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
              // 性能优化：只保留最近200个事件
              return updated.slice(0, 200);
            }

            // 性能优化：只保留最近200个事件
            return [data, ...prev].slice(0, 200);
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

  // 性能优化：使用useMemo缓存过滤后的事件
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // 平台过滤
      if (filterPlatform !== "all" && event.platform !== filterPlatform) {
        return false;
      }

      // 状态过滤
      if (filterStatus.length > 0 && !filterStatus.includes(event.status)) {
        return false;
      }

      // 事件类型过滤
      if (filterEventType && event.eventType !== filterEventType) {
        return false;
      }

      // 搜索过滤
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesType = event.eventType.toLowerCase().includes(query);
        const matchesPlatform = event.platform.toLowerCase().includes(query);
        const matchesOrderId = event.orderId?.toLowerCase().includes(query) || false;
        const matchesOrderNumber = event.orderNumber?.toLowerCase().includes(query) || false;
        if (!matchesType && !matchesPlatform && !matchesOrderId && !matchesOrderNumber) {
          return false;
        }
      }

      return true;
    });
  }, [events, filterPlatform, filterStatus, filterEventType, searchQuery]);

  // 统计信息基于过滤后的事件
  const stats = useMemo(() => ({
    total: filteredEvents.length,
    success: filteredEvents.filter((e) => e.status === "success").length,
    failed: filteredEvents.filter((e) => e.status === "failed").length,
    pending: filteredEvents.filter((e) => e.status === "pending").length,
  }), [filteredEvents]);

  const successRate = stats.total > 0
    ? Math.round((stats.success / stats.total) * 100)
    : 0;

  // 获取所有唯一的平台和事件类型（用于过滤选项）
  const uniquePlatforms = useMemo(() => {
    const platformsSet = new Set(events.map(e => e.platform));
    return Array.from(platformsSet).sort();
  }, [events]);

  const uniqueEventTypes = useMemo(() => {
    const typesSet = new Set(events.map(e => e.eventType));
    return Array.from(typesSet).sort();
  }, [events]);

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
                总计: {stats.total} 条事件 {events.length !== filteredEvents.length && `(已过滤 ${events.length - filteredEvents.length} 条)`}
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

        {/* 过滤控件 */}
        {events.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="300">
              <Filters
                queryValue={searchQuery}
                filters={[]}
                onQueryChange={setSearchQuery}
                onQueryClear={() => setSearchQuery("")}
                queryPlaceholder="搜索事件类型、平台、订单ID..."
              />
              <InlineStack gap="300" wrap>
                <Box minWidth="200px">
                  <Select
                    label="平台"
                    labelHidden
                    options={[
                      { label: "所有平台", value: "all" },
                      ...uniquePlatforms.map(p => ({ label: p, value: p })),
                    ]}
                    value={filterPlatform}
                    onChange={setFilterPlatform}
                  />
                </Box>
                <Box minWidth="200px">
                  <Select
                    label="事件类型"
                    labelHidden
                    options={[
                      { label: "所有事件类型", value: "" },
                      ...uniqueEventTypes.map(t => ({ label: t, value: t })),
                    ]}
                    value={filterEventType}
                    onChange={setFilterEventType}
                  />
                </Box>
                <Box minWidth="200px">
                  <ChoiceList
                    title="状态"
                    titleHidden
                    choices={[
                      { label: "成功", value: "success" },
                      { label: "失败", value: "failed" },
                      { label: "待处理", value: "pending" },
                    ]}
                    selected={filterStatus}
                    onChange={setFilterStatus}
                    allowMultiple
                  />
                </Box>
                {(filterPlatform !== "all" || filterStatus.length > 0 || filterEventType || searchQuery) && (
                  <Button
                    variant="plain"
                    onClick={() => {
                      setFilterPlatform("all");
                      setFilterStatus([]);
                      setFilterEventType("");
                      setSearchQuery("");
                    }}
                  >
                    清除过滤
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </>
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
        ) : filteredEvents.length === 0 ? (
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200" align="center">
              <Text as="p" tone="subdued">
                没有符合过滤条件的事件
              </Text>
            </BlockStack>
          </Box>
        ) : (
          <BlockStack gap="200">
            {filteredEvents.map((event) => (
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    params: true,
    shopify: true,
    errors: true,
  });

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

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
          {/* 基本信息 */}
          <Card>
            <BlockStack gap="200">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleSection("basic")}
                onKeyDown={(e) => e.key === "Enter" && toggleSection("basic")}
                style={{ cursor: "pointer" }}
              >
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="semibold" variant="headingSm">
                    基本信息
                  </Text>
                  <Text as="span" tone="subdued">
                    {expandedSections.basic ? "▲ 收起" : "▼ 展开"}
                  </Text>
                </InlineStack>
              </div>
              <Collapsible open={expandedSections.basic} id="event-details-basic">
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
                  {event.orderNumber && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单号
                      </Text>
                      <Text as="span">#{event.orderNumber}</Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>

          {/* 事件参数 */}
          {event.params && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("params")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("params")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      事件参数
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.params ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.params} id="event-details-params">
                  <BlockStack gap="200">
                    {event.params.value !== undefined && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          金额
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {event.params.currency} {event.params.value.toFixed(2)}
                        </Text>
                      </InlineStack>
                    )}
                    {event.params.items !== undefined && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          商品数量
                        </Text>
                        <Text as="span" fontWeight="semibold">{event.params.items}</Text>
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
                </Collapsible>
              </BlockStack>
            </Card>
          )}

          {/* Shopify 订单对比 */}
          {event.shopifyOrder && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("shopify")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("shopify")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      Shopify 订单对比
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.shopify ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.shopify} id="event-details-shopify">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单金额
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {event.shopifyOrder.currency} {event.shopifyOrder.value.toFixed(2)}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        商品数量
                      </Text>
                      <Text as="span" fontWeight="semibold">{event.shopifyOrder.itemCount}</Text>
                    </InlineStack>
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          )}

          {/* 差异和错误 */}
          {((event.discrepancies && event.discrepancies.length > 0) || (event.errors && event.errors.length > 0)) && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("errors")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("errors")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      差异和错误
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.errors ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.errors} id="event-details-errors">
                  <BlockStack gap="200">
                    {event.discrepancies && event.discrepancies.length > 0 && (
                      <Banner tone="warning" title="发现差异">
                        <List type="bullet">
                          {event.discrepancies.map((disc, index) => (
                            <List.Item key={index}>{disc}</List.Item>
                          ))}
                        </List>
                      </Banner>
                    )}
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
            </Card>
          )}
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}

