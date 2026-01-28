import { Banner, BlockStack, Text } from "@shopify/polaris";

export function ScriptTagMigrationBanner({
  scriptTagsCount,
  hasOrderStatusScripts,
}: {
  scriptTagsCount: number;
  hasOrderStatusScripts: boolean;
}) {
  if (scriptTagsCount === 0) return null;
  return (
    <Banner
      title={`检测到 ${scriptTagsCount} 个 ScriptTag 需要迁移`}
      tone="critical"
      action={{ content: "查看迁移方案", url: "/app/migrate" }}
      secondaryAction={{ content: "查看扫描详情", url: "/app/scan?tab=2" }}
    >
      <BlockStack gap="300">
        {hasOrderStatusScripts && (
          <Text as="p">
            ⚠️ 检测到 <strong>订单状态页 ScriptTag</strong>，这是 Shopify 废弃公告的主要目标。
            请尽快迁移到 Web Pixel 以避免追踪中断。
          </Text>
        )}
        <BlockStack gap="100">
          <Text as="p" fontWeight="semibold">
            推荐迁移步骤：
          </Text>
          <Text as="p" variant="bodySm">
            1. 在「迁移」页面启用 Tracking Guardian Web Pixel
          </Text>
          <Text as="p" variant="bodySm">
            2. 完成测试订单并在「验收」页面确认事件收据与参数完整率
          </Text>
          <Text as="p" variant="bodySm">
            3. 在 Shopify 后台手动删除旧的 ScriptTag
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            （前往「设置 → 应用和销售渠道」找到创建 ScriptTag 的应用并卸载）
          </Text>
        </BlockStack>
      </BlockStack>
    </Banner>
  );
}
