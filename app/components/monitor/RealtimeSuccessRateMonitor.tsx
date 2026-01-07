

import { useState, useEffect, useRef } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  ProgressBar,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
} from "~/components/icons";

export interface RealtimeStats {
  timestamp: string;
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  successRate: number;
  failureRate: number;
  byPlatform: Record<string, {
    total: number;
    success: number;
    failed: number;
    successRate: number;
  }>;
}

interface RealtimeSuccessRateMonitorProps {
  shopId: string;
  initialStats?: RealtimeStats;
}

export function RealtimeSuccessRateMonitor({
  shopId,
  initialStats,
}: RealtimeSuccessRateMonitorProps) {
  const [stats, setStats] = useState<RealtimeStats | null>(initialStats || null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const eventSource = new EventSource(
      `/app/api/monitoring/realtime?shopId=${shopId}`
    );

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RealtimeStats;
        setStats(data);
      } catch (err) {

        if (process.env.NODE_ENV === "development") {

          console.error("Failed to parse SSE data:", err);
        }
        setError("数据解析失败");
      }
    };

    eventSource.onerror = (err) => {

      if (process.env.NODE_ENV === "development") {

        console.error("SSE connection error:", err);
      }
      setIsConnected(false);
      setError("连接中断，正在重连...");
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [shopId]);

  if (!stats) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            实时监控
          </Text>
          <Text as="p" tone="subdued">
            正在连接实时数据流...
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const successRateColor: "success" | "critical" | undefined =
    stats.successRate >= 95
      ? "success"
      : stats.successRate >= 80
        ? undefined
        : "critical";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            实时监控
          </Text>
          <InlineStack gap="200" blockAlign="center">
            {isConnected ? (
              <Badge tone="success">已连接</Badge>
            ) : (
              <Badge tone="warning">连接中</Badge>
            )}
            {error && (
              <Badge tone="critical">{error}</Badge>
            )}
          </InlineStack>
        </InlineStack>

        {}
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                成功率
              </Text>
              <Text as="span" variant="headingLg" fontWeight="bold">
                {stats.successRate.toFixed(1)}%
              </Text>
            </InlineStack>
            <ProgressBar
              progress={stats.successRate}
              tone={successRateColor}
              size="small"
            />
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                成功: {stats.successfulEvents}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                失败: {stats.failedEvents}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                总计: {stats.totalEvents}
              </Text>
            </InlineStack>
          </BlockStack>
        </Box>

        {}
        {Object.keys(stats.byPlatform).length > 0 && (
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              按平台统计
            </Text>
            {Object.entries(stats.byPlatform).map(([platform, platformStats]) => {
              const platformSuccessRateColor: "success" | "critical" | undefined =
                platformStats.successRate >= 95
                  ? "success"
                  : platformStats.successRate >= 80
                    ? undefined
                    : "critical";

              return (
                <Box
                  key={platform}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {platform}
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        <Icon
                          source={
                            platformStats.successRate >= 95
                              ? CheckCircleIcon
                              : AlertCircleIcon
                          }
                          tone={platformSuccessRateColor}
                        />
                        <Text as="span" variant="bodySm">
                          {platformStats.successRate.toFixed(1)}%
                        </Text>
                      </InlineStack>
                    </InlineStack>
                    <ProgressBar
                      progress={platformStats.successRate}
                      tone={platformSuccessRateColor}
                      size="small"
                    />
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        成功: {platformStats.success}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        失败: {platformStats.failed}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        )}

        {}
        <Text as="p" variant="bodySm" tone="subdued" alignment="end">
          最后更新: {new Date(stats.timestamp).toLocaleTimeString("zh-CN")}
        </Text>
      </BlockStack>
    </Card>
  );
}

