import { useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Tabs,
  Box,
  Badge,
  Button,
  Icon,
} from "@shopify/polaris";
import { CopyIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import type { PixelEventPayload } from "~/routes/api.pixel-events/types";

interface CanonicalEventData {
  event_name: string;
  event_id: string;
  timestamp: number;
  value: number;
  currency: string;
  items: Array<{
    item_id: string;
    item_name: string;
  }>;
  order_id?: string;
  checkout_token?: string;
  [key: string]: unknown;
}

interface PlatformEventData {
  event_name: string;
  event_id: string;
  parameters: Record<string, unknown>;
}

export interface PayloadVisualizerProps {
  payload: PixelEventPayload;
  shopDomain: string;
  platforms?: string[];
}

export function PayloadVisualizer({
  payload,
  shopDomain,
  platforms = ["google", "meta", "tiktok"],
}: PayloadVisualizerProps) {
  const { showSuccess } = useToastContext();
  const [selectedTab, setSelectedTab] = useState(0);
  const canonical = normalizeEventClient(payload, shopDomain);
  const platformMappings: Record<string, PlatformEventData> = {};
  for (const platform of platforms) {
    try {
      platformMappings[platform] = mapToPlatformClient(canonical, platform);
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error(`Failed to map to ${platform}:`, error);
      }
    }
  }
  const tabs = [
    { id: "canonical", content: "规范化格式 (Canonical)" },
    ...platforms.map((p) => ({
      id: p,
      content: getPlatformDisplayName(p),
    })),
  ];
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showSuccess("已复制到剪贴板");
  };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            事件 Payload 可视化
          </Text>
          <Badge tone="info">P1-01: 规范化映射</Badge>
        </InlineStack>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 && (
            <Box paddingBlockStart="400">
              <CanonicalView
                canonical={canonical}
                onCopy={() => copyToClipboard(JSON.stringify(canonical, null, 2))}
              />
            </Box>
          )}
          {platforms.map((platform, index) => {
            if (selectedTab === index + 1) {
              const mapping = platformMappings[platform];
              if (!mapping) {
                return (
                  <Box paddingBlockStart="400">
                    <Text as="p" tone="subdued">
                      无法映射到 {getPlatformDisplayName(platform)}
                    </Text>
                  </Box>
                );
              }
              return (
                <Box key={platform} paddingBlockStart="400">
                  <PlatformView
                    platform={platform}
                    mapping={mapping}
                    onCopy={() => copyToClipboard(JSON.stringify(mapping, null, 2))}
                  />
                </Box>
              );
            }
            return null;
          })}
        </Tabs>
      </BlockStack>
    </Card>
  );
}

function CanonicalView({
  canonical,
  onCopy,
}: {
  canonical: CanonicalEventData;
  onCopy: () => void;
}) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h4" variant="headingSm">
          规范化格式（内部标准）
        </Text>
        <Button icon={CopyIcon} onClick={onCopy} size="slim">
          复制
        </Button>
      </InlineStack>
      <Box
        padding="300"
        background="bg-surface-secondary"
        borderRadius="200"
      >
        <div style={{ maxHeight: "500px", overflow: "auto" }}>
        <pre
          style={{
            fontSize: "12px",
            fontFamily: "monospace",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(canonical, null, 2)}
        </pre>
        </div>
      </Box>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>Event ID 生成规则：</strong>{" "}
          {canonical.order_id || canonical.checkout_token
            ? `(${canonical.order_id || canonical.checkout_token}) + ${canonical.event_name} + line_hash`
            : "session_id + event_name + line_hash"}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>Items 数量：</strong> {canonical.items.length}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>总价值：</strong> {canonical.value} {canonical.currency}
        </Text>
      </BlockStack>
    </BlockStack>
  );
}

