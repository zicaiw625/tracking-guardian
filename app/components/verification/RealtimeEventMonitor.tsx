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
  Filters,
  ChoiceList,
  DataTable,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  PlayIcon,
  PauseIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { calculateEventStats, checkParamCompleteness } from "~/utils/event-param-completeness";
import { CheckoutCompletedBehaviorHint } from "./CheckoutCompletedBehaviorHint";

type BadgeTone = "success" | "warning" | "critical" | "info";
type ProgressBarTone = "success" | "highlight" | "critical" | "primary";

function getCompletenessTone(rate: number): BadgeTone {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "critical";
}

function getCompletenessProgressTone(rate: number): ProgressBarTone {
  if (rate >= 90) return "success";
  if (rate >= 70) return "highlight";
  return "critical";
}

function getConsistencyTone(rate: number): BadgeTone {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warning";
  return "critical";
}

function getConsistencyProgressTone(rate: number): ProgressBarTone {
  if (rate >= 95) return "success";
  if (rate >= 80) return "highlight";
  return "critical";
}

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
  const { showError } = useToastContext();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isPausedRef = useRef(isPaused);
  const showErrorRef = useRef(showError);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterEventType, setFilterEventType] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);
  const disconnectRef = useRef<(() => void) | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!autoStart) {
      return;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    isReconnectingRef.current = false;
    const getReconnectDelay = (attempts: number): number => {
      const baseDelay = 1000;
      const maxDelay = 30000;
      const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
      const jitter = Math.random() * 0.3 * delay;
      return delay + jitter;
    };
    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      try {
        const endpoint = useVerificationEndpoint ? "/api/verification-events" : "/api/realtime-events";
        const params = new URLSearchParams({
          shopId,
          ...(platforms.length > 0 && { platforms: platforms.join(",") }),
          ...(eventTypes.length > 0 && { eventTypes: eventTypes.join(",") }),
          ...(runId && { runId }),
        });
        const eventSource = new EventSource(`${endpoint}?${params.toString()}`);
        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
          reconnectAttemptsRef.current = 0;
          isReconnectingRef.current = false;
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };
        eventSource.onmessage = (event) => {
          if (isPausedRef.current) return;
          try {
            const rawData = JSON.parse(event.data);
            if (useVerificationEndpoint && rawData.type) {
              if (rawData.type === "connected" || rawData.type === "error" || rawData.type === "verification_run_status") {
                if (rawData.type === "verification_run_status" && rawData.status) {
                  if (process.env.NODE_ENV === "development") {
                    console.log("Verification run status:", rawData);
                  }
                }
                return;
              }
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { type: _type, ...eventData } = rawData;
              const data = eventData as unknown as RealtimeEvent;
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
                  return updated.slice(0, 200);
                }
                return [data, ...prev].slice(0, 200);
              });
            } else {
              const data = rawData as RealtimeEvent;
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
                  return updated.slice(0, 200);
                }
                return [data, ...prev].slice(0, 200);
              });
            }
          } catch (err) {
            if (process.env.NODE_ENV === "development") {
              console.error("Failed to parse event data:", err);
            }
          }
        };
        eventSource.onerror = (err) => {
          if (process.env.NODE_ENV === "development") {
            console.error("SSE error:", err);
          }
          setIsConnected(false);
          if (eventSource.readyState === EventSource.CLOSED && !isReconnectingRef.current) {
            isReconnectingRef.current = true;
            reconnectAttemptsRef.current += 1;
            const delay = getReconnectDelay(reconnectAttemptsRef.current);
            setError(`连接中断，${Math.round(delay / 1000)}秒后自动重连...`);
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
            reconnectTimeoutRef.current = setTimeout(() => {
              if (eventSourceRef.current === eventSource) {
                eventSourceRef.current = null;
              }
              eventSource.close();
              isReconnectingRef.current = false;
              connect();
            }, delay);
          }
        };
        eventSourceRef.current = eventSource;
      } catch (err) {
        setError("无法建立连接");
        showErrorRef.current("无法建立实时监控连接");
        if (process.env.NODE_ENV === "development") {
          console.error("SSE connection error:", err);
        }
        reconnectAttemptsRef.current += 1;
        const delay = getReconnectDelay(reconnectAttemptsRef.current);
        isReconnectingRef.current = true;
        reconnectTimeoutRef.current = setTimeout(() => {
          isReconnectingRef.current = false;
          connect();
        }, delay);
      }
    };
    const disconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.warn("Error closing EventSource:", error);
          }
        }
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      setError(null);
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
    };
    disconnectRef.current = disconnect;
    connectRef.current = connect;
    connect();
    return () => {
      disconnect();
      disconnectRef.current = null;
      connectRef.current = null;
    };
  }, [autoStart, shopId, platforms, runId, eventTypes, useVerificationEndpoint]);
  const connect = useCallback(() => {
    if (connectRef.current) {
      connectRef.current();
    }
  }, []);
  const disconnect = useCallback(() => {
    if (disconnectRef.current) {
      disconnectRef.current();
    }
  }, []);
  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);
  const handleClear = useCallback(() => {
    setEvents([]);
  }, []);
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filterPlatform !== "all" && event.platform !== filterPlatform) {
        return false;
      }
      if (filterStatus.length > 0 && !filterStatus.includes(event.status)) {
        return false;
      }
      if (filterEventType && event.eventType !== filterEventType) {
        return false;
      }
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
  const stats = useMemo(() => {
    const total = filteredEvents.length;
    const byStatus = {
      success: filteredEvents.filter(e => e.status === "success").length,
      failed: filteredEvents.filter(e => e.status === "failed").length,
      missing_params: filteredEvents.filter(e => e.status === "missing_params").length,
      not_tested: filteredEvents.filter(e => e.status === "not_tested").length,
    };
    const byPlatform = filteredEvents.reduce((acc, event) => {
      acc[event.platform] = (acc[event.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const byEventType = filteredEvents.reduce((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const eventsWithParams = filteredEvents.filter(e => e.params);
    const paramCompleteness = {
      hasValue: eventsWithParams.filter(e => e.params?.value !== undefined).length,
      hasCurrency: eventsWithParams.filter(e => e.params?.currency !== undefined).length,
      hasItems: eventsWithParams.filter(e => e.params?.items !== undefined && e.params?.items > 0).length,
      hasEventId: eventsWithParams.filter(e => e.params?.hasEventId).length,
    };
    const completenessRate = eventsWithParams.length > 0
      ? {
          value: (paramCompleteness.hasValue / eventsWithParams.length) * 100,
          currency: (paramCompleteness.hasCurrency / eventsWithParams.length) * 100,
          items: (paramCompleteness.hasItems / eventsWithParams.length) * 100,
          eventId: (paramCompleteness.hasEventId / eventsWithParams.length) * 100,
        }
      : { value: 0, currency: 0, items: 0, eventId: 0 };
    const eventsWithOrder = filteredEvents.filter(e => e.shopifyOrder && e.params?.value !== undefined);
    const valueConsistency = {
      total: eventsWithOrder.length,
      consistent: eventsWithOrder.filter(e => {
        const eventValue = e.params?.value || 0;
        const orderValue = e.shopifyOrder?.value || 0;
        return Math.abs(eventValue - orderValue) < 0.01;
      }).length,
      inconsistent: eventsWithOrder.filter(e => {
        const eventValue = e.params?.value || 0;
        const orderValue = e.shopifyOrder?.value || 0;
        return Math.abs(eventValue - orderValue) >= 0.01;
      }).length,
    };
    const consistencyRate = valueConsistency.total > 0
      ? (valueConsistency.consistent / valueConsistency.total) * 100
      : 0;
    return {
      total,
      byStatus,
      byPlatform,
      byEventType,
      paramCompleteness,
      completenessRate,
      valueConsistency,
      consistencyRate,
    };
  }, [filteredEvents]);
  const successRate = stats.total > 0
    ? Math.round((stats.byStatus.success / stats.total) * 100)
    : 0;
  const eventStats = useMemo(() => {
    return calculateEventStats(
      filteredEvents.map((e) => ({
        eventType: e.eventType,
        platform: e.platform,
        params: e.params,
      }))
    );
  }, [filteredEvents]);
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
        {stats.total > 0 && (
          <BlockStack gap="400">
            <BlockStack gap="300">
              <InlineStack gap="400" align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  总计: {stats.total} 条事件 {events.length !== filteredEvents.length && `(已过滤 ${events.length - filteredEvents.length} 条)`}
                </Text>
                <InlineStack gap="200">
                  <Badge tone="success">{`成功: ${stats.byStatus.success}`}</Badge>
                  <Badge tone="critical">{`失败: ${stats.byStatus.failed}`}</Badge>
                  <Badge tone="info">{`成功率: ${successRate}%`}</Badge>
                </InlineStack>
              </InlineStack>
              <ProgressBar
                progress={successRate}
                tone="success"
                size="small"
              />
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                触发次数统计
              </Text>
              <BlockStack gap="200">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h4" variant="headingSm">
                      按事件类型
                    </Text>
                    {Object.keys(eventStats.byEventType).length > 0 ? (
                      <DataTable
                        columnContentTypes={["text", "numeric"]}
                        headings={["事件类型", "触发次数"]}
                        rows={Object.entries(eventStats.byEventType)
                          .sort(([, a], [, b]) => b - a)
                          .map(([eventType, count]) => [
                            eventType,
                            count.toString(),
                          ])}
                        increasedTableDensity
                      />
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        暂无数据
                      </Text>
                    )}
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h4" variant="headingSm">
                      按平台
                    </Text>
                    {Object.keys(eventStats.byPlatform).length > 0 ? (
                      <DataTable
                        columnContentTypes={["text", "numeric"]}
                        headings={["平台", "触发次数"]}
                        rows={Object.entries(eventStats.byPlatform)
                          .sort(([, a], [, b]) => b - a)
                          .map(([platform, count]) => [
                            platform,
                            count.toString(),
                          ])}
                        increasedTableDensity
                      />
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        暂无数据
                      </Text>
                    )}
                  </BlockStack>
                </Card>
                {Object.keys(eventStats.byPlatformAndEventType).length > 0 && (
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h4" variant="headingSm">
                        按平台和事件类型
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "text", "numeric"]}
                        headings={["平台", "事件类型", "触发次数"]}
                        rows={Object.entries(eventStats.byPlatformAndEventType)
                          .flatMap(([platform, eventTypes]) =>
                            Object.entries(eventTypes).map(([eventType, count]) => [
                              platform,
                              eventType,
                              count.toString(),
                            ])
                          )
                          .sort(([, , a], [, , b]) => Number(b) - Number(a))}
                        increasedTableDensity
                      />
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                参数完整率
              </Text>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h4" variant="headingSm">
                      总体完整率
                    </Text>
                    <Badge
                      tone={getCompletenessTone(eventStats.paramCompleteness.overall)}
                    >
                      {`${eventStats.paramCompleteness.overall}%`}
                    </Badge>
                  </InlineStack>
                  <ProgressBar
                    progress={eventStats.paramCompleteness.overall}
                    tone={getCompletenessProgressTone(eventStats.paramCompleteness.overall)}
                  />
                  <InlineStack gap="400">
                    <Text as="span" variant="bodySm" tone="subdued">
                      完整: {eventStats.paramCompleteness.completeCount} 条
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      不完整: {eventStats.paramCompleteness.incompleteCount} 条
                    </Text>
                  </InlineStack>
                  {stats.completenessRate && (
                    <BlockStack gap="200">
                      <Divider />
                      <Text as="h4" variant="headingSm">
                        参数详细统计
                      </Text>
                      <DataTable
                        columnContentTypes={["text", "numeric", "numeric"]}
                        headings={["参数", "完整率", "数量"]}
                        rows={[
                          ["value", `${Math.round(stats.completenessRate.value)}%`, `${stats.paramCompleteness.hasValue}/${filteredEvents.filter(e => e.params).length}`],
                          ["currency", `${Math.round(stats.completenessRate.currency)}%`, `${stats.paramCompleteness.hasCurrency}/${filteredEvents.filter(e => e.params).length}`],
                          ["items", `${Math.round(stats.completenessRate.items)}%`, `${stats.paramCompleteness.hasItems}/${filteredEvents.filter(e => e.params).length}`],
                          ["event_id", `${Math.round(stats.completenessRate.eventId)}%`, `${stats.paramCompleteness.hasEventId}/${filteredEvents.filter(e => e.params).length}`],
                        ]}
                        increasedTableDensity
                      />
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
              {Object.keys(eventStats.paramCompleteness.byEventType).length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h4" variant="headingSm">
                      按事件类型
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "numeric"]}
                      headings={["事件类型", "完整率"]}
                      rows={Object.entries(eventStats.paramCompleteness.byEventType)
                        .sort(([, a], [, b]) => a - b)
                        .map(([eventType, rate]) => [
                          eventType,
                          `${rate}%`,
                        ])}
                      increasedTableDensity
                    />
                  </BlockStack>
                </Card>
              )}
              {Object.keys(eventStats.paramCompleteness.byPlatform).length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h4" variant="headingSm">
                      按平台
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "numeric"]}
                      headings={["平台", "完整率"]}
                      rows={Object.entries(eventStats.paramCompleteness.byPlatform)
                        .sort(([, a], [, b]) => a - b)
                        .map(([platform, rate]) => [
                          platform,
                          `${rate}%`,
                        ])}
                      increasedTableDensity
                    />
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
            {stats.valueConsistency.total > 0 && (
              <>
                <Divider />
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    金额一致性验证
                  </Text>
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h4" variant="headingSm">
                          一致性率
                        </Text>
                        <Badge
                          tone={getConsistencyTone(stats.consistencyRate)}
                        >
                          {`${Math.round(stats.consistencyRate)}%`}
                        </Badge>
                      </InlineStack>
                      <ProgressBar
                        progress={stats.consistencyRate}
                        tone={getConsistencyProgressTone(stats.consistencyRate)}
                      />
                      <InlineStack gap="400">
                        <Text as="span" variant="bodySm" tone="subdued">
                          一致: {stats.valueConsistency.consistent} 条
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          不一致: {stats.valueConsistency.inconsistent} 条
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          总计: {stats.valueConsistency.total} 条
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </>
            )}
          </BlockStack>
        )}
        {events.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="300">
              <Filters
                queryValue={searchQuery}
                filters={[]}
                onQueryChange={setSearchQuery}
                onQueryClear={() => setSearchQuery("")}
                onClearAll={() => {
                  setSearchQuery("");
                  setFilterPlatform("all");
                  setFilterStatus([]);
                  setFilterEventType("");
                }}
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

function EventDetails({ event }: { event: RealtimeEvent }) {
  useToastContext();
  const [expanded, setExpanded] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    params: true,
    completeness: true,
    shopify: true,
    errors: true,
    mapping: false,
    payload: false,
  });
  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);
  const completeness = useMemo(() => {
    return checkParamCompleteness(event.eventType, event.platform, event.params);
  }, [event.eventType, event.platform, event.params]);
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
                          {event.params.currency || ""} {typeof event.params.value === "number" ? event.params.value.toFixed(2) : event.params.value}
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
          <Card>
            <BlockStack gap="200">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleSection("completeness")}
                onKeyDown={(e) => e.key === "Enter" && toggleSection("completeness")}
                style={{ cursor: "pointer" }}
              >
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="semibold" variant="headingSm">
                    参数完整率
                  </Text>
                  <Text as="span" tone="subdued">
                    {expandedSections.completeness ? "▲ 收起" : "▼ 展开"}
                  </Text>
                </InlineStack>
              </div>
              <Collapsible open={expandedSections.completeness} id="event-details-completeness">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      完整率
                    </Text>
                    <Badge
                      tone={getCompletenessTone(completeness.completenessRate)}
                    >
                      {`${completeness.completenessRate}%`}
                    </Badge>
                  </InlineStack>
                  <ProgressBar
                    progress={completeness.completenessRate}
                    tone={getCompletenessProgressTone(completeness.completenessRate)}
                  />
                  {completeness.requiredParams.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        必需参数:
                      </Text>
                      <List type="bullet">
                        {completeness.requiredParams.map((param) => {
                          const isPresent = completeness.presentParams.includes(param);
                          const isMissing = completeness.missingParams.includes(param);
                          return (
                            <List.Item key={param}>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodySm">
                                  {param}
                                </Text>
                                {isPresent ? (
                                  <Badge tone="success">已包含</Badge>
                                ) : isMissing ? (
                                  <Badge tone="critical">缺失</Badge>
                                ) : (
                                  <Badge tone="warning">未知</Badge>
                                )}
                              </InlineStack>
                            </List.Item>
                          );
                        })}
                      </List>
                    </BlockStack>
                  )}
                  {completeness.missingParams.length > 0 && (
                    <Banner tone="warning" title="缺失参数">
                      <Text as="p" variant="bodySm">
                        以下必需参数缺失: {completeness.missingParams.join(", ")}
                      </Text>
                    </Banner>
                  )}
                  {completeness.isComplete && (
                    <Banner tone="success" title="参数完整">
                      <Text as="p" variant="bodySm">
                        所有必需参数均已包含。
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
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
                        {event.shopifyOrder.currency || ""} {typeof event.shopifyOrder.value === "number" ? event.shopifyOrder.value.toFixed(2) : event.shopifyOrder.value}
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
          {event.eventType === "checkout_completed" && event.status !== "success" && (
            <CheckoutCompletedBehaviorHint mode="missing" />
          )}
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
