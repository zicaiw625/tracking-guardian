
import { Banner, BlockStack, Text, List, Link } from "@shopify/polaris";
import { AlertTriangleIcon } from "~/components/icons";

export function CheckoutExtensibilityWarning() {
  return (
    <Banner tone="warning" icon={AlertTriangleIcon}>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" fontWeight="semibold">
          重要提示：Checkout Extensibility 迁移边界情况
        </Text>

        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            为确保数据不断档，请注意以下边界情况：
          </Text>

          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>旧脚本弃用时间线：</strong> Thank you / Order status 页面的旧方式
                （script tags / additional scripts / checkout.liquid）已被 Checkout Extensibility
                替换，且有明确的关停日期。请确保在关停前完成迁移。
              </Text>
            </List.Item>

            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>checkout_completed 触发位置：</strong> 该事件不一定在 Thank you 页触发。
                当存在 upsell / post-purchase 时，可能在第一个 upsell 页触发，且 Thank you 页不再触发。
                若触发页加载失败则完全不触发。建议使用 server-side webhook（orders/paid）作为兜底。
              </Text>
            </List.Item>

            <List.Item>
              <Text as="span" variant="bodyMd">
                <strong>Web Pixel 隐私与 consent：</strong> 在需要 consent 的地区，回调会在 consent 后执行，
                之前注册的事件会 replay。请确保您的迁移方案能正确处理 consent 状态变化。
              </Text>
            </List.Item>
          </List>

          <Text as="p" variant="bodySm" tone="subdued">
            💡 <strong>建议：</strong> 在验收测试中，请特别关注 upsell 场景和 consent 变化场景，
            并验证 server-side webhook 兜底机制是否正常工作。
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}

export function getCheckoutExtensibilityWarningText(): string {
  return `
重要提示：Checkout Extensibility 迁移边界情况

1. 旧脚本弃用时间线
   Thank you / Order status 页面的旧方式（script tags / additional scripts / checkout.liquid）
   已被 Checkout Extensibility 替换，且有明确的关停日期。

2. checkout_completed 触发位置
   该事件不一定在 Thank you 页触发。当存在 upsell / post-purchase 时，可能在第一个 upsell 页触发，
   且 Thank you 页不再触发。若触发页加载失败则完全不触发。
   建议：使用 server-side webhook（orders/paid）作为兜底。

3. Web Pixel 隐私与 consent
   在需要 consent 的地区，回调会在 consent 后执行，之前注册的事件会 replay。
   请确保迁移方案能正确处理 consent 状态变化。

建议：在验收测试中，请特别关注 upsell 场景和 consent 变化场景。
  `.trim();
}

