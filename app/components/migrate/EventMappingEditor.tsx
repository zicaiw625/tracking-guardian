import { useState, useCallback, useMemo } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  List,
  Checkbox,
  Popover,
  Select,
  DataTable,
  ButtonGroup,
  ActionList,
} from "@shopify/polaris";
import { ArrowUpIcon, ArrowDownIcon } from "~/components/icons";

type Platform = "google" | "meta" | "tiktok";

interface ShopifyEvent {
  id: string;
  name: string;
  description: string;
  availableParams: string[];
}

interface PlatformEvent {
  id: string;
  name: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
}

interface EventMappingEditorProps {
  platform: Platform;
  mappings: Record<string, string>;
  onMappingChange: (shopifyEvent: string, platformEvent: string) => void;
  onEnableChange?: (shopifyEvent: string, enabled: boolean) => void;
}

const SHOPIFY_EVENTS: ShopifyEvent[] = [
  {
    id: "checkout_completed",
    name: "Checkout Completed",
    description: "顾客完成结账",
    availableParams: ["value", "currency", "items", "order_id"],
  },
  {
    id: "checkout_started",
    name: "Checkout Started",
    description: "顾客开始结账",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "product_added_to_cart",
    name: "Product Added to Cart",
    description: "添加商品到购物车",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "product_viewed",
    name: "Product Viewed",
    description: "查看商品详情",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "page_viewed",
    name: "Page Viewed",
    description: "页面浏览",
    availableParams: ["value", "currency"],
  },
];

