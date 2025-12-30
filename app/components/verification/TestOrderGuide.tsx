
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
  Icon,
  Collapsible,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ClipboardIcon,
  InfoIcon,
} from "../icons";
import { useState, useCallback } from "react";

export interface TestOrderGuideProps {
  shopDomain: string;
  testItems: Array<{
    id: string;
    name: string;
    description: string;
    steps: string[];
    expectedEvents: string[];
  }>;
}

export function TestOrderGuide({ shopDomain, testItems }: TestOrderGuideProps) {
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const handleCopy = useCallback(async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemId);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }, []);

  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const testStoreUrl = `https://${shopDomain}`;
  const testCheckoutUrl = `${testStoreUrl}/checkout/test`;

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            📋 测试订单指引
          </Text>
          <Text as="p" tone="subdued">
            按照以下步骤创建测试订单，验证像素追踪是否正常工作。
          </Text>
        </BlockStack>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              快速开始
            </Text>
            <List type="bullet">
              <List.Item>
                在 Shopify 后台启用测试模式（Settings → Checkout → Test mode）
              </List.Item>
              <List.Item>
                使用测试支付方式（Bogus Gateway）完成订单
              </List.Item>
              <List.Item>
                在实时监控中查看事件触发情况
              </List.Item>
            </List>
          </BlockStack>
        </Banner>

        <Divider />

        <BlockStack gap="400">
          {testItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            const isCopied = copiedItem === item.id;

            return (
              <Card key={item.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {item.name}
                        </Text>
                        <Badge tone="info">测试场景</Badge>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      variant="plain"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      {isExpanded ? "收起" : "展开"}
                    </Button>
                  </InlineStack>

                  <Collapsible
                    open={isExpanded}
                    id={`test-item-${item.id}`}
                    transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                  >
                    <BlockStack gap="300">
                      <Divider />
                      
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            操作步骤
                          </Text>
                          <Button
                            size="slim"
                            variant="plain"
                            icon={ClipboardIcon}
                            onClick={() => {
                              const stepsText = item.steps.map((step, idx) => `${idx + 1}. ${step}`).join("\n");
                              handleCopy(stepsText, `${item.id}-steps`);
                            }}
                          >
                            复制所有步骤
                          </Button>
                        </InlineStack>
                        <List type="number">
                          {item.steps.map((step, idx) => (
                            <List.Item key={idx}>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span">{step}</Text>
                                <Button
                                  size="micro"
                                  variant="plain"
                                  icon={ClipboardIcon}
                                  onClick={() => handleCopy(step, `${item.id}-step-${idx}`)}
                                >
                                  复制
                                </Button>
                              </InlineStack>
                            </List.Item>
                          ))}
                        </List>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          预期事件
                        </Text>
                        <InlineStack gap="100" wrap>
                          {item.expectedEvents.map((event) => (
                            <Badge key={event} tone="success">
                              {event}
                            </Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>

                      <Box
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              测试店铺链接
                            </Text>
                            <Button
                              size="slim"
                              variant="plain"
                              icon={isCopied ? CheckCircleIcon : ClipboardIcon}
                              onClick={() => handleCopy(testStoreUrl, item.id)}
                            >
                              {isCopied ? "已复制" : "复制链接"}
                            </Button>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {testStoreUrl}
                          </Text>
                        </BlockStack>
                      </Box>
                    </BlockStack>
                  </Collapsible>
                </BlockStack>
              </Card>
            );
          })}
        </BlockStack>

        <Divider />

        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              ⚠️ 注意事项
            </Text>
            <List type="bullet">
              <List.Item>
                测试订单不会产生实际费用，但会触发真实的像素事件
              </List.Item>
              <List.Item>
                建议在测试环境中完成所有验证，再切换到生产模式
              </List.Item>
              <List.Item>
                如果事件未触发，请检查像素配置和网络连接
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}

