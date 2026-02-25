import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import {
  ArrowUpIcon,
  ArrowDownIcon,
} from "~/components/icons";

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
    description: "eventMapping.shopifyEvent.checkoutCompleted",
    availableParams: ["value", "currency", "items", "order_id"],
  },
  {
    id: "checkout_started",
    name: "Checkout Started",
    description: "eventMapping.shopifyEvent.checkoutStarted",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "product_added_to_cart",
    name: "Product Added to Cart",
    description: "eventMapping.shopifyEvent.productAddedToCart",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "product_viewed",
    name: "Product Viewed",
    description: "eventMapping.shopifyEvent.productViewed",
    availableParams: ["value", "currency", "items"],
  },
  {
    id: "page_viewed",
    name: "Page Viewed",
    description: "eventMapping.shopifyEvent.pageViewed",
    availableParams: ["value", "currency"],
  },
];

const PLATFORM_EVENTS: Record<Platform, PlatformEvent[]> = {
  google: [
    {
      id: "purchase",
      name: "Purchase",
      description: "eventMapping.platformEvent.google.purchase",
      requiredParams: ["value", "currency"],
      optionalParams: ["items", "transaction_id"],
    },
    {
      id: "begin_checkout",
      name: "Begin Checkout",
      description: "eventMapping.platformEvent.google.beginCheckout",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
    {
      id: "add_to_cart",
      name: "Add to Cart",
      description: "eventMapping.platformEvent.google.addToCart",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
    {
      id: "view_item",
      name: "View Item",
      description: "eventMapping.platformEvent.google.viewItem",
      requiredParams: ["value", "currency"],
      optionalParams: ["items"],
    },
  ],
  meta: [
    {
      id: "Purchase",
      name: "Purchase",
      description: "eventMapping.platformEvent.meta.purchase",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "InitiateCheckout",
      name: "Initiate Checkout",
      description: "eventMapping.platformEvent.meta.initiateCheckout",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "AddToCart",
      name: "Add to Cart",
      description: "eventMapping.platformEvent.meta.addToCart",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
    {
      id: "ViewContent",
      name: "View Content",
      description: "eventMapping.platformEvent.meta.viewContent",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_ids", "content_type", "contents"],
    },
  ],
  tiktok: [
    {
      id: "CompletePayment",
      name: "Complete Payment",
      description: "eventMapping.platformEvent.tiktok.completePayment",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "InitiateCheckout",
      name: "Initiate Checkout",
      description: "eventMapping.platformEvent.tiktok.initiateCheckout",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "AddToCart",
      name: "Add to Cart",
      description: "eventMapping.platformEvent.tiktok.addToCart",
      requiredParams: ["value", "currency"],
      optionalParams: ["content_type", "contents"],
    },
    {
      id: "ViewContent",
      name: "View Content",
      description: "eventMapping.platformEvent.tiktok.viewContent",
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
  const { t } = useTranslation();
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [bulkMappingValue, setBulkMappingValue] = useState<string>("");
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const [popoverActive, setPopoverActive] = useState<boolean>(false);
  const [eventOrder, setEventOrder] = useState<string[]>(() =>
    SHOPIFY_EVENTS.map(e => e.id)
  );
  const platformEvents = PLATFORM_EVENTS[platform];
  const validateMapping = useCallback(
    (shopifyEvent: string, platformEvent: string): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];
      const shopifyEventDef = SHOPIFY_EVENTS.find((e) => e.id === shopifyEvent);
      const platformEventDef = platformEvents.find((e) => e.id === platformEvent);
      if (!shopifyEventDef) {
        errors.push(t("eventMapping.unknownShopifyEvent", { event: shopifyEvent }));
        return { valid: false, errors };
      }
      if (!platformEventDef) {
        errors.push(t("eventMapping.unknownPlatformEvent", { event: platformEvent }));
        return { valid: false, errors };
      }
      const missingParams = platformEventDef.requiredParams.filter(
        (param) => !shopifyEventDef.availableParams.includes(param)
      );
      if (missingParams.length > 0) {
        errors.push(t("eventMapping.missingRequiredParams", { params: missingParams.join(", ") }));
      }
      return {
        valid: errors.length === 0,
        errors,
      };
    },
    [platformEvents, t]
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
  const generateEventPreview = useCallback(
    (shopifyEventId: string, platformEventId: string) => {
      const shopifyEvent = SHOPIFY_EVENTS.find(e => e.id === shopifyEventId);
      const platformEvent = platformEvents.find(e => e.id === platformEventId);
      if (!shopifyEvent || !platformEvent) return null;
      const preview: Record<string, string | number | unknown[]> = {
        event_name: platformEventId,
        event_time: Math.floor(Date.now() / 1000),
        event_id: "preview_event_id_" + Date.now(),
      };
      platformEvent.requiredParams.forEach(param => {
        if (shopifyEvent.availableParams.includes(param)) {
          preview[param] = param === "value" ? "99.99" : param === "currency" ? "USD" : param === "items" ? [] : "sample_value";
        }
      });
      platformEvent.optionalParams.forEach(param => {
        if (shopifyEvent.availableParams.includes(param)) {
          preview[param] = param === "items" || param === "contents" || param === "line_items" ? [] : "sample_value";
        }
      });
      return preview;
    },
    [platformEvents]
  );
  const moveEventUp = useCallback((eventId: string) => {
    const currentIndex = eventOrder.indexOf(eventId);
    if (currentIndex <= 0) return;
    const newOrder = [...eventOrder];
    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
    setEventOrder(newOrder);
  }, [eventOrder]);
  const moveEventDown = useCallback((eventId: string) => {
    const currentIndex = eventOrder.indexOf(eventId);
    if (currentIndex >= eventOrder.length - 1) return;
    const newOrder = [...eventOrder];
    [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
    setEventOrder(newOrder);
  }, [eventOrder]);
  const orderedEvents = useMemo(() => {
    const eventMap = new Map(SHOPIFY_EVENTS.map(e => [e.id, e]));
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
            {t("eventMapping.title", { platform: PLATFORM_NAMES[platform] })}
          </Text>
          <InlineStack gap="200">
            <Button size="slim" variant="plain" onClick={() => setShowComparison(!showComparison)}>
              {showComparison ? t("eventMapping.hideComparison") : t("eventMapping.showComparison")}
            </Button>
            <Popover
              active={popoverActive}
              activator={
                <Button size="slim" variant="plain" onClick={() => setPopoverActive(!popoverActive)}>
                  {t("eventMapping.mappingTemplate")}
                </Button>
              }
              onClose={() => setPopoverActive(false)}
            >
              <ActionList
                items={[
                  {
                    content: t("eventMapping.recommendedDefault"),
                    onAction: applyRecommended,
                  },
                  {
                    content: t("eventMapping.purchaseEventOnly"),
                    onAction: () => {
                      const purchaseMapping = RECOMMENDED_MAPPINGS[platform];
                      if (purchaseMapping.checkout_completed) {
                        onMappingChange("checkout_completed", purchaseMapping.checkout_completed);
                      }
                    },
                  },
                  {
                    content: t("eventMapping.fullFunnelMapping"),
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
              {t("eventMapping.applyRecommended")}
            </Button>
          </InlineStack>
        </InlineStack>
        {selectedEvents.size > 0 && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("eventMapping.bulkEditMode", { count: selectedEvents.size })}
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Select
                  label={t("eventMapping.bulkMapTo")}
                  labelHidden
                  options={[
                    { label: t("eventMapping.selectPlatformEvent"), value: "" },
                    ...platformEvents.map((event) => ({
                      label: `${event.name} - ${t(event.description)}`,
                      value: event.id,
                    })),
                  ]}
                  value={bulkMappingValue}
                  onChange={setBulkMappingValue}
                />
                <Button size="slim" onClick={applyBulkMapping} disabled={!bulkMappingValue}>
                  {t("eventMapping.apply")}
                </Button>
                <Button size="slim" variant="plain" onClick={clearSelection}>
                  {t("eventMapping.cancelSelection")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("eventMapping.infoDescription", { platform: PLATFORM_NAMES[platform] })}
            </Text>
            <Box paddingBlockStart="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("eventMapping.bestPracticesTitle")}
              </Text>
              <List type="bullet">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("eventMapping.bestPractice1", { target: RECOMMENDED_MAPPINGS[platform].checkout_completed || "purchase" })}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("eventMapping.bestPractice2")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("eventMapping.bestPractice3")}
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
                  {t("eventMapping.comparisonView")}
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={[t("eventMapping.table.shopifyEvent"), t("eventMapping.table.currentMapping"), t("eventMapping.table.recommendedMapping"), t("eventMapping.table.status")]}
                  rows={SHOPIFY_EVENTS.map((shopifyEvent) => {
                    const currentMapping = mappings[shopifyEvent.id] || "";
                    const recommendedMapping = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id] || "";
                    const isRecommended = currentMapping === recommendedMapping;
                    const platformEvent = platformEvents.find(e => e.id === currentMapping);
                    const recommendedPlatformEvent = platformEvents.find(e => e.id === recommendedMapping);
                    return [
                      shopifyEvent.name,
                      currentMapping ? `${platformEvent?.name || currentMapping}` : t("eventMapping.unmapped"),
                      recommendedMapping ? `${recommendedPlatformEvent?.name || recommendedMapping}` : "-",
                      isRecommended ? (
                        <Badge key="rec" tone="success">{t("eventMapping.recommended")}</Badge>
                      ) : currentMapping ? (
                        <Badge key="custom" tone="info">{t("eventMapping.custom")}</Badge>
                      ) : (
                        <Badge key="none" tone="warning">{t("eventMapping.notConfigured")}</Badge>
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
              {t("eventMapping.batchEditHint")}
            </Text>
            <InlineStack gap="200">
              <Button size="slim" variant="plain" onClick={selectAll}>
                {t("eventMapping.selectAll")}
              </Button>
              {selectedEvents.size > 0 && (
                <Button size="slim" variant="plain" onClick={clearSelection}>
                  {t("eventMapping.clearSelection")}
                </Button>
              )}
            </InlineStack>
          </InlineStack>
          {orderedEvents.map((shopifyEvent: ShopifyEvent, index: number) => {
            const currentMapping = mappings[shopifyEvent.id] || "";
            const mappingStatus = currentMapping
              ? getMappingStatus(shopifyEvent.id, currentMapping)
              : null;
            const isSelected = selectedEvents.has(shopifyEvent.id);
            const recommendedMapping = RECOMMENDED_MAPPINGS[platform][shopifyEvent.id] || "";
            const eventPreview = currentMapping ? generateEventPreview(shopifyEvent.id, currentMapping) : null;
            const isPreviewOpen = showPreview[shopifyEvent.id];
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
                      <InlineStack gap="100" blockAlign="center">
                        <ButtonGroup>
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ArrowUpIcon}
                            onClick={() => moveEventUp(shopifyEvent.id)}
                            disabled={index === 0}
                            accessibilityLabel={t("eventMapping.moveUp")}
                          />
                          <Button
                            size="micro"
                            variant="plain"
                            icon={ArrowDownIcon}
                            onClick={() => moveEventDown(shopifyEvent.id)}
                            disabled={index === orderedEvents.length - 1}
                            accessibilityLabel={t("eventMapping.moveDown")}
                          />
                        </ButtonGroup>
                      </InlineStack>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {shopifyEvent.name}
                          </Text>
                        {mappingStatus?.status === "recommended" && (
                          <Badge tone="success">{t("eventMapping.recommended")}</Badge>
                        )}
                        {mappingStatus?.status === "error" && (
                          <Badge tone="critical">{t("eventMapping.error")}</Badge>
                        )}
                        {mappingStatus?.status === "custom" && (
                          <Badge tone="info">{t("eventMapping.custom")}</Badge>
                        )}
                        {showComparison && recommendedMapping && currentMapping !== recommendedMapping && (
                          <Badge tone="warning">
                            {t("eventMapping.recommendedPrefix", { name: platformEvents.find(e => e.id === recommendedMapping)?.name || recommendedMapping })}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t(shopifyEvent.description)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </InlineStack>
                <Box minWidth="100%">
                    <InlineStack gap="200" blockAlign="end">
                      <Box minWidth="300">
                        <Select
                          label={t("eventMapping.mapToPlatformEvent")}
                          options={[
                            { label: t("eventMapping.selectEvent"), value: "" },
                            ...platformEvents.map((event) => ({
                              label: `${event.name} - ${t(event.description)}`,
                              value: event.id,
                            })),
                          ]}
                          value={currentMapping}
                          onChange={(value: string) => onMappingChange(shopifyEvent.id, value)}
                        />
                      </Box>
                      {currentMapping && (
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => togglePreview(shopifyEvent.id)}
                        >
                          {isPreviewOpen ? t("eventMapping.hidePreview") : t("eventMapping.previewEventJson")}
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                  {currentMapping && isPreviewOpen && eventPreview && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {t("eventMapping.platformEventPreview", { platform: PLATFORM_NAMES[platform] })}
                        </Text>
                        <Box
                          padding="300"
                          background="bg-surface"
                          borderRadius="100"
                        >
                          <pre className="tg-event-mapping-preview-json">
                            {JSON.stringify(eventPreview, null, 2)}
                          </pre>
                        </Box>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("eventMapping.previewDescription", { platform: PLATFORM_NAMES[platform] })}
                        </Text>
                        <Divider />
                        <BlockStack gap="200">
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {t("eventMapping.paramMappingDetails")}
                          </Text>
                          <BlockStack gap="100">
                            {(() => {
                              const platformEventDef = platformEvents.find((e) => e.id === currentMapping);
                              if (!platformEventDef) return null;
                              const mappedParams = platformEventDef.requiredParams
                                .concat(platformEventDef.optionalParams)
                                .filter(param => shopifyEvent.availableParams.includes(param));
                              const missingParams = platformEventDef.requiredParams
                                .filter(param => !shopifyEvent.availableParams.includes(param));
                              return (
                                <>
                                  {mappedParams.length > 0 && (
                                    <InlineStack gap="100" wrap>
                                      <Text as="span" variant="bodySm" tone="subdued">{t("eventMapping.mappedParams")}</Text>
                                      {mappedParams.map((param) => (
                                        <Badge key={param} tone="success">{param}</Badge>
                                      ))}
                                    </InlineStack>
                                  )}
                                  {missingParams.length > 0 && (
                                    <InlineStack gap="100" wrap>
                                      <Text as="span" variant="bodySm" tone="subdued">{t("eventMapping.missingParams")}</Text>
                                      {missingParams.map((param) => (
                                        <Badge key={param} tone="warning">{param}</Badge>
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
                          {t("eventMapping.paramMappingPreview")}
                        </Text>
                        <BlockStack gap="200">
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                              {t("eventMapping.shopifyEventParams")}
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
                              {t("eventMapping.mapToArrow")}
                            </Text>
                          </Box>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                              {t("eventMapping.platformEventParams", { platform: PLATFORM_NAMES[platform] })}
                            </Text>
                            <InlineStack gap="100" wrap>
                              {(() => {
                                const platformEventDef = platformEvents.find((e) => e.id === currentMapping);
                                if (!platformEventDef) return null;
                                return (
                                  <>
                                    {platformEventDef.requiredParams.map((param) => (
                                      <Badge key={param} tone="critical">
                                        {t("eventMapping.required", { param })}
                                      </Badge>
                                    ))}
                                    {platformEventDef.optionalParams.map((param) => (
                                      <Badge key={param} tone="info">
                                        {t("eventMapping.optional", { param })}
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
                                    {t("eventMapping.missingParamsWarning", { params: missingParams.join(", ") })}
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
