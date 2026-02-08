import { Card, BlockStack, Text, Banner, List, Divider } from "@shopify/polaris";
import { EventMappingEditor } from "~/components/migrate/EventMappingEditor";
import type { SupportedPlatform, PlatformConfig } from "../constants";

interface MappingsStepProps {
  selectedPlatforms: Set<SupportedPlatform>;
  platformConfigs: Partial<Record<SupportedPlatform, PlatformConfig>>;
  onEventMappingUpdate: (platform: SupportedPlatform, shopifyEvent: string, platformEvent: string) => void;
}

export function MappingsStep({ selectedPlatforms, platformConfigs, onEventMappingUpdate }: MappingsStepProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          配置事件映射
        </Text>
        <Text as="p" tone="subdued">
          将 Shopify 事件映射到各平台事件。您可以基于推荐映射进行调整。
        </Text>
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
            </Text>
            <Text as="p" variant="bodySm">
              Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法访问 DOM 元素
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法使用 localStorage/sessionStorage
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法访问第三方 cookie
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法执行某些浏览器 API
                </Text>
              </List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              v1.0 支持的事件类型：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ checkout_started（开始结账）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ checkout_completed（完成购买）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ checkout_contact_info_submitted（提交联系信息）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ checkout_shipping_info_submitted（提交配送信息）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ payment_info_submitted（提交支付信息）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ product_added_to_cart（加入购物车）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ product_viewed（商品浏览）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  ✅ page_viewed（页面浏览）
                </Text>
              </List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
              ❌ v1.0 不支持的事件类型（需要通过订单 webhooks 获取）：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  refund（退款）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  order_cancelled（订单取消）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  order_edited（订单编辑）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  subscription_updated（订阅更新）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  subscription_cancelled（订阅取消）
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 原因：Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout
              漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+
              版本中通过订单 webhooks 实现（严格做 PII 最小化）。
            </Text>
          </BlockStack>
        </Banner>
        {Array.from(selectedPlatforms).map((platform) => {
          const config = platformConfigs[platform];
          if (!config) return null;
          return (
            <EventMappingEditor
              key={platform}
              platform={platform as "google" | "meta" | "tiktok"}
              mappings={config.eventMappings}
              onMappingChange={(shopifyEvent, platformEvent) =>
                onEventMappingUpdate(platform, shopifyEvent, platformEvent)
              }
            />
          );
        })}
      </BlockStack>
    </Card>
  );
}
