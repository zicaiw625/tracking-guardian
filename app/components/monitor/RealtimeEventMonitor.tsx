

import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
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
  TextField,
  Select,
  DataTable,
  Scrollable,
  Modal,
  List,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  RefreshIcon,
  PlayIcon,
  PauseIcon,
  SearchIcon,
} from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { PLATFORM_NAMES, isValidPlatform } from "~/types";

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
  };
  errorMessage?: string;
  payload?: Record<string, unknown>;
  attempts?: number;
  retryCount?: number;
  responseTime?: number;
  details?: {
    eventId?: string;
    platformResponse?: unknown;
    metadata?: Record<string, unknown>;
  };
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
  const eventSourceRef = useRef<EventSource | null>(null);

  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<RealtimeEvent | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
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
        if (isPausedRef.current) return;

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
              return updated.slice(0, 200);
            }

            return [data, ...prev].slice(0, 200);
          });
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
        setError("连接中断，请刷新页面重试");
        eventSource.close();
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      setError("无法建立连接");
      showError("无法建立实时监控连接");

      if (process.env.NODE_ENV === "development") {

        console.error("SSE connection error:", err);
      }
    }
  }, [shopId, platforms, showError]);

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

  }, [autoStart, shopId, platforms]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          event.orderId?.toLowerCase().includes(query) ||
          event.orderNumber?.toLowerCase().includes(query) ||
          event.eventType.toLowerCase().includes(query) ||
          event.platform.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      if (statusFilter !== "all" && event.status !== statusFilter) {
        return false;
      }

      if (platformFilter !== "all" && event.platform !== platformFilter) {
        return false;
      }

      return true;
    });
  }, [events, searchQuery, statusFilter, platformFilter]);

  const platformList = useMemo(() => {
    return Array.from(new Set(events.map(e => e.platform)));
  }, [events]);

  const formatTime = useCallback((timestamp: Date | string) => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, []);

  const rows = useMemo(() => {
    return filteredEvents.map((event) => {
    const platformName = isValidPlatform(event.platform)
      ? PLATFORM_NAMES[event.platform]
      : event.platform;

    return [
      formatTime(event.timestamp),
      event.eventType,
      platformName,
      event.orderId || "-",
      event.orderNumber || "-",
      event.params?.value
        ? `${event.params.value} ${event.params.currency || ""}`
        : "-",
      event.status === "success" ? (
        <Badge tone="success">成功</Badge>
      ) : event.status === "failed" ? (
        <Badge tone="critical">失败</Badge>
      ) : (
        <Badge tone="info">处理中</Badge>
      ),
      <Button
        key={event.id}
        size="slim"
        variant="plain"
        onClick={() => {
          setSelectedEvent(event);
          setShowDetailsModal(true);
        }}
      >
        查看详情
      </Button>,
    ];
  });
  }, [filteredEvents, formatTime]);

  const headings = useMemo(() => [
    "时间",
    "事件类型",
    "平台",
    "订单ID",
    "订单号",
    "金额",
    "状态",
    "操作",
  ], []);

  return (
    <Card>
      <BlockStack gap="400">
        {}
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              实时事件监控
            </Text>
            <InlineStack gap="200" blockAlign="center">
              {isConnected ? (
                <Badge tone="success">
                  <InlineStack gap="100" blockAlign="center">
                    <Box
                      width="8px"
                      height="8px"
                      background="bg-fill-success"
                      borderRadius="full"
                    />
                    已连接
                  </InlineStack>
                </Badge>
              ) : (
                <Badge tone="subdued">
                  <InlineStack gap="100" blockAlign="center">
                    <Box
                      width="8px"
                      height="8px"
                      background="bg-surface-disabled"
                      borderRadius="full"
                    />
                  未连接
                  </InlineStack>
                </Badge>
              )}
              {events.length > 0 && (
                <Text as="span" variant="bodySm" tone="subdued">
                  共 {events.length} 条事件
                </Text>
              )}
            </InlineStack>
          </BlockStack>
          <InlineStack gap="200">
            {!isConnected ? (
              <Button
                size="slim"
                onClick={connect}
                icon={PlayIcon}
                disabled={isPaused}
              >
                开始监控
              </Button>
            ) : (
              <>
                <Button
                  size="slim"
                  onClick={() => {
                    setIsPaused(!isPaused);
                  }}
                  icon={isPaused ? PlayIcon : PauseIcon}
                >
                  {isPaused ? "继续" : "暂停"}
                </Button>
                <Button
                  size="slim"
                  onClick={() => {
                    disconnect();
                    setEvents([]);
                  }}
                  icon={RefreshIcon}
                >
                  重置
                </Button>
              </>
            )}
          </InlineStack>
        </InlineStack>

        {}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="p" variant="bodySm">
              {error}
            </Text>
          </Banner>
        )}

        {}
        {events.length > 0 && (
          <BlockStack gap="300">
            <InlineStack gap="300" wrap>
              <Box minWidth="200px">
                <TextField
                  label="搜索"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="搜索订单ID、订单号、事件类型..."
                  prefix={<Icon source={SearchIcon} />}
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                />
              </Box>
              <Box minWidth="150px">
                <Select
                  label="状态"
                  options={[
                    { label: "全部", value: "all" },
                    { label: "成功", value: "success" },
                    { label: "失败", value: "failed" },
                    { label: "处理中", value: "pending" },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </Box>
              {platformList.length > 0 && (
                <Box minWidth="150px">
                  <Select
                    label="平台"
                    options={[
                      { label: "全部", value: "all" },
                      ...platformList.map((p) => ({
                        label: isValidPlatform(p) ? PLATFORM_NAMES[p] : p,
                        value: p,
                      })),
                    ]}
                    value={platformFilter}
                    onChange={setPlatformFilter}
                  />
                </Box>
              )}
            </InlineStack>
          </BlockStack>
        )}

        <Divider />

        {}
        {!isConnected && events.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              点击「开始监控」按钮开始实时监控事件。事件将自动更新，失败的事件会以红色高亮显示。
            </Text>
          </Banner>
        ) : filteredEvents.length === 0 ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              {searchQuery || statusFilter !== "all" || platformFilter !== "all"
                ? "没有匹配的事件，请调整过滤条件。"
                : "暂无事件数据，完成订单后将显示实时事件。"}
            </Text>
          </Banner>
        ) : (
          <Scrollable style={{ maxHeight: "600px" }}>
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
              headings={headings}
              rows={rows}
              increasedDensity
            />
          </Scrollable>
        )}

        {}
        {events.length > 0 && (
          <>
            <Divider />
            <InlineStack gap="400" wrap>
              <Box>
                <Text as="span" variant="bodySm" tone="subdued">
                  成功:{" "}
                </Text>
                <Badge tone="success">
                  {events.filter((e) => e.status === "success").length}
                </Badge>
              </Box>
              <Box>
                <Text as="span" variant="bodySm" tone="subdued">
                  失败:{" "}
                </Text>
                <Badge tone="critical">
                  {events.filter((e) => e.status === "failed").length}
                </Badge>
              </Box>
              <Box>
                <Text as="span" variant="bodySm" tone="subdued">
                  处理中:{" "}
                </Text>
                <Badge tone="info">
                  {events.filter((e) => e.status === "pending").length}
                </Badge>
              </Box>
            </InlineStack>
          </>
        )}

        {}
        <Modal
          open={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedEvent(null);
          }}
          title="事件详情"
          primaryAction={{
            content: "关闭",
            onAction: () => {
              setShowDetailsModal(false);
              setSelectedEvent(null);
            },
          }}
        >
          <Modal.Section>
            {selectedEvent && (
              <BlockStack gap="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    基本信息
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">事件类型：</Text>
                        <Text as="span">{selectedEvent.eventType}</Text>
                      </InlineStack>
                    </List.Item>
                    <List.Item>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">平台：</Text>
                        <Text as="span">
                          {isValidPlatform(selectedEvent.platform)
                            ? PLATFORM_NAMES[selectedEvent.platform]
                            : selectedEvent.platform}
                        </Text>
                      </InlineStack>
                    </List.Item>
                    <List.Item>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">状态：</Text>
                        {selectedEvent.status === "success" ? (
                          <Badge tone="success">成功</Badge>
                        ) : selectedEvent.status === "failed" ? (
                          <Badge tone="critical">失败</Badge>
                        ) : (
                          <Badge tone="info">处理中</Badge>
                        )}
                      </InlineStack>
                    </List.Item>
                    <List.Item>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">时间：</Text>
                        <Text as="span">
                          {typeof selectedEvent.timestamp === "string"
                            ? new Date(selectedEvent.timestamp).toLocaleString("zh-CN")
                            : selectedEvent.timestamp.toLocaleString("zh-CN")}
                        </Text>
                      </InlineStack>
                    </List.Item>
                    {selectedEvent.orderId && (
                      <List.Item>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">订单ID：</Text>
                          <Text as="span">{selectedEvent.orderId}</Text>
                        </InlineStack>
                      </List.Item>
                    )}
                    {selectedEvent.orderNumber && (
                      <List.Item>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">订单号：</Text>
                          <Text as="span">{selectedEvent.orderNumber}</Text>
                        </InlineStack>
                      </List.Item>
                    )}
                    {selectedEvent.attempts !== undefined && (
                      <List.Item>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">重试次数：</Text>
                          <Badge>{selectedEvent.attempts}</Badge>
                        </InlineStack>
                      </List.Item>
                    )}
                    {selectedEvent.responseTime !== undefined && (
                      <List.Item>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">响应时间：</Text>
                          <Text as="span">{selectedEvent.responseTime}ms</Text>
                        </InlineStack>
                      </List.Item>
                    )}
                  </List>
                </BlockStack>

                {selectedEvent.params && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        事件参数
                      </Text>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Box
                          as="pre"
                          style={{
                            fontSize: "12px",
                            overflow: "auto",
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(selectedEvent.params, null, 2)}
                        </Box>
                      </Box>
                    </BlockStack>
                  </>
                )}

                {selectedEvent.errorMessage && (
                  <>
                    <Divider />
                    <Banner tone="critical">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          错误信息
                        </Text>
                        <Text as="p" variant="bodySm">
                          {selectedEvent.errorMessage}
                        </Text>
                      </BlockStack>
                    </Banner>
                  </>
                )}

                {selectedEvent.payload && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        完整 Payload
                      </Text>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Box
                          as="pre"
                          style={{
                            fontSize: "12px",
                            overflow: "auto",
                            maxHeight: "300px",
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(selectedEvent.payload, null, 2)}
                        </Box>
                      </Box>
                    </BlockStack>
                  </>
                )}

                {selectedEvent.details && (
                  <>
                    <Divider />
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        详细信息
                      </Text>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <Box
                          as="pre"
                          style={{
                            fontSize: "12px",
                            overflow: "auto",
                            maxHeight: "300px",
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(selectedEvent.details, null, 2)}
                        </Box>
                      </Box>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Card>
  );
}