function PlatformView({
  platform,
  mapping,
  onCopy,
}: {
  platform: string;
  mapping: PlatformEventData;
  onCopy: () => void;
}) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h4" variant="headingSm">
          {getPlatformDisplayName(platform)} 格式
        </Text>
        <Button icon={CopyIcon} onClick={onCopy} size="slim">
          复制
        </Button>
      </InlineStack>
      <Box
        padding="300"
        background="bg-surface-secondary"
        borderRadius="200"
      >
        <div style={{ maxHeight: "500px", overflow: "auto" }}>
        <pre
          style={{
            fontSize: "12px",
            fontFamily: "monospace",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(mapping, null, 2)}
        </pre>
        </div>
      </Box>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>事件名称：</strong> {mapping.event_name}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>Event ID：</strong> {mapping.event_id}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>参数数量：</strong> {Object.keys(mapping.parameters).length}
        </Text>
      </BlockStack>
    </BlockStack>
  );
}

function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    google: "GA4",
    ga4: "GA4",
    meta: "Meta (Facebook)",
    facebook: "Meta (Facebook)",
    fb: "Meta (Facebook)",
    tiktok: "TikTok",
    tt: "TikTok",
  };
  return names[platform.toLowerCase()] || platform.toUpperCase();
}

function normalizeEventClient(
  payload: PixelEventPayload,
  shopDomain: string
): CanonicalEventData {
  const data = payload.data || {};
  const items = Array.isArray(data.items)
    ? data.items.map((item: unknown) => {
        const itemObj = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          item_id: String(itemObj.id || itemObj.item_id || itemObj.variant_id || itemObj.sku || ""),
          item_name: String(itemObj.name || itemObj.item_name || itemObj.title || "Unknown"),
        };
      })
    : [];
  const identifier = data.orderId || data.checkoutToken || `session_${Date.now()}`;
  const eventId = `${shopDomain}:${identifier}:${payload.eventName}`.substring(0, 32);
  return {
    event_name: payload.eventName,
    event_id: eventId,
    timestamp: payload.timestamp,
    value: typeof data.value === "number" ? data.value : parseFloat(String(data.value || 0)) || 0,
    currency: (data.currency as string)?.toUpperCase() || "USD",
    items,
    order_id: data.orderId ? String(data.orderId) : undefined,
    checkout_token: data.checkoutToken ? String(data.checkoutToken) : undefined,
  };
}

function mapToPlatformClient(
  canonical: CanonicalEventData,
  platform: string
): PlatformEventData {
  const platformLower = platform.toLowerCase();
  const parameters: Record<string, unknown> = {
    value: canonical.value,
    currency: canonical.currency,
  };
  let eventName = canonical.event_name;
  if (platformLower === "google" || platformLower === "ga4") {
    const eventNameMap: Record<string, string> = {
      checkout_completed: "purchase",
      checkout_started: "begin_checkout",
      product_added_to_cart: "add_to_cart",
      page_viewed: "page_view",
    };
    eventName = eventNameMap[canonical.event_name] || canonical.event_name;
    parameters.transaction_id = canonical.event_id;
    if (canonical.items.length > 0) {
      parameters.items = canonical.items;
    }
  } else if (platformLower === "meta" || platformLower === "facebook" || platformLower === "fb") {
    const eventNameMap: Record<string, string> = {
      checkout_completed: "Purchase",
      checkout_started: "InitiateCheckout",
      product_added_to_cart: "AddToCart",
      page_viewed: "ViewContent",
    };
    eventName = eventNameMap[canonical.event_name] || canonical.event_name;
    if (canonical.items.length > 0) {
      parameters.content_ids = canonical.items.map((item) => item.item_id);
      parameters.contents = canonical.items.map((item) => ({
        id: item.item_id,
        quantity: 1,
        item_price: canonical.value / canonical.items.length,
      }));
    }
  } else if (platformLower === "tiktok" || platformLower === "tt") {
    const eventNameMap: Record<string, string> = {
      checkout_completed: "CompletePayment",
      checkout_started: "InitiateCheckout",
      product_added_to_cart: "AddToCart",
      page_viewed: "ViewContent",
    };
    eventName = eventNameMap[canonical.event_name] || canonical.event_name;
    if (canonical.items.length > 0) {
      parameters.contents = canonical.items.map((item) => ({
        content_id: item.item_id,
        content_type: "product",
        price: canonical.value / canonical.items.length,
        quantity: 1,
      }));
    }
  }
  return {
    event_name: eventName,
    event_id: canonical.event_id,
    parameters,
  };
}
