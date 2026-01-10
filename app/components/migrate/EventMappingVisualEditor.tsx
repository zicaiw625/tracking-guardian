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
  Select,
  Banner,
  Icon,
  ButtonGroup,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
} from "~/components/icons";

type Platform = "google" | "meta" | "tiktok" | "pinterest";

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

interface EventMappingVisualEditorProps {
  platform: Platform;
  mappings: Record<string, string>;
  onMappingChange: (shopifyEvent: string, platformEvent: string) => void;
  showPreview?: boolean;
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
    id: "add_to_cart",
    name: "Add to Cart",
    description: "添加商品到购物车",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "view_item",
    name: "View Item",
    description: "查看商品详情",
    availableParams: ["value", "currency", "items"],
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
  pinterest: [
    {
      id: "checkout",
      name: "Checkout",
      description: "完成结账",
      requiredParams: ["value", "currency"],
      optionalParams: ["order_quantity", "line_items"],
    },
    {
      id: "add_to_cart",
      name: "Add to Cart",
      description: "添加到购物车",
      requiredParams: ["value", "currency"],
      optionalParams: ["order_quantity", "line_items"],
    },
    {
      id: "page_visit",
      name: "Page Visit",
      description: "页面访问",
      requiredParams: [],
      optionalParams: ["value", "currency"],
    },
  ],
};

const RECOMMENDED_MAPPINGS: Record<Platform, Record<string, string>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    add_to_cart: "add_to_cart",
    view_item: "view_item",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_item: "ViewContent",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_item: "ViewContent",
  },
  pinterest: {
    checkout_completed: "checkout",
    checkout_started: "checkout",
    add_to_cart: "add_to_cart",
    view_item: "page_visit",
  },
};

const PLATFORM_NAMES: Record<Platform, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

