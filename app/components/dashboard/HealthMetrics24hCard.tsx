import { Card, BlockStack, InlineStack, Text, Badge, Divider, Banner } from "@shopify/polaris";

interface HealthMetrics24hCardProps {
  metrics: {
    successRate: number;
    failureRate: number;
    missingParamsRate: number;
    missingParamsByType: {
      value: number;
      currency: number;
      items: number;
    };
    totalEvents: number;
  } | null;
}

export function HealthMetrics24hCard({ metrics }: HealthMetrics24hCardProps) {
  if (!metrics || metrics.totalEvents === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            最近24h健康度
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            暂无数据
          </Text>
        </BlockStack>
      </Card>
    );
  }
  const getTone = (rate: number, threshold: number) => {
    if (rate <= threshold) return "success";
    if (rate <= threshold * 2) return "warning";
    return "critical";
  };
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          最近24h健康度
        </Text>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              成功率
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="headingMd">
                {metrics.successRate.toFixed(2)}%
              </Text>
              <Badge tone={getTone(100 - metrics.successRate, 2) as "success" | "warning" | "critical"}>
                {`${metrics.totalEvents} 事件`}
              </Badge>
            </InlineStack>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              失败率
            </Text>
            <Text as="span" variant="headingMd">
              {metrics.failureRate.toFixed(2)}%
            </Text>
          </InlineStack>
          <Divider />
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              缺参率
            </Text>
            <Text as="span" variant="headingMd">
              {metrics.missingParamsRate.toFixed(2)}%
            </Text>
          </InlineStack>
          {metrics.missingParamsRate > 0 && (
            <>
              <Divider />
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  缺参详情
                </Text>
                <BlockStack gap="100">
                  {metrics.missingParamsByType.value > 0 && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">value</Text>
                      <Badge tone="warning">{`${metrics.missingParamsByType.value}`}</Badge>
                    </InlineStack>
                  )}
                  {metrics.missingParamsByType.currency > 0 && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">currency</Text>
                      <Badge tone="warning">{`${metrics.missingParamsByType.currency}`}</Badge>
                    </InlineStack>
                  )}
                  {metrics.missingParamsByType.items > 0 && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">items</Text>
                      <Badge tone="warning">{`${metrics.missingParamsByType.items}`}</Badge>
                    </InlineStack>
                  )}
                </BlockStack>
              </BlockStack>
            </>
          )}
        </BlockStack>
        <Banner tone="info">
          <Text as="p" variant="bodySm">
            <strong>口径说明：</strong>checkout_started 在 extensible 店铺每次进入 checkout 都会触发，可能影响事件量统计。
          </Text>
        </Banner>
      </BlockStack>
    </Card>
  );
}
