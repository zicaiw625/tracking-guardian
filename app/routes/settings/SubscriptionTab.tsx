// Subscription settings tab component
import { 
    Layout, 
    Card, 
    Text, 
    BlockStack, 
    InlineStack, 
    Divider, 
    Banner, 
    Badge, 
    Box 
} from "@shopify/polaris";

export function SubscriptionTab() {
    return (
        <Layout>
            <Layout.Section>
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between">
                            <Text as="h2" variant="headingMd">
                                当前计划
                            </Text>
                            <Badge tone="success">免费版</Badge>
                        </InlineStack>

                        <Banner tone="info">
                            <p>
                                感谢使用 Tracking Guardian！目前所有功能完全免费开放。
                                付费套餐即将推出，届时将提供更高的使用限额和高级功能。
                            </p>
                        </Banner>

                        <Divider />

                        <BlockStack gap="400">
                            <Box background="bg-surface-selected" padding="400" borderRadius="200">
                                <BlockStack gap="300">
                                    <InlineStack align="space-between">
                                        <Text as="h3" variant="headingMd">
                                            免费版
                                        </Text>
                                        <Badge tone="success">当前计划</Badge>
                                    </InlineStack>
                                    <Text as="p" tone="subdued">
                                        • 无限扫描报告
                                        <br />• 所有平台集成（Google、Meta、TikTok）
                                        <br />• 服务端转化追踪（CAPI）
                                        <br />• 邮件 + Slack + Telegram 警报
                                        <br />• 每日健康监控
                                    </Text>
                                </BlockStack>
                            </Box>

                            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                                <BlockStack gap="300">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <InlineStack gap="200" blockAlign="center">
                                            <Text as="h3" variant="headingMd" tone="subdued">
                                                高级套餐
                                            </Text>
                                            <Badge>即将推出</Badge>
                                        </InlineStack>
                                    </InlineStack>
                                    <Text as="p" tone="subdued">
                                        • 更高的月度订单限额
                                        <br />• 更长的数据保留期
                                        <br />• 优先技术支持
                                        <br />• 高级对账报告
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                        付费套餐即将推出，敬请期待。当前所有功能免费使用。
                                    </Text>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    </BlockStack>
                </Card>
            </Layout.Section>
        </Layout>
    );
}

