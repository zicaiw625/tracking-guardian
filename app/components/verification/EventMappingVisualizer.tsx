import { useState } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Collapsible,
  List,
  Banner,
} from "@shopify/polaris";
import { mapEventToPlatform } from "~/services/events/mapping.server";
import { normalizeEvent } from "~/services/events/normalizer.server";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

export interface EventMappingVisualizerProps {
  shopifyEvent: PixelEventPayload;
  platforms: string[];
}

export function EventMappingVisualizer({
  shopifyEvent,
  platforms,
}: EventMappingVisualizerProps) {
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});

  const canonicalEvent = normalizeEvent(shopifyEvent);

  const togglePlatform = (platform: string) => {
    setExpandedPlatforms((prev) => ({
      ...prev,
      [platform]: !prev[platform],
    }));
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            事件映射可视化
          </Text>
          <Badge>{canonicalEvent.eventName}</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="300">
          <Text as="h4" variant="headingSm">
            📋 规范化事件（Canonical Schema）
          </Text>
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <BlockStack gap="200">
              <InlineStack gap="400" wrap>
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    订单 ID
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {canonicalEvent.orderId || canonicalEvent.checkoutToken || "-"}
                  </Text>
                </Box>
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    金额
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {canonicalEvent.value.toFixed(2)} {canonicalEvent.currency}
                  </Text>
                </Box>
                <Box>
                  <Text as="p" variant="bodySm" tone="subdued">
                    商品数量
                  </Text>
                  <Text as="p" fontWeight="semibold">
                    {canonicalEvent.items.length}
                  </Text>
                </Box>
              </InlineStack>

              {canonicalEvent.items.length > 0 && (
                <Box paddingBlockStart="200">
                  <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                    商品列表：
                  </Text>
                  <List type="bullet">
                    {canonicalEvent.items.map((item, idx) => (
                      <List.Item key={idx}>
                        <Text as="span" variant="bodySm">
                          {item.name} (ID: {item.id}, 数量: {item.quantity}, 价格: {item.price.toFixed(2)})
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </Box>
              )}

              <Collapsible
                open={expandedPlatforms["canonical"] || false}
                id="canonical-details"
                transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
              >
                <Box paddingBlockStart="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>完整规范化数据：</strong>
                  </Text>
                  <pre
                    style={{
                      padding: "8px",
                      background: "var(--p-color-bg-surface-tertiary)",
                      borderRadius: "4px",
                      fontSize: "11px",
                      overflow: "auto",
                      maxHeight: "300px",
                    }}
                  >
                    {JSON.stringify(canonicalEvent, null, 2)}
                  </pre>
                </Box>
              </Collapsible>
              <Button
                variant="plain"
                size="slim"
                onClick={() => togglePlatform("canonical")}
              >
                {expandedPlatforms["canonical"] ? "收起" : "展开"}完整数据
              </Button>
            </BlockStack>
          </Box>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <Text as="h4" variant="headingSm">
            🎯 平台映射
          </Text>

          {platforms.map((platform) => {
            const mapping = mapEventToPlatform(
              canonicalEvent.eventName,
              platform,
              shopifyEvent
            );

            const isExpanded = expandedPlatforms[platform] || false;

            return (
              <Box
                key={platform}
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge>{platform.toUpperCase()}</Badge>
                      <Text as="span" fontWeight="semibold">
                        {shopifyEvent.eventName} → {mapping.eventName}
                      </Text>
                      {mapping.isValid ? (
                        <Badge tone="success">✓ 有效</Badge>
                      ) : (
                        <Badge tone="critical">✗ 无效</Badge>
                      )}
                    </InlineStack>
                    <Button
                      variant="plain"
                      size="slim"
                      onClick={() => togglePlatform(platform)}
                    >
                      {isExpanded ? "收起" : "展开"}
                    </Button>
                  </InlineStack>

                  {mapping.missingParameters.length > 0 && (
                    <Banner tone="warning">
                      <Text as="p" variant="bodySm">
                        缺少必需参数: {mapping.missingParameters.join(", ")}
                      </Text>
                    </Banner>
                  )}

                  <Collapsible
                    open={isExpanded}
                    id={`platform-${platform}`}
                    transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                  >
                    <div style={{ paddingBlockStart: "8px" }}>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued" fontWeight="semibold">
                        映射后的参数：
                      </Text>
                      <pre
                        style={{
                          padding: "8px",
                          background: "var(--p-color-bg-surface-tertiary)",
                          borderRadius: "4px",
                          fontSize: "11px",
                          overflow: "auto",
                          maxHeight: "300px",
                        }}
                      >
                        {JSON.stringify(
                          {
                            eventName: mapping.eventName,
                            parameters: mapping.parameters,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </BlockStack>
                    </div>
                  </Collapsible>
                </BlockStack>
              </Box>
            );
          })}
        </BlockStack>

        <Divider />

        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">
            📦 原始 Shopify 事件 Payload
          </Text>
          <Box
            background="bg-surface-secondary"
            padding="300"
            borderRadius="200"
          >
            <pre
              style={{
                fontSize: "11px",
                overflow: "auto",
                maxHeight: "400px",
                margin: 0,
              }}
            >
              {JSON.stringify(shopifyEvent, null, 2)}
            </pre>
          </Box>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
