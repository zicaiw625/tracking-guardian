/**
 * 事件监控 Dashboard - 显示事件成功率、缺参率、去重冲突等指标
 */

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Divider,
  DataTable,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";
import type {
  EventMetrics,
  MissingParamsMetrics,
  DeduplicationMetrics,
} from "~/services/monitoring/collector.server";

export interface EventMetricsDashboardProps {
  eventMetrics: EventMetrics;
  missingParamsMetrics: MissingParamsMetrics;
  deduplicationMetrics: DeduplicationMetrics;
  period: {
    start: Date;
    end: Date;
  };
}

export function EventMetricsDashboard({
  eventMetrics,
  missingParamsMetrics,
  deduplicationMetrics,
  period,
}: EventMetricsDashboardProps) {
  const getSuccessRateBadge = (rate: number) => {
    if (rate >= 95) {
      return <Badge tone="success">优秀</Badge>;
    } else if (rate >= 80) {
      return <Badge tone="info">良好</Badge>;
    } else if (rate >= 60) {
      return <Badge tone="warning">需关注</Badge>;
    } else {
      return <Badge tone="critical">异常</Badge>;
    }
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            事件成功率
          </Text>

          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  总体成功率
                </Text>
                <InlineStack gap="200" blockAlignment="center">
                  <Text variant="headingLg" as="span">
                    {eventMetrics.successRate.toFixed(2)}%
                  </Text>
                  {getSuccessRateBadge(eventMetrics.successRate)}
                </InlineStack>
              </InlineStack>
              <ProgressBar progress={eventMetrics.successRate} size="small" />
              <InlineStack align="space-between">
                <Text variant="bodySm" as="span" tone="subdued">
                  成功: {eventMetrics.success}
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  失败: {eventMetrics.failed}
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  总计: {eventMetrics.total}
                </Text>
              </InlineStack>
            </BlockStack>
          </Box>

          <Divider />

          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">
              按目的地统计
            </Text>
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
              headings={["目的地", "总计", "成功", "失败", "成功率"]}
              rows={Object.entries(eventMetrics.byDestination).map(([dest, stats]) => [
                dest,
                String(stats.total),
                String(stats.success),
                String(stats.failed),
                `${stats.successRate.toFixed(2)}%`,
              ])}
            />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            缺参率监控
          </Text>

          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  Value 缺参率
                </Text>
                <Text variant="headingSm" as="span" tone={missingParamsMetrics.missingRate.value > 5 ? "critical" : "subdued"}>
                  {missingParamsMetrics.missingRate.value.toFixed(2)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={100 - missingParamsMetrics.missingRate.value} size="small" />

              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  Currency 缺参率
                </Text>
                <Text variant="headingSm" as="span" tone={missingParamsMetrics.missingRate.currency > 5 ? "critical" : "subdued"}>
                  {missingParamsMetrics.missingRate.currency.toFixed(2)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={100 - missingParamsMetrics.missingRate.currency} size="small" />

              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  Items 缺参率
                </Text>
                <Text variant="headingSm" as="span" tone={missingParamsMetrics.missingRate.items > 10 ? "warning" : "subdued"}>
                  {missingParamsMetrics.missingRate.items.toFixed(2)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={100 - missingParamsMetrics.missingRate.items} size="small" />
            </BlockStack>
          </Box>

          <Divider />

          <InlineStack align="space-between">
            <Text variant="bodySm" as="span" tone="subdued">
              总计事件: {missingParamsMetrics.total}
            </Text>
            <Text variant="bodySm" as="span" tone="subdued">
              缺参事件: {missingParamsMetrics.missingValue + missingParamsMetrics.missingCurrency + missingParamsMetrics.missingItems}
            </Text>
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text variant="headingMd" as="h2">
            去重冲突检测
          </Text>

          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  去重率
                </Text>
                <Text variant="headingSm" as="span">
                  {deduplicationMetrics.duplicationRate.toFixed(2)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={deduplicationMetrics.duplicationRate} size="small" />
              <InlineStack align="space-between">
                <Text variant="bodySm" as="span" tone="subdued">
                  总计: {deduplicationMetrics.total}
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  去重: {deduplicationMetrics.duplicated}
                </Text>
              </InlineStack>
            </BlockStack>
          </Box>

          {Object.keys(deduplicationMetrics.byDestination).length > 0 && (
            <>
              <Divider />
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">
                  按目的地统计
                </Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "text"]}
                  headings={["目的地", "总计", "去重", "去重率"]}
                  rows={Object.entries(deduplicationMetrics.byDestination).map(([dest, stats]) => [
                    dest,
                    String(stats.total),
                    String(stats.duplicated),
                    `${stats.duplicationRate.toFixed(2)}%`,
                  ])}
                />
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

