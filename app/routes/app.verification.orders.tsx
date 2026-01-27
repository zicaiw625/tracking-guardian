import {
  Page,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  List,
} from "@shopify/polaris";

export default function VerificationOrdersPage() {
  return (
    <Page title="功能即将推出">
      <BlockStack gap="400">
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              此功能将在后续版本中提供
            </Text>
            <Text as="p" variant="bodySm">
              订单层验收功能正在开发中，将在未来版本中推出。当前版本专注于像素事件验收和诊断。
            </Text>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              当前可用功能
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  像素事件验收：验证 Web Pixel 事件是否正确触发和发送
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  实时事件监控：查看实时像素事件流
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  事件诊断：分析事件参数完整性和发送状态
                </Text>
              </List.Item>
            </List>
            <Button url="/app/verification" variant="primary">
              返回验收页面
            </Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