const PLATFORM_EVENTS: Record<Platform, PlatformEvent[]> = {
  google: [
    {
      id: "purchase",
      name: "Purchase",
      description: "完成购买",
      requiredParams: ["value", "currency"],
      optionalParams: ["items", "transaction_id"],
    },
    {
      id: "begin_checkout",
      name: "Begin Checkout",
      description: "开始结账",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
    {
      id: "add_to_cart",
      name: "Add to Cart",
      description: "添加到购物车",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
    {
      id: "view_item",
      name: "View Item",
      description: "查看商品",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
  ],
  meta: [
    {
      id: "Purchase",
      name: "Purchase",
      description: "完成购买",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "InitiateCheckout",
      name: "Initiate Checkout",
      description: "开始结账",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "AddToCart",
      name: "Add to Cart",
      description: "添加到购物车",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "ViewContent",
      name: "View Content",
      description: "查看内容",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
  ],
  tiktok: [
    {
      id: "CompletePayment",
      name: "Complete Payment",
      description: "完成支付",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "InitiateCheckout",
      name: "Initiate Checkout",
      description: "开始结账",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "AddToCart",
      name: "Add to Cart",
      description: "添加到购物车",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "ViewContent",
      name: "View Content",
      description: "查看内容",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
  ],
};

const RECOMMENDED_MAPPINGS: Record<Platform, Record<string, string>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    product_added_to_cart: "add_to_cart",
    product_viewed: "view_item",
    page_viewed: "page_view",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
  },
};

const PLATFORM_NAMES: Record<Platform, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export function EventMappingEditor({
  platform,
  mappings,
  onMappingChange,
  onEnableChange: _onEnableChange,
}: EventMappingEditorProps) {
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [bulkMappingValue, setBulkMappingValue] = useState<string>("");
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const [popoverActive, setPopoverActive] = useState<boolean>(false);
  const [eventOrder, setEventOrder] = useState<string[]>(() => SHOPIFY_EVENTS.map((e) => e.id));
  const platformEvents = PLATFORM_EVENTS[platform];
  const validateMapping = useCallback(
    (shopifyEvent: string, platformEvent: string): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];
      const shopifyEventDef = SHOPIFY_EVENTS.find((e) => e.id === shopifyEvent);
      const platformEventDef = platformEvents.find((e) => e.id === platformEvent);
      if (!shopifyEventDef) {
        errors.push(`未知的 Shopify 事件: ${shopifyEvent}`);
        return { valid: false, errors };
      }
      if (!platformEventDef) {
        errors.push(`未知的平台事件: ${platformEvent}`);
        return { valid: false, errors };
      }
      const missingParams = platformEventDef.requiredParams.filter(
        (param) => !shopifyEventDef.availableParams.includes(param)
      );
      if (missingParams.length > 0) {
        errors.push(`缺少必需参数: ${missingParams.join(", ")}`);
      }
      return {
        valid: errors.length === 0,
        errors,
      };
    },
    [platformEvents]
  );
  const applyRecommended = useCallback(() => {
    const recommended = RECOMMENDED_MAPPINGS[platform];
    Object.entries(recommended).forEach(([shopifyEvent, platformEvent]) => {
      onMappingChange(shopifyEvent, platformEvent);
    });
  }, [platform, onMappingChange]);
  const applyBulkMapping = useCallback(() => {
    if (!bulkMappingValue || selectedEvents.size === 0) return;
    selectedEvents.forEach((shopifyEvent: string) => {
      onMappingChange(shopifyEvent, bulkMappingValue);
    });
    setSelectedEvents(new Set());
    setBulkMappingValue("");
  }, [bulkMappingValue, selectedEvents, onMappingChange]);
  const toggleEventSelection = useCallback(
    (eventId: string) => {
      const newSelected = new Set(selectedEvents);
      if (newSelected.has(eventId)) {
        newSelected.delete(eventId);
      } else {
        newSelected.add(eventId);
      }
      setSelectedEvents(newSelected);
    },
    [selectedEvents]
  );
  const selectAll = useCallback(() => {
    setSelectedEvents(new Set(SHOPIFY_EVENTS.map((e) => e.id)));
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedEvents(new Set());
  }, []);
  const getMappingStatus = useCallback(
    (shopifyEvent: string, platformEvent: string) => {
      const validation = validateMapping(shopifyEvent, platformEvent);
      if (!validation.valid) {
        return { status: "error" as const, errors: validation.errors };
      }
      const recommended = RECOMMENDED_MAPPINGS[platform][shopifyEvent];
      if (platformEvent === recommended) {
        return { status: "recommended" as const, errors: [] };
      }
      return { status: "custom" as const, errors: [] };
    },
    [platform, validateMapping]
  );
  const generateEventPreview = useCallback(
    (shopifyEventId: string, platformEventId: string) => {
      const shopifyEvent = SHOPIFY_EVENTS.find((e) => e.id === shopifyEventId);
      const platformEvent = platformEvents.find((e) => e.id === platformEventId);
      if (!shopifyEvent || !platformEvent) return null;
      const preview: Record<string, string | number | unknown[]> = {
        event_name: platformEventId,
        event_time: Math.floor(Date.now() / 1000),
        event_id: "preview_event_id_" + Date.now(),
      };
      platformEvent.requiredParams.forEach((param) => {
        if (shopifyEvent.availableParams.includes(param)) {
          preview[param] =
            param === "value" ? "99.99" : param === "currency" ? "USD" : param === "items" ? [] : "sample_value";
        }
      });
      platformEvent.optionalParams.forEach((param) => {
        if (shopifyEvent.availableParams.includes(param)) {
          preview[param] = param === "items" || param === "contents" || param === "line_items" ? [] : "sample_value";
        }
      });
      return preview;
    },
    [platformEvents]
  );
  const moveEventUp = useCallback(
    (eventId: string) => {
      const currentIndex = eventOrder.indexOf(eventId);
      if (currentIndex <= 0) return;
      const newOrder = [...eventOrder];
      [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
      setEventOrder(newOrder);
    },
    [eventOrder]
  );
  const moveEventDown = useCallback(
    (eventId: string) => {
      const currentIndex = eventOrder.indexOf(eventId);
      if (currentIndex >= eventOrder.length - 1) return;
      const newOrder = [...eventOrder];
      [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
      setEventOrder(newOrder);
    },
    [eventOrder]
  );
  const orderedEvents = useMemo(() => {
    const eventMap = new Map(SHOPIFY_EVENTS.map((e) => [e.id, e]));
    return eventOrder
      .map((id: string) => eventMap.get(id))
      .filter((event: ShopifyEvent | undefined): event is ShopifyEvent => event !== undefined);
  }, [eventOrder]);
  const togglePreview = useCallback((eventId: string) => {
    setShowPreview((prev: Record<string, boolean>) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  }, []);
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            事件映射配置 - {PLATFORM_NAMES[platform]}
          </Text>
          <InlineStack gap="200">
            <Button size="slim" variant="plain" onClick={() => setShowComparison(!showComparison)}>
              {showComparison ? "隐藏对比" : "显示对比视图"}
            </Button>
            <Popover
              active={popoverActive}
              activator={
                <Button size="slim" variant="plain" onClick={() => setPopoverActive(!popoverActive)}>
                  📋 映射模板
                </Button>
              }
              onClose={() => setPopoverActive(false)}
            >
              <ActionList
                items={[
                  {
                    content: "推荐映射（默认）",
                    onAction: applyRecommended,
                  },
                  {
                    content: "仅购买事件",
                    onAction: () => {
                      const purchaseMapping = RECOMMENDED_MAPPINGS[platform];
                      if (purchaseMapping.checkout_completed) {
                        onMappingChange("checkout_completed", purchaseMapping.checkout_completed);
                      }
                    },
                  },
                  {
                    content: "完整漏斗映射",
                    onAction: () => {
                      const recommended = RECOMMENDED_MAPPINGS[platform];
                      Object.entries(recommended).forEach(([shopifyEvent, platformEvent]) => {
                        onMappingChange(shopifyEvent, platformEvent);
                      });
                    },
                  },
                ]}
              />
            </Popover>
            <Button size="slim" variant="primary" onClick={applyRecommended}>
              ✨ 一键应用推荐映射
            </Button>
          </InlineStack>
        </InlineStack>
        {selectedEvents.size > 0 && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                批量编辑模式：已选择 {selectedEvents.size} 个事件
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Select
                  label="批量映射到"
                  labelHidden
                  options={[
                    { label: "选择平台事件", value: "" },
                    ...platformEvents.map((event) => ({
                      label: `${event.name} - ${event.description}`,
                      value: event.id,
                    })),
                  ]}
                  value={bulkMappingValue}
                  onChange={setBulkMappingValue}
                />
                <Button size="slim" onClick={applyBulkMapping} disabled={!bulkMappingValue}>
                  应用
                </Button>
                <Button size="slim" variant="plain" onClick={clearSelection}>
                  取消选择
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              将 Shopify 标准事件映射到 {PLATFORM_NAMES[platform]} 的事件名称。
              我们已为您配置了推荐映射，您也可以自定义。
            </Text>
            <Box paddingBlockStart="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                最佳实践提示：
              </Text>
              <List type="bullet">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    <strong>checkout_completed</strong> →{" "}
                    <strong>{RECOMMENDED_MAPPINGS[platform].checkout_completed || "purchase"}</strong>
                    ：这是最重要的转化事件，确保正确映射
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    建议启用完整漏斗追踪：product_viewed → product_added_to_cart → checkout_started → checkout_completed
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    所有事件都会自动包含 value、currency、items 等参数，无需手动配置
                  </Text>
                </List.Item>
              </List>
            </Box>
          </BlockStack>
        </Banner>
        <Divider />
        {showComparison && (
          <Box paddingBlockEnd="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h4" variant="headingSm">
                  映射对比视图
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Shopify 事件", "当前映射", "推荐映射", "状态"]}
                  rows={SHOPIFY_EVENTS.map((shopifyEvent) => {
                    const currentMapping = mappings[shopifyEvent.id] || "";
                    const recommendedMapping = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id] || "";
                    const isRecommended = currentMapping === recommendedMapping;
                    const platformEvent = platformEvents.find((e) => e.id === currentMapping);
                    const recommendedPlatformEvent = platformEvents.find((e) => e.id === recommendedMapping);
                    return [
                      shopifyEvent.name,
                      currentMapping ? `${platformEvent?.name || currentMapping}` : "未映射",
                      recommendedMapping ? `${recommendedPlatformEvent?.name || recommendedMapping}` : "-",
                      isRecommended ? (
                        <Badge key="rec" tone="success">
                          推荐
                        </Badge>
                      ) : currentMapping ? (
                        <Badge key="custom" tone="info">
                          自定义
                        </Badge>
                      ) : (
                        <Badge key="none" tone="warning">
                          未配置
                        </Badge>
                      ),
                    ];
                  })}
                />
              </BlockStack>
            </Card>
          </Box>
        )}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              选择多个事件可进行批量编辑
            </Text>
            <InlineStack gap="200">
              <Button size="slim" variant="plain" onClick={selectAll}>
                全选
              </Button>
              {selectedEvents.size > 0 && (
                <Button size="slim" variant="plain" onClick={clearSelection}>
                  清除选择
                </Button>
              )}
            </InlineStack>
          </InlineStack>
          {orderedEvents.map((shopifyEvent: ShopifyEvent, index: number) => {
            const currentMapping = mappings[shopifyEvent.id] || "";
            const mappingStatus = currentMapping ? getMappingStatus(shopifyEvent.id, currentMapping) : null;
            const isSelected = selectedEvents.has(shopifyEvent.id);
            const recommendedMapping = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id] || "";
            const eventPreview = currentMapping ? generateEventPreview(shopifyEvent.id, currentMapping) : null;
            const isPreviewOpen = showPreview[shopifyEvent.id];
            return (
              <Card key={shopifyEvent.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <InlineStack gap="200" blockAlign="center">
                      <Checkbox label="" checked={isSelected} onChange={() => toggleEventSelection(shopifyEvent.id)} />
                      <InlineStack gap="100" blockAlign="center">
                        <ButtonGroup>
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ArrowUpIcon}
                            onClick={() => moveEventUp(shopifyEvent.id)}
                            disabled={index === 0}
                            accessibilityLabel="上移"
                          />
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ArrowDownIcon}
                            onClick={() => moveEventDown(shopifyEvent.id)}
                            disabled={index === orderedEvents.length - 1}
                            accessibilityLabel="下移"
                          />
                        </ButtonGroup>
                      </InlineStack>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {shopifyEvent.name}
                          </Text>
                          {mappingStatus?.status === "recommended" && <Badge tone="success">推荐</Badge>}
                          {mappingStatus?.status === "error" && <Badge tone="critical">错误</Badge>}
                          {mappingStatus?.status === "custom" && <Badge tone="info">自定义</Badge>}
                          {showComparison && recommendedMapping && currentMapping !== recommendedMapping && (
                            <Badge tone="warning">
                              {`推荐: ${platformEvents.find((e) => e.id === recommendedMapping)?.name || recommendedMapping}`}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {shopifyEvent.description}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </InlineStack>
                  <Box minWidth="100%">
                    <InlineStack gap="200" blockAlign="end">
                      <Box minWidth="300">
                        <Select
                          label="映射到平台事件"
                          options={[
                            { label: "请选择事件", value: "" },
                            ...platformEvents.map((event) => ({
                              label: `${event.name} - ${event.description}`,
                              value: event.id,
                            })),
                          ]}
                          value={currentMapping}
                          onChange={(value: string) => onMappingChange(shopifyEvent.id, value)}
                        />
                      </Box>
                      {currentMapping && (
                        <Button size="slim" variant="plain" onClick={() => togglePreview(shopifyEvent.id)}>
                          {isPreviewOpen ? "隐藏预览" : "预览事件 JSON"}
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                  {currentMapping && isPreviewOpen && eventPreview && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          平台事件预览（{PLATFORM_NAMES[platform]}）：
                        </Text>
                        <Box padding="300" background="bg-surface" borderRadius="100">
                          <pre
                            style={{
                              fontSize: "12px",
                              overflow: "auto",
                              maxHeight: "300px",
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {JSON.stringify(eventPreview, null, 2)}
                          </pre>
                        </Box>
                        <Text as="span" variant="bodySm" tone="subdued">
                          这是发送到 {PLATFORM_NAMES[platform]} 的事件格式预览。实际发送时会使用订单的真实数据。
                        </Text>
                        <Divider />
                        <BlockStack gap="200">
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            参数映射详情：
                          </Text>
                          <BlockStack gap="100">
                            {(() => {
                              const platformEventDef = platformEvents.find((e) => e.id === currentMapping);
                              if (!platformEventDef) return null;
                              const mappedParams = platformEventDef.requiredParams
                                .concat(platformEventDef.optionalParams)
                                .filter((param) => shopifyEvent.availableParams.includes(param));
                              const missingParams = platformEventDef.requiredParams.filter(
                                (param) => !shopifyEvent.availableParams.includes(param)
                              );
                              return (
                                <>
                                  {mappedParams.length > 0 && (
                                    <InlineStack gap="100" wrap>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        已映射参数：
                                      </Text>
                                      {mappedParams.map((param) => (
                                        <Badge key={param} tone="success">
                                          {param}
                                        </Badge>
                                      ))}
                                    </InlineStack>
                                  )}
                                  {missingParams.length > 0 && (
                                    <InlineStack gap="100" wrap>
                                      <Text as="span" variant="bodySm" tone="subdued">
                                        缺失参数：
                                      </Text>
                                      {missingParams.map((param) => (
                                        <Badge key={param} tone="warning">
                                          {param}
                                        </Badge>
                                      ))}
                                    </InlineStack>
                                  )}
                                </>
                              );
                            })()}
                          </BlockStack>
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  )}
                  {mappingStatus?.status === "error" && mappingStatus.errors.length > 0 && (
                    <Banner tone="critical">
                      <List type="bullet">
                        {mappingStatus.errors.map((error: string, idx: number) => (
                          <List.Item key={idx}>{error}</List.Item>
                        ))}
                      </List>
                    </Banner>
                  )}
                  {currentMapping && mappingStatus?.status !== "error" && (
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="300">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          参数映射预览：
                        </Text>
                        <BlockStack gap="200">
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                              Shopify 事件参数：
                            </Text>
                            <InlineStack gap="100" wrap>
                              {shopifyEvent.availableParams.map((param: string) => (
                                <Badge key={param} tone="info">
                                  {param}
                                </Badge>
                              ))}
                            </InlineStack>
                          </BlockStack>
                          <Box>
                            <Text as="span" variant="bodySm" tone="subdued">
                              ↓ 映射到 ↓
                            </Text>
                          </Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                              {PLATFORM_NAMES[platform]} 事件参数：
                            </Text>
                            <InlineStack gap="100" wrap>
                              {(() => {
                                const platformEventDef = platformEvents.find((e) => e.id === currentMapping);
                                if (!platformEventDef) return null;
                                return (
                                  <>
                                    {platformEventDef.requiredParams.map((param) => (
                                      <Badge key={param} tone="critical">
                                        {`必需: ${param}`}
                                      </Badge>
                                    ))}
                                    {platformEventDef.optionalParams.map((param) => (
                                      <Badge key={param} tone="info">
                                        {`可选: ${param}`}
                                      </Badge>
                                    ))}
                                  </>
                                );
                              })()}
                            </InlineStack>
                          </BlockStack>
                          {(() => {
                            const platformEventDef = platformEvents.find((e) => e.id === currentMapping);
                            if (!platformEventDef) return null;
                            const missingParams = platformEventDef.requiredParams.filter(
                              (param) => !shopifyEvent.availableParams.includes(param)
                            );
                            if (missingParams.length > 0) {
                              return (
                                <Banner tone="warning">
                                  <Text as="p" variant="bodySm">
                                    警告：缺少必需参数 {missingParams.join(", ")}。这些参数可能需要在服务端补充。
                                  </Text>
                                </Banner>
                              );
                            }
                            return null;
                          })()}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
