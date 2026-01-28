import { useState, useCallback, useMemo } from "react";
import { BlockStack, InlineStack, Text, Badge, Card, Collapsible, Banner, List, Box, ProgressBar } from "@shopify/polaris";
import { CheckoutCompletedBehaviorHint } from "../CheckoutCompletedBehaviorHint";
import { checkParamCompleteness } from "~/utils/event-param-completeness";
import type { RealtimeEvent } from "../RealtimeEventMonitor";

function getCompletenessTone(rate: number): "success" | "warning" | "critical" {
  if (rate >= 90) return "success";
  if (rate >= 70) return "warning";
  return "critical";
}

interface EventDetailsProps {
  event: RealtimeEvent;
}

export function EventDetails({ event }: EventDetailsProps) {
  const [expanded, setExpanded] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    params: true,
    completeness: true,
    shopify: true,
    errors: true,
    mapping: false,
    payload: false,
  });
  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);
  const completeness = useMemo(() => {
    return checkParamCompleteness(event.eventType, event.platform, event.params);
  }, [event.eventType, event.platform, event.params]);
  return (
    <BlockStack gap="300">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
        style={{ cursor: "pointer" }}
      >
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" fontWeight="semibold">
            事件详情
          </Text>
          <Text as="span" tone="subdued">
            {expanded ? "▲ 收起" : "▼ 展开"}
          </Text>
        </InlineStack>
      </div>
      <Collapsible open={expanded} id="event-details">
        <BlockStack gap="300">
          <Card>
            <BlockStack gap="200">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleSection("basic")}
                onKeyDown={(e) => e.key === "Enter" && toggleSection("basic")}
                style={{ cursor: "pointer" }}
              >
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="semibold" variant="headingSm">
                    基本信息
                  </Text>
                  <Text as="span" tone="subdued">
                    {expandedSections.basic ? "▲ 收起" : "▼ 展开"}
                  </Text>
                </InlineStack>
              </div>
              <Collapsible open={expandedSections.basic} id="event-details-basic">
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      事件类型
                    </Text>
                    <Text as="span" fontWeight="semibold">
                      {event.eventType}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      平台
                    </Text>
                    <Badge>{event.platform}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      时间
                    </Text>
                    <Text as="span">
                      {new Date(event.timestamp).toLocaleString("zh-CN")}
                    </Text>
                  </InlineStack>
                  {event.orderId && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单 ID
                      </Text>
                      <Text as="span">{event.orderId}</Text>
                    </InlineStack>
                  )}
                  {event.orderNumber && (
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单号
                      </Text>
                      <Text as="span">#{event.orderNumber}</Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
          {event.params && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("params")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("params")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      事件参数
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.params ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.params} id="event-details-params">
                  <BlockStack gap="200">
                    {event.params.value !== undefined && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          金额
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {event.params.currency || ""} {typeof event.params.value === "number" ? event.params.value.toFixed(2) : event.params.value}
                        </Text>
                      </InlineStack>
                    )}
                    {event.params.currency && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          币种
                        </Text>
                        <Text as="span">{event.params.currency}</Text>
                      </InlineStack>
                    )}
                    {event.params.items !== undefined && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          商品数量
                        </Text>
                        <Text as="span">{event.params.items}</Text>
                      </InlineStack>
                    )}
                    {event.params.hasEventId !== undefined && (
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          事件 ID
                        </Text>
                        <Badge tone={event.params.hasEventId ? "success" : "critical"}>
                          {event.params.hasEventId ? "有" : "无"}
                        </Badge>
                      </InlineStack>
                    )}
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          )}
          {event.paramCompleteness && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("completeness")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("completeness")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      参数完整率
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.completeness ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.completeness} id="event-details-completeness">
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" tone="subdued">
                        总体完整率
                      </Text>
                      <Badge tone={getCompletenessTone(event.paramCompleteness.completeness)}>
                        {`${event.paramCompleteness.completeness}%`}
                      </Badge>
                    </InlineStack>
                    <ProgressBar
                      progress={event.paramCompleteness.completeness}
                      tone={getCompletenessTone(event.paramCompleteness.completeness) as "success" | "critical"}
                    />
                    <BlockStack gap="100">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          value
                        </Text>
                        <Badge tone={event.paramCompleteness.hasValue ? "success" : "critical"}>
                          {event.paramCompleteness.hasValue ? "✓" : "✗"}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          currency
                        </Text>
                        <Badge tone={event.paramCompleteness.hasCurrency ? "success" : "critical"}>
                          {event.paramCompleteness.hasCurrency ? "✓" : "✗"}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">
                          event_id
                        </Text>
                        <Badge tone={event.paramCompleteness.hasEventId ? "success" : "critical"}>
                          {event.paramCompleteness.hasEventId ? "✓" : "✗"}
                        </Badge>
                      </InlineStack>
                    </BlockStack>
                    {event.paramCompleteness.missingParams.length > 0 && (
                      <Banner tone="warning">
                        <Text as="p" variant="bodySm">
                          缺失参数: {event.paramCompleteness.missingParams.join(", ")}
                        </Text>
                      </Banner>
                    )}
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          )}
          {event.shopifyOrder && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("shopify")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("shopify")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      Shopify 订单对比
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.shopify ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.shopify} id="event-details-shopify">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单金额
                      </Text>
                      <Text as="span" fontWeight="semibold">
                        {event.shopifyOrder.currency || ""} {typeof event.shopifyOrder.value === "number" ? event.shopifyOrder.value.toFixed(2) : event.shopifyOrder.value}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        商品数量
                      </Text>
                      <Text as="span" fontWeight="semibold">{event.shopifyOrder.itemCount}</Text>
                    </InlineStack>
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          )}
          {event.eventType === "checkout_completed" && event.status !== "success" && (
            <CheckoutCompletedBehaviorHint mode="missing" />
          )}
          {((event.discrepancies && event.discrepancies.length > 0) || (event.errors && event.errors.length > 0)) && (
            <Card>
              <BlockStack gap="200">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSection("errors")}
                  onKeyDown={(e) => e.key === "Enter" && toggleSection("errors")}
                  style={{ cursor: "pointer" }}
                >
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" fontWeight="semibold" variant="headingSm">
                      差异和错误
                    </Text>
                    <Text as="span" tone="subdued">
                      {expandedSections.errors ? "▲ 收起" : "▼ 展开"}
                    </Text>
                  </InlineStack>
                </div>
                <Collapsible open={expandedSections.errors} id="event-details-errors">
                  <BlockStack gap="200">
                    {event.discrepancies && event.discrepancies.length > 0 && (
                      <Banner tone="warning" title="发现差异">
                        <List type="bullet">
                          {event.discrepancies.map((disc, index) => (
                            <List.Item key={index}>{disc}</List.Item>
                          ))}
                        </List>
                      </Banner>
                    )}
                    {event.errors && event.errors.length > 0 && (
                      <Banner tone="critical" title="错误">
                        <List type="bullet">
                          {event.errors.map((err, index) => (
                            <List.Item key={index}>{err}</List.Item>
                          ))}
                        </List>
                      </Banner>
                    )}
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}
