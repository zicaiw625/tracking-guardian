
import { useState, useMemo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Divider,
  Icon,
  Collapsible,
  Link,
} from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, AlertCircleIcon, ArrowRightIcon } from "~/components/icons";
import type { MigrationTimeline } from "~/services/migration-priority.server";

export interface MigrationTimelineViewProps {
  timeline: MigrationTimeline;
  onItemClick?: (assetId: string) => void;
}

export function MigrationTimelineView({
  timeline,
  onItemClick,
}: MigrationTimelineViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["canStart", "blocked"]));

  const { canStartItems, blockedItems, completedItems } = useMemo(() => {
    const canStart: typeof timeline.assets = [];
    const blocked: typeof timeline.assets = [];
    const completed: typeof timeline.assets = [];

    timeline.assets.forEach((item) => {
      if (item.asset.migrationStatus === "completed") {
        completed.push(item);
      } else if (item.canStart) {
        canStart.push(item);
      } else {
        blocked.push(item);
      }
    });

    return {
      canStartItems: canStart,
      blockedItems: blocked,
      completedItems: completed,
    };
  }, [timeline.assets]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };

  const getRiskBadgeTone = (risk: string) => {
    switch (risk) {
      case "high":
        return "critical";
      case "medium":
        return "warning";
      case "low":
        return "info";
      default:
        return "subdued";
    }
  };

  const renderTimelineItem = (item: typeof timeline.assets[0], index: number) => {
    const isCompleted = item.asset.migrationStatus === "completed";
    const riskBadgeTone = getRiskBadgeTone(item.asset.riskLevel);

    return (
      <Box
        key={item.asset.id}
        background={
          isCompleted
            ? "bg-surface-success"
            : item.canStart
              ? "bg-surface-secondary"
              : "bg-surface-warning-subdued"
        }
        padding="300"
        borderRadius="200"
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="start">
            <BlockStack gap="100">
              <InlineStack gap="200" wrap>
                {isCompleted ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : item.canStart ? (
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {index + 1}.
                  </Text>
                ) : (
                  <Icon source={AlertCircleIcon} tone="warning" />
                )}
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {item.asset.displayName || `${item.asset.category} - ${item.asset.platform || "未知"}`}
                </Text>
                <Badge tone={riskBadgeTone}>
                  {item.asset.riskLevel === "high" ? "高" : item.asset.riskLevel === "medium" ? "中" : "低"}风险
                </Badge>
                {item.asset.priority && (
                  <Badge tone={item.asset.priority >= 8 ? "critical" : item.asset.priority >= 5 ? "warning" : "info"}>
                    优先级 {item.asset.priority}/10
                  </Badge>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {item.priority.reason}
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              <InlineStack gap="100" blockAlign="center">
                <Icon source={ClockIcon} tone="subdued" />
                <Text as="span" variant="bodySm" tone="subdued">
                  {formatTime(item.priority.estimatedTime)}
                </Text>
              </InlineStack>
              {!isCompleted && onItemClick && (
                <Button
                  size="slim"
                  onClick={() => onItemClick(item.asset.id)}
                  url={`/app/migrate?asset=${item.asset.id}`}
                  icon={ArrowRightIcon}
                >
                  开始迁移
                </Button>
              )}
            </InlineStack>
          </InlineStack>

          {}
          {item.blockingDependencies.length > 0 && (
            <Box paddingBlockStart="200">
              <Box background="bg-surface-warning-subdued" padding="200" borderRadius="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>等待依赖项完成：</strong>
                  {item.blockingDependencies.length} 个依赖项需要先完成
                </Text>
              </Box>
            </Box>
          )}
        </BlockStack>
      </Box>
    );
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移时间线
          </Text>
          <Badge tone="info">
            预计总时间: {formatTime(timeline.totalEstimatedTime)}
          </Badge>
        </InlineStack>

        {}
        {timeline.criticalPath.length > 0 && (
          <Box background="bg-surface-info-subdued" padding="300" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={AlertCircleIcon} tone="info" />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  关键路径（最长依赖链）
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                以下 {timeline.criticalPath.length} 个资产构成关键路径，建议优先完成：
              </Text>
              <InlineStack gap="100" wrap>
                {timeline.criticalPath.slice(0, 5).map((assetId) => {
                  const asset = timeline.assets.find((a) => a.asset.id === assetId);
                  return asset ? (
                    <Badge key={assetId} tone="info">
                      {asset.asset.displayName || asset.asset.category}
                    </Badge>
                  ) : null;
                })}
                {timeline.criticalPath.length > 5 && (
                  <Badge tone="subdued">+{timeline.criticalPath.length - 5} 项</Badge>
                )}
              </InlineStack>
            </BlockStack>
          </Box>
        )}

        {}
        {canStartItems.length > 0 && (
          <BlockStack gap="300">
            <Button
              size="slim"
              variant="plain"
              onClick={() => toggleSection("canStart")}
            >
              {expandedSections.has("canStart") ? "▼" : "▶"} 可开始迁移 ({canStartItems.length} 项)
            </Button>
            <Collapsible
              open={expandedSections.has("canStart")}
              id="canStart"
              transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
            >
              <BlockStack gap="200">
                {canStartItems.map((item, index) => renderTimelineItem(item, index))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        )}

        {}
        {blockedItems.length > 0 && (
          <BlockStack gap="300">
            <Button
              size="slim"
              variant="plain"
              onClick={() => toggleSection("blocked")}
            >
              {expandedSections.has("blocked") ? "▼" : "▶"} 等待依赖项 ({blockedItems.length} 项)
            </Button>
            <Collapsible
              open={expandedSections.has("blocked")}
              id="blocked"
              transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
            >
              <BlockStack gap="200">
                {blockedItems.map((item, index) => renderTimelineItem(item, canStartItems.length + index))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        )}

        {}
        {completedItems.length > 0 && (
          <BlockStack gap="300">
            <Button
              size="slim"
              variant="plain"
              onClick={() => toggleSection("completed")}
            >
              {expandedSections.has("completed") ? "▼" : "▶"} 已完成 ({completedItems.length} 项)
            </Button>
            <Collapsible
              open={expandedSections.has("completed")}
              id="completed"
              transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
            >
              <BlockStack gap="200">
                {completedItems.map((item, index) => renderTimelineItem(item, index))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        )}

        {}
        {canStartItems.length === 0 && blockedItems.length === 0 && completedItems.length === 0 && (
          <Box padding="400">
            <Text as="p" tone="subdued" alignment="center">
              暂无迁移项
            </Text>
          </Box>
        )}
      </BlockStack>
    </Card>
  );
}

