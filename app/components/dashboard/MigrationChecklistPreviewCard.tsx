import { Card, BlockStack, InlineStack, Text, Box, Badge, Divider, Button, List, Icon } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon, ArrowRightIcon } from "~/components/icons";
import { EnhancedEmptyState } from "~/components/ui";
import type { DashboardData } from "~/types/dashboard";

export function MigrationChecklistPreviewCard({
  checklist,
  estimatedTimeMinutes: _estimatedTimeMinutes,
}: {
  checklist: DashboardData["migrationChecklist"];
  estimatedTimeMinutes?: number;
}) {
  if (!checklist || checklist.totalItems === 0) {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            迁移清单
          </Text>
          <EnhancedEmptyState
            icon="📋"
            title="暂无迁移清单"
            description="完成扫描后，我们将为您生成迁移清单和优先级建议。"
            primaryAction={{
              content: "开始扫描",
              url: "/app/audit/start",
            }}
          />
        </BlockStack>
      </Card>
    );
  }
  const estimatedHours = Math.floor(checklist.estimatedTotalTime / 60);
  const estimatedMinutes = checklist.estimatedTotalTime % 60;
  const timeText =
    estimatedHours > 0
      ? `${estimatedHours} 小时 ${estimatedMinutes > 0 ? estimatedMinutes + " 分钟" : ""}`
      : `${estimatedMinutes} 分钟`;
  const completedItems = checklist.topItems.filter((item) => item.status === "completed").length;
  const remainingItems = checklist.totalItems - completedItems;
  const avgTimePerItem = checklist.totalItems > 0
    ? checklist.estimatedTotalTime / checklist.totalItems
    : 0;
  const remainingTime = Math.ceil(remainingItems * avgTimePerItem);
  const remainingHours = Math.floor(remainingTime / 60);
  const remainingMinutes = remainingTime % 60;
  const remainingTimeText =
    remainingHours > 0
      ? `${remainingHours} 小时 ${remainingMinutes > 0 ? remainingMinutes + " 分钟" : ""}`
      : `${remainingMinutes} 分钟`;
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            迁移清单预览
          </Text>
          <Badge tone="info">{`${checklist.totalItems} 项`}</Badge>
        </InlineStack>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                高风险项
              </Text>
              <Text as="span" fontWeight="semibold" tone="critical">
                {checklist.highPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                中风险项
              </Text>
              <Text as="span" fontWeight="semibold">
                {checklist.mediumPriorityItems}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                低风险项
              </Text>
              <Text as="span" fontWeight="semibold" tone="success">
                {checklist.lowPriorityItems}
              </Text>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                预计总时间
              </Text>
              <Text as="span" fontWeight="semibold">
                {timeText}
              </Text>
            </InlineStack>
            {remainingItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  剩余时间
                </Text>
                <Text as="span" fontWeight="semibold">
                  {remainingTimeText}
                </Text>
              </InlineStack>
            )}
            {completedItems > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  完成进度
                </Text>
                <Text as="span" fontWeight="semibold">
                  {completedItems} / {checklist.totalItems} ({Math.round((completedItems / checklist.totalItems) * 100)}%)
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </Box>
        {checklist.topItems.length > 0 && (
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              优先级最高的项目
            </Text>
            <BlockStack gap="200">
              {checklist.topItems.map((item) => {
                const priorityBadgeTone =
                  item.priority >= 8 ? "critical" :
                  item.priority >= 5 ? "warning" :
                  "info";
                const estimatedTimeText = item.estimatedTime
                  ? item.estimatedTime < 60
                    ? `${item.estimatedTime} 分钟`
                    : `${Math.floor(item.estimatedTime / 60)} 小时 ${item.estimatedTime % 60} 分钟`
                  : "待估算";
                return (
                  <Box
                    key={item.id}
                    background={item.status === "completed" ? "bg-surface-success" : "bg-surface-secondary"}
                    padding="300"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge
                            tone={
                              item.riskLevel === "high"
                                ? "critical"
                                : item.riskLevel === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {item.riskLevel === "high" ? "高" : item.riskLevel === "medium" ? "中" : "低"}
                          </Badge>
                          {item.priority > 0 && (
                            <Badge tone={priorityBadgeTone}>
                              {`优先级 ${item.priority}/10`}
                            </Badge>
                          )}
                          {item.status === "completed" && (
                            <Icon source={CheckCircleIcon} tone="success" />
                          )}
                          {item.status === "in_progress" && (
                            <Badge tone="info">进行中</Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {item.title}
                        </Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            <Icon source={ClockIcon} />
                            {estimatedTimeText}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                      {item.status === "pending" && (
                        <Button
                          size="slim"
                          url={`/app/migrate?asset=${item.id.replace("checklist-", "")}`}
                        >
                          开始迁移
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
            {checklist.totalItems > checklist.topItems.length && (
              <Text as="p" variant="bodySm" tone="subdued">
                还有 {checklist.totalItems - checklist.topItems.length} 项待处理
              </Text>
            )}
          </BlockStack>
        )}
        <Button url="/app/audit/report" fullWidth icon={ArrowRightIcon}>
          查看完整清单
        </Button>
      </BlockStack>
    </Card>
  );
}
