import { memo, useMemo } from "react";
import { Card, BlockStack, InlineStack, Text, Divider, Badge, Button, List } from "@shopify/polaris";

export const QuickStatsCard = memo(function QuickStatsCard({
  configuredPlatforms,
  weeklyConversions,
  plan,
  planLabel,
  planTagline,
  planFeatures,
}: {
  configuredPlatforms: number;
  weeklyConversions: number;
  plan: string;
  planLabel?: string;
  planTagline?: string;
  planFeatures?: string[];
}) {
  const displayFeatures = useMemo(() => planFeatures?.slice(0, 3) || [], [planFeatures]);
  const hasMoreFeatures = useMemo(() => (planFeatures?.length || 0) > 3, [planFeatures]);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          快速统计
        </Text>
        <BlockStack gap="300">
          <InlineStack align="space-between">
            <Text as="span">已配置平台</Text>
            <Text as="span" fontWeight="semibold">
              {configuredPlatforms} 个
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">本周转化记录</Text>
            <Text as="span" fontWeight="semibold">
              {weeklyConversions} 条
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between">
            <Text as="span">当前套餐</Text>
            <Badge>
              {planLabel || (plan === "free" ? "免费版" : plan)}
            </Badge>
          </InlineStack>
          {planTagline && (
            <Text as="p" variant="bodySm" tone="subdued">
              {planTagline}
            </Text>
          )}
          {displayFeatures.length > 0 && (
            <List>
              {displayFeatures.map((f, i) => (
                <List.Item key={i}>
                  <Text as="span" variant="bodySm">{f}</Text>
                </List.Item>
              ))}
              {hasMoreFeatures && (
                <List.Item>
                  <Text as="span" variant="bodySm" tone="subdued">
                    ...更多权益，详见套餐页
                  </Text>
                </List.Item>
              )}
            </List>
          )}
          <Button
            url="/app/settings?tab=subscription"
            size="slim"
          >
            查看套餐/升级
          </Button>
        </BlockStack>
      </BlockStack>
    </Card>
  );
});
