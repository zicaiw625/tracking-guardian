import { memo, useMemo } from "react";
import { Card, BlockStack, InlineStack, Text, Box, Badge } from "@shopify/polaris";
import type { DashboardData } from "~/types/dashboard";

const HealthBadge = memo(function HealthBadge({ status }: { status: DashboardData["healthStatus"] }) {
  switch (status) {
    case "critical":
      return <Badge tone="critical">需要关注</Badge>;
    case "warning":
      return <Badge tone="warning">有风险</Badge>;
    case "success":
      return <Badge tone="success">健康</Badge>;
    default:
      return <Badge tone="info">未初始化</Badge>;
  }
});

export const HealthScoreCard = memo(function HealthScoreCard({
  score,
  status,
}: {
  score: number | null;
  status: DashboardData["healthStatus"];
}) {
  const backgroundColor = useMemo(() =>
    score === null
      ? "bg-surface-secondary"
      : score > 80
        ? "bg-fill-success"
        : score > 60
          ? "bg-fill-warning"
          : "bg-fill-critical",
    [score]
  );
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            健康度
          </Text>
          <HealthBadge status={status} />
        </InlineStack>
        <Box background={backgroundColor} padding="600" borderRadius="200">
          <BlockStack gap="200" align="center">
            {score !== null ? (
              <>
                <Text as="p" variant="heading3xl" fontWeight="bold">
                  {score}
                </Text>
                <Text as="p" variant="bodySm">
                  / 100
                </Text>
              </>
            ) : (
              <>
                <Text as="p" variant="headingLg" fontWeight="semibold">
                  未初始化
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  完成平台连接后开始评分
                </Text>
              </>
            )}
          </BlockStack>
        </Box>
        <Text as="p" variant="bodySm" tone="subdued">
          {score !== null
            ? "评分依据：过去 7 天对账差异率 / 漏报率"
            : "连接平台并产生订单数据后，系统将自动计算健康度评分"}
        </Text>
      </BlockStack>
    </Card>
  );
});