export function EventMappingVisualEditor({
  platform,
  mappings,
  onMappingChange,
}: EventMappingVisualEditorProps) {
  const [selectedShopifyEvent, setSelectedShopifyEvent] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const [draggedShopifyEvent, setDraggedShopifyEvent] = useState<string | null>(null);
  const [dragOverPlatformEvent, setDragOverPlatformEvent] = useState<string | null>(null);
  const platformEvents = PLATFORM_EVENTS[platform];
  const generateEventPreview = useCallback(
    (shopifyEventId: string, platformEventId: string) => {
      const shopifyEvent = SHOPIFY_EVENTS.find((e) => e.id === shopifyEventId);
      const platformEvent = platformEvents.find((e) => e.id === platformEventId);
      if (!shopifyEvent || !platformEvent) return null;
      const preview: Record<string, unknown> = {
        event_name: platformEventId,
      };
      shopifyEvent.availableParams.forEach((param) => {
        if (param === "items") {
          preview.items = [
            {
              item_id: "PRODUCT_ID",
              item_name: "Product Name",
              price: 99.99,
              quantity: 1,
            },
          ];
        } else if (param === "order_id") {
          preview.transaction_id = "ORDER_12345";
        } else {
          preview[param] = param === "value" ? 99.99 : param === "currency" ? "USD" : param;
        }
      });
      return preview;
    },
    [platformEvents]
  );
  const validateMapping = useCallback(
    (shopifyEvent: string, platformEvent: string): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];
      const shopifyEventDef = SHOPIFY_EVENTS.find((e) => e.id === shopifyEvent);
      const platformEventDef = platformEvents.find((e) => e.id === platformEvent);
      if (!shopifyEventDef) {
        errors.push(`未知的 Shopify 事件: ${shopifyEvent}`);
      }
      if (!platformEventDef) {
        errors.push(`未知的平台事件: ${platformEvent}`);
        return { valid: false, errors };
      }
      const missingParams = platformEventDef.requiredParams.filter(
        (param) => !shopifyEventDef?.availableParams.includes(param)
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
  const togglePreview = useCallback((shopifyEventId: string) => {
    setShowPreview((prev) => ({
      ...prev,
      [shopifyEventId]: !prev[shopifyEventId],
    }));
  }, []);
  const handleDragStart = useCallback((shopifyEventId: string) => {
    setDraggedShopifyEvent(shopifyEventId);
  }, []);
  const handleDragEnd = useCallback(() => {
    setDraggedShopifyEvent(null);
    setDragOverPlatformEvent(null);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, platformEventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPlatformEvent(platformEventId);
  }, []);
  const handleDragLeave = useCallback(() => {
    setDragOverPlatformEvent(null);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent, platformEventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedShopifyEvent) {
      onMappingChange(draggedShopifyEvent, platformEventId);
      setDraggedShopifyEvent(null);
      setDragOverPlatformEvent(null);
    }
  }, [draggedShopifyEvent, onMappingChange]);
  const applyRecommendedMappings = useCallback(() => {
    const recommended = RECOMMENDED_MAPPINGS[platform];
    Object.entries(recommended).forEach(([shopifyEvent, platformEvent]) => {
      onMappingChange(shopifyEvent, platformEvent);
    });
  }, [platform, onMappingChange]);
  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                可视化事件映射编辑器
              </Text>
              <Text as="p" tone="subdued">
                拖拽左侧的 Shopify 事件到右侧的平台事件，或点击选择后在下拉菜单中选择。映射关系以连接线显示。
              </Text>
            </BlockStack>
            <Button size="slim" variant="primary" onClick={applyRecommendedMappings}>
              ✨ 一键应用推荐映射
            </Button>
          </InlineStack>
        </BlockStack>
        <Divider />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: "24px",
            alignItems: "start",
          }}
        >
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm" fontWeight="semibold">
              Shopify 标准事件
            </Text>
            {SHOPIFY_EVENTS.map((shopifyEvent) => {
              const currentMapping = mappings[shopifyEvent.id] || "";
              const isSelected = selectedShopifyEvent === shopifyEvent.id;
              const isMapped = !!currentMapping;
              return (
                <div
                  style={{
                    cursor: "grab",
                    border: isSelected ? "2px solid var(--p-color-border-info)" : draggedShopifyEvent === shopifyEvent.id ? "2px dashed var(--p-color-border-warning)" : undefined,
                    opacity: draggedShopifyEvent === shopifyEvent.id ? 0.5 : 1,
                  }}
                  onClick={() => setSelectedShopifyEvent(shopifyEvent.id)}
                  draggable
                  onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                    handleDragStart(shopifyEvent.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", shopifyEvent.id);
                  }}
                  onDragEnd={handleDragEnd}
                >
                  <Card
                    background={isSelected ? "bg-surface-selected" : draggedShopifyEvent === shopifyEvent.id ? "bg-surface-warning" : undefined}
                  >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" fontWeight="semibold">
                          {shopifyEvent.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {shopifyEvent.description}
                        </Text>
                      </BlockStack>
                      {isMapped && (
                        <Badge tone="success">已映射</Badge>
                      )}
                    </InlineStack>
                    <InlineStack gap="100" wrap>
                      {shopifyEvent.availableParams.map((param) => (
                        <Badge key={param} tone="info">
                          {param}
                        </Badge>
                      ))}
                    </InlineStack>
                  </BlockStack>
                  </Card>
                </div>
              );
            })}
          </BlockStack>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "400px",
            }}
          >
            <Icon source={ArrowRightIcon} />
            <Text as="span" variant="bodySm" tone="subdued" alignment="center">
              映射到
            </Text>
          </div>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm" fontWeight="semibold">
              {PLATFORM_NAMES[platform]} 事件
            </Text>
            {selectedShopifyEvent ? (
              <BlockStack gap="300">
                <Select
                  label="选择映射的平台事件"
                  options={[
                    { label: "请选择事件", value: "" },
                    ...platformEvents.map((event) => ({
                      label: `${event.name} - ${event.description}`,
                      value: event.id,
                    })),
                  ]}
                  value={mappings[selectedShopifyEvent] || ""}
                  onChange={(value) => {
                    if (value) {
                      onMappingChange(selectedShopifyEvent, value);
                    }
                  }}
                />
                {mappings[selectedShopifyEvent] && (
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h5" variant="headingSm">
                        映射预览
                      </Text>
                      {(() => {
                        const mapping = mappings[selectedShopifyEvent];
                        const platformEvent = platformEvents.find((e) => e.id === mapping);
                        const validation = validateMapping(selectedShopifyEvent, mapping);
                        const preview = generateEventPreview(selectedShopifyEvent, mapping);
                        return (
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge
                                tone={validation.valid ? "success" : "critical"}
                              >
                                {validation.valid ? "有效映射" : "映射错误"}
                              </Badge>
                              <Button
                                size="slim"
                                variant="plain"
                                onClick={() => togglePreview(selectedShopifyEvent)}
                              >
                                {showPreview[selectedShopifyEvent] ? "隐藏" : "显示"} JSON 预览
                              </Button>
                            </InlineStack>
                            {!validation.valid && (
                              <Banner tone="critical">
                                <Text as="p" variant="bodySm">
                                  {validation.errors.join(", ")}
                                </Text>
                              </Banner>
                            )}
                            {platformEvent && (
                              <BlockStack gap="200">
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  平台事件: {platformEvent.name}
                                </Text>
                                <InlineStack gap="100" wrap>
                                  {platformEvent.requiredParams.map((param) => (
                                    <Badge key={param} tone="critical">
                                      {`必需: ${param}`}
                                    </Badge>
                                  ))}
                                  {platformEvent.optionalParams.map((param) => (
                                    <Badge key={param} tone="info">
                                      {`可选: ${param}`}
                                    </Badge>
                                  ))}
                                </InlineStack>
                              </BlockStack>
                            )}
                            {showPreview[selectedShopifyEvent] && preview && (
                              <Box
                                padding="300"
                                background="bg-surface-secondary"
                                borderRadius="200"
                              >
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    事件 JSON 预览：
                                  </Text>
                                  <Box
                                    padding="300"
                                    background="bg-surface"
                                    borderRadius="100"
                                  >
                                    <pre style={{
                                      fontSize: "12px",
                                      overflow: "auto",
                                      maxHeight: "300px",
                                      margin: 0,
                                      whiteSpace: "pre-wrap",
                                      wordBreak: "break-word",
                                    }}>
                                      {JSON.stringify(preview, null, 2)}
                                    </pre>
                                  </Box>
                                </BlockStack>
                              </Box>
                            )}
                          </BlockStack>
                        );
                      })()}
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            ) : (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  请从左侧选择一个 Shopify 事件开始映射
                </Text>
              </Banner>
            )}
            <Divider />
            <BlockStack gap="200">
              <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                所有可用事件：
              </Text>
              {platformEvents.map((event) => {
                const isMapped = Object.values(mappings).includes(event.id);
                const isDragOver = dragOverPlatformEvent === event.id;
                return (
                  <div
                    key={event.id}
                    style={{
                      cursor: "pointer",
                      border: isDragOver ? "2px dashed var(--p-color-border-info)" : undefined,
                      transition: "all 0.2s ease",
                    }}
                    onDragOver={(e: React.DragEvent<HTMLDivElement>) => handleDragOver(e, event.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e: React.DragEvent<HTMLDivElement>) => handleDrop(e, event.id)}
                    onClick={() => {
                      if (selectedShopifyEvent) {
                        onMappingChange(selectedShopifyEvent, event.id);
                      }
                    }}
                  >
                    <Card
                      background={
                        isMapped
                          ? "bg-surface-secondary"
                          : isDragOver
                            ? "bg-surface-info"
                            : undefined
                      }
                    >
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" fontWeight={isMapped ? "semibold" : "regular"}>
                          {event.name}
                        </Text>
                        {isMapped && <Badge tone="success">已映射</Badge>}
                        {isDragOver && <Badge tone="info">放置这里</Badge>}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {event.description}
                      </Text>
                    </BlockStack>
                    </Card>
                  </div>
                );
              })}
            </BlockStack>
          </BlockStack>
        </div>
        <Divider />
        <BlockStack gap="300">
          <Text as="h4" variant="headingSm">
            映射关系总览
          </Text>
          <BlockStack gap="200">
            {SHOPIFY_EVENTS.map((shopifyEvent) => {
              const mapping = mappings[shopifyEvent.id];
              const platformEvent = mapping
                ? platformEvents.find((e) => e.id === mapping)
                : null;
              const recommended = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id];
              return (
                <Card key={shopifyEvent.id}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {shopifyEvent.name}
                        </Text>
                        <Icon source={ArrowRightIcon} />
                        <Text as="span">
                          {platformEvent?.name || "未映射"}
                        </Text>
                        {recommended === mapping && (
                          <Badge tone="success">推荐</Badge>
                        )}
                        {mapping && recommended !== mapping && (
                          <Badge tone="info">自定义</Badge>
                        )}
                      </InlineStack>
                      {!mapping && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          推荐映射到: {platformEvents.find((e) => e.id === recommended)?.name || recommended}
                        </Text>
                      )}
                    </BlockStack>
                  </InlineStack>
                </Card>
              );
            })}
          </BlockStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
