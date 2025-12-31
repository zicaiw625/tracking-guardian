import { useState } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Divider,
  Button,
  Collapsible,
  DataTable,
} from "@shopify/polaris";
import { ArrowDownIcon, ArrowUpIcon } from "~/components/icons";
import { PLATFORM_NAMES, isValidPlatform } from "~/types";

interface MissingParamsDetailsProps {
  stats: {
    overall: {
      total: number;
      missing: number;
      rate: number;
    };
    byEventType: Record<string, {
      total: number;
      missing: number;
      rate: number;
      missingParams: Record<string, number>;
    }>;
    byPlatform: Record<string, {
      total: number;
      missing: number;
      rate: number;
    }>;
    recent: Array<{
      timestamp: Date | string;
      eventType: string;
      platform: string;
      missingParams: string[];
    }>;
  };
}

export function MissingParamsDetails({ stats }: MissingParamsDetailsProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  const eventTypes = Object.keys(stats.byEventType).sort((a, b) => {
    const rateA = stats.byEventType[a].rate;
    const rateB = stats.byEventType[b].rate;
    return rateB - rateA;
  });

  const platforms = Object.keys(stats.byPlatform).sort((a, b) => {
    const rateA = stats.byPlatform[a].rate;
    const rateB = stats.byPlatform[b].rate;
    return rateB - rateA;
  });

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            按事件类型统计
          </Text>
          <BlockStack gap="300">
            {eventTypes.map((eventType) => {
              const eventStats = stats.byEventType[eventType];
              const groupKey = `event-${eventType}`;
              const isExpanded = expandedGroups.has(groupKey);

              return (
                <Box
                  key={eventType}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {eventType}
                        </Text>
                        <Badge
                          tone={
                            eventStats.rate < 5
                              ? "success"
                              : eventStats.rate < 10
                                ? "warning"
                                : "critical"
                          }
                        >
                          {eventStats.rate.toFixed(2)}%
                        </Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {eventStats.missing} / {eventStats.total} 缺失
                        </Text>
                      </InlineStack>
                      <Button
                        plain
                        onClick={() => toggleGroup(groupKey)}
                        icon={isExpanded ? ArrowUpIcon : ArrowDownIcon}
                      >
                        {isExpanded ? "收起" : "展开"}
                      </Button>
                    </InlineStack>

                    <Collapsible open={isExpanded} id={groupKey}>
                      <BlockStack gap="200">
                        <Divider />
                        <Text as="h4" variant="headingXs">
                          缺失参数详情
                        </Text>
                        <BlockStack gap="100">
                          {Object.entries(eventStats.missingParams)
                            .sort(([, a], [, b]) => b - a)
                            .map(([param, count]) => (
                              <InlineStack
                                key={param}
                                align="space-between"
                                blockAlign="center"
                              >
                                <Text as="span" variant="bodySm">
                                  {param === "value"
                                    ? "订单金额 (value)"
                                    : param === "currency"
                                      ? "货币 (currency)"
                                      : param === "event_id"
                                        ? "事件ID (event_id)"
                                        : param}
                                </Text>
                                <Text
                                  as="span"
                                  variant="bodySm"
                                  fontWeight="semibold"
                                >
                                  {count} 次
                                </Text>
                              </InlineStack>
                            ))}
                        </BlockStack>
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            按平台统计
          </Text>
          <BlockStack gap="300">
            {platforms.map((platform) => {
              const platformStats = stats.byPlatform[platform];
              const platformName = isValidPlatform(platform)
                ? PLATFORM_NAMES[platform]
                : platform;

              return (
                <Box
                  key={platform}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" fontWeight="semibold">
                      {platformName}
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge
                        tone={
                          platformStats.rate < 5
                            ? "success"
                            : platformStats.rate < 10
                              ? "warning"
                              : "critical"
                        }
                      >
                        {platformStats.rate.toFixed(2)}%
                      </Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {platformStats.missing} / {platformStats.total} 缺失
                      </Text>
                    </InlineStack>
                  </InlineStack>
                </Box>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>

      {stats.recent.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              最近缺失参数事件（最多50条）
            </Text>
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={["时间", "平台", "事件类型", "缺失参数"]}
              rows={stats.recent.slice(0, 50).map((event) => {
                const timestamp = typeof event.timestamp === "string"
                  ? new Date(event.timestamp)
                  : event.timestamp;
                return [
                  timestamp.toLocaleString("zh-CN"),
                  isValidPlatform(event.platform)
                    ? PLATFORM_NAMES[event.platform]
                    : event.platform,
                  event.eventType,
                  event.missingParams.join(", "),
                ];
              })}
            />
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

