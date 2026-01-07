import { Page, Card, Text, BlockStack, InlineStack, Button, Banner, List } from "@shopify/polaris";

export default function AuditStartPage() {
  return (
    <Page title="Audit 扫描入口" subtitle="引导说明 • 扫描耗时提示 • 一键开始扫描">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              开始 Audit 扫描
            </Text>
            <Text as="p" tone="subdued">
              自动扫描将检查 ScriptTag 与 Web Pixel，并生成迁移清单与风险分级。Additional Scripts 与 checkout.liquid
              需要在下一步手动补充，确保 Thank you / Order status 页面完整覆盖。
            </Text>
            <InlineStack gap="200" wrap>
              <Button variant="primary" url="/app/audit/scan">
                开始扫描
              </Button>
              <Button url="/app/audit/manual">
                先补充 Additional Scripts
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Banner tone="info" title="预计耗时">
          <BlockStack gap="200">
            <Text as="p">中等体量店铺约 1-3 分钟完成扫描，大型店铺可能需要更久。</Text>
            <Text as="p" tone="subdued">
              若 API 分页数量过多，扫描将停止并提示，请在手动补充中粘贴剩余脚本内容。
            </Text>
          </BlockStack>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              扫描范围说明
            </Text>
            <List type="bullet">
              <List.Item>自动扫描：ScriptTag、Web Pixel、已识别的平台信号</List.Item>
              <List.Item>手动补充：Additional Scripts、Checkout 自定义代码</List.Item>
              <List.Item>报告输出：迁移清单、风险等级、推荐路径与工时</List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
