import { BlockStack, InlineStack, Text, Badge, ProgressBar, Divider, Card, DataTable } from "@shopify/polaris";
import { calculateEventStats } from "~/utils/event-param-completeness";
import type { RealtimeEvent } from "../RealtimeEventMonitor";

function getCompletenessTone(rate: number): "success" | "warning" | "critical" | "info" {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "critical";
}

function getCompletenessProgressTone(rate: number): "success" | "highlight" | "critical" | "primary" {
  if (rate >= 90) return "success";
  if (rate >= 70) return "highlight";
  return "critical";
}

function getConsistencyTone(rate: number): "success" | "warning" | "critical" | "info" {
  if (rate >= 95) return "success";
  if (rate >= 80) return "warning";
  return "critical";
}

function getConsistencyProgressTone(rate: number): "success" | "highlight" | "critical" | "primary" {
  if (rate >= 95) return "success";
  if (rate >= 80) return "highlight";
  return "critical";
}

interface EventStatsProps {
  filteredEvents: RealtimeEvent[];
  events: RealtimeEvent[];
}

export function EventStats({ filteredEvents, events }: EventStatsProps) {
  const stats = {
    total: filteredEvents.length,
    byStatus: {
      success: filteredEvents.filter(e => e.status === "success").length,
      failed: filteredEvents.filter(e => e.status === "failed").length,
      missing_params: filteredEvents.filter(e => e.status === "missing_params").length,
      not_tested: filteredEvents.filter(e => e.status === "not_tested").length,
    },
    byPlatform: filteredEvents.reduce((acc, event) => {
      acc[event.platform] = (acc[event.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byEventType: filteredEvents.reduce((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    paramCompleteness: {
      hasValue: filteredEvents.filter(e => e.params?.value !== undefined).length,
      hasCurrency: filteredEvents.filter(e => e.params?.currency !== undefined).length,
      hasItems: filteredEvents.filter(e => e.params?.items !== undefined && e.params?.items > 0).length,
      hasEventId: filteredEvents.filter(e => e.params?.hasEventId).length,
    },
    completenessRate: {
      value: filteredEvents.filter(e => e.params).length > 0
        ? (filteredEvents.filter(e => e.params?.value !== undefined).length / filteredEvents.filter(e => e.params).length) * 100
        : 0,
      currency: filteredEvents.filter(e => e.params).length > 0
        ? (filteredEvents.filter(e => e.params?.currency !== undefined).length / filteredEvents.filter(e => e.params).length) * 100
        : 0,
      items: filteredEvents.filter(e => e.params).length > 0
        ? (filteredEvents.filter(e => e.params?.items !== undefined && e.params?.items > 0).length / filteredEvents.filter(e => e.params).length) * 100
        : 0,
      eventId: filteredEvents.filter(e => e.params).length > 0
        ? (filteredEvents.filter(e => e.params?.hasEventId).length / filteredEvents.filter(e => e.params).length) * 100
        : 0,
    },
    valueConsistency: {
      total: filteredEvents.filter(e => e.shopifyOrder && e.params?.value !== undefined).length,
      consistent: filteredEvents.filter(e => {
        if (!e.shopifyOrder || e.params?.value === undefined) return false;
        const eventValue = e.params.value || 0;
        const orderValue = e.shopifyOrder.value || 0;
        return Math.abs(eventValue - orderValue) < 0.01;
      }).length,
      inconsistent: filteredEvents.filter(e => {
        if (!e.shopifyOrder || e.params?.value === undefined) return false;
        const eventValue = e.params.value || 0;
        const orderValue = e.shopifyOrder.value || 0;
        return Math.abs(eventValue - orderValue) >= 0.01;
      }).length,
    },
    consistencyRate: (() => {
      const total = filteredEvents.filter(e => e.shopifyOrder && e.params?.value !== undefined).length;
      if (total === 0) return 0;
      const consistent = filteredEvents.filter(e => {
        if (!e.shopifyOrder || e.params?.value === undefined) return false;
        const eventValue = e.params.value || 0;
        const orderValue = e.shopifyOrder.value || 0;
        return Math.abs(eventValue - orderValue) < 0.01;
      }).length;
      return (consistent / total) * 100;
    })(),
  };
  const successRate = stats.total > 0
    ? Math.round((stats.byStatus.success / stats.total) * 100)
    : 0;
  const eventStats = calculateEventStats(
    filteredEvents.map((e) => ({
      eventType: e.eventType,
      platform: e.platform,
      params: e.params,
    }))
  );
  if (stats.total === 0) return null;
  return (
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
  );
}
