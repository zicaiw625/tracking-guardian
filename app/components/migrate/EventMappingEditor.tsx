

import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  TextField,
  Select,
  Banner,
  List,
  DataTable,
  Icon,
  Checkbox,
  ButtonGroup,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  InfoIcon,
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

interface EventMapping {
  shopifyEvent: string;
  platformEvent: string;
  enabled: boolean;
  customParams?: Record<string, string>;
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

export function EventMappingEditor({
  platform,
  mappings,
  onMappingChange,
  onEnableChange,
}: EventMappingEditorProps) {
  const [selectedShopifyEvent, setSelectedShopifyEvent] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [bulkMappingValue, setBulkMappingValue] = useState<string>("");
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const platformEvents = PLATFORM_EVENTS[platform];

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

  const applyRecommended = useCallback(() => {
    const recommended = RECOMMENDED_MAPPINGS[platform];
    Object.entries(recommended).forEach(([shopifyEvent, platformEvent]) => {
      onMappingChange(shopifyEvent, platformEvent);
    });
  }, [platform, onMappingChange]);

  const applyBulkMapping = useCallback(() => {
    if (!bulkMappingValue || selectedEvents.size === 0) return;
    selectedEvents.forEach((shopifyEvent) => {
      onMappingChange(shopifyEvent, bulkMappingValue);
    });
    setSelectedEvents(new Set());
    setBulkMappingValue("");
  }, [bulkMappingValue, selectedEvents, onMappingChange]);

  const toggleEventSelection = useCallback((eventId: string) => {
    const newSelected = new Set(selectedEvents);
    if (newSelected.has(eventId)) {
      newSelected.delete(eventId);
    } else {
      newSelected.add(eventId);
    }
    setSelectedEvents(newSelected);
  }, [selectedEvents]);

  const selectAll = useCallback(() => {
    setSelectedEvents(new Set(SHOPIFY_EVENTS.map(e => e.id)));
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
            <Button size="slim" onClick={applyRecommended}>
              应用推荐映射
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
                    const platformEvent = platformEvents.find(e => e.id === currentMapping);
                    const recommendedPlatformEvent = platformEvents.find(e => e.id === recommendedMapping);
                    
                    return [
                      shopifyEvent.name,
                      currentMapping ? `${platformEvent?.name || currentMapping}` : "未映射",
                      recommendedMapping ? `${recommendedPlatformEvent?.name || recommendedMapping}` : "-",
                      isRecommended ? (
                        <Badge key="rec" tone="success">推荐</Badge>
                      ) : currentMapping ? (
                        <Badge key="custom" tone="info">自定义</Badge>
                      ) : (
                        <Badge key="none" tone="warning">未配置</Badge>
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
          
          {SHOPIFY_EVENTS.map((shopifyEvent) => {
            const currentMapping = mappings[shopifyEvent.id] || "";
            const mappingStatus = currentMapping
              ? getMappingStatus(shopifyEvent.id, currentMapping)
              : null;
            const isSelected = selectedEvents.has(shopifyEvent.id);
            const recommendedMapping = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id] || "";

            return (
              <Card key={shopifyEvent.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <InlineStack gap="200" blockAlign="center">
                      <Checkbox
                        label=""
                        checked={isSelected}
                        onChange={() => toggleEventSelection(shopifyEvent.id)}
                      />
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {shopifyEvent.name}
                          </Text>
                        {mappingStatus?.status === "recommended" && (
                          <Badge tone="success">推荐</Badge>
                        )}
                        {mappingStatus?.status === "error" && (
                          <Badge tone="critical">错误</Badge>
                        )}
                        {mappingStatus?.status === "custom" && (
                          <Badge tone="info">自定义</Badge>
                        )}
                        {showComparison && recommendedMapping && currentMapping !== recommendedMapping && (
                          <Badge tone="warning">
                            推荐: {platformEvents.find(e => e.id === recommendedMapping)?.name || recommendedMapping}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {shopifyEvent.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <Box minWidth="100%">
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
                      onChange={(value) => onMappingChange(shopifyEvent.id, value)}
                    />
                  </Box>

                  {mappingStatus?.status === "error" && mappingStatus.errors.length > 0 && (
                    <Banner tone="critical">
                      <List type="bullet">
                        {mappingStatus.errors.map((error, idx) => (
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
                              {shopifyEvent.availableParams.map((param) => (
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
                                        必需: {param}
                                      </Badge>
                                    ))}
                                    {platformEventDef.optionalParams.map((param) => (
                                      <Badge key={param} tone="info">
                                        可选: {param}
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

