import { memo } from "react";
import { Badge, BlockStack, Box, Card, Divider, InlineStack, List, Text } from "@shopify/polaris";

export const DashboardRiskScoreCard = memo(function DashboardRiskScoreCard({
  riskScore,
  riskLevel,
  estimatedMigrationTimeMinutes,
  topRiskSources,
}: {
  riskScore?: number | null;
  riskLevel?: "high" | "medium" | "low" | null;
  estimatedMigrationTimeMinutes?: number | null;
  topRiskSources?: Array<{ source: string; count: number; category: string }>;
}) {
  const riskBadge =
    riskLevel === "high"
      ? { tone: "critical" as const, label: "高风险" }
      : riskLevel === "medium"
        ? { tone: "warning" as const, label: "中风险" }
        : riskLevel === "low"
          ? { tone: "success" as const, label: "低风险" }
          : { tone: "info" as const, label: "待评估" };
  const formatEstimatedTime = (minutes: number | null): string => {
    if (minutes === null) return "待计算";
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };
  const riskColor = riskLevel === "high"
    ? "bg-fill-critical"
    : riskLevel === "medium"
      ? "bg-fill-caution"
      : riskLevel === "low"
        ? "bg-fill-success"
        : "bg-surface-secondary";
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          风险分数
        </Text>
        <Box background={riskColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {riskScore != null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {riskScore}
                </Text>
                <Text as="p" variant="bodySm">/ 100</Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  待评估
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  完成体检后显示
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            风险等级
          </Text>
          <Badge tone={riskBadge.tone}>{riskBadge.label}</Badge>
        </InlineStack>
        <Divider />
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            预计迁移时长
          </Text>
          <Text as="span" variant="bodyMd">
            {formatEstimatedTime(estimatedMigrationTimeMinutes ?? null)}
          </Text>
        </InlineStack>
        {topRiskSources && topRiskSources.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="200">
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                主要风险来源
              </Text>
              <List>
                {topRiskSources.map((source, index) => (
                  <List.Item key={`${source.category}-${source.source}`}>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm">
                        {index + 1}. {source.source}
                      </Text>
                      <Badge tone="critical">{`${source.count} 个`}</Badge>
                    </InlineStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
});
