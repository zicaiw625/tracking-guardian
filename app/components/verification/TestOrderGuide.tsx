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
  Collapsible,
} from "@shopify/polaris";
import { CheckCircleIcon, ClipboardIcon, RefreshIcon } from "../icons";
import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { CheckoutCompletedBehaviorHint } from "./CheckoutCompletedBehaviorHint";

export interface TestOrderGuideProps {
  shopDomain: string;
  shopId: string;
  testItems: Array<{
    id: string;
    name: string;
    description: string;
    steps: string[];
    expectedEvents: string[];
    eventType?: string;
    category?: string;
  }>;
  onTestComplete?: (itemId: string, verified: boolean) => void;
}

export function TestOrderGuide({ shopDomain, shopId: _shopId, testItems, onTestComplete }: TestOrderGuideProps) {
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [testStatuses, setTestStatuses] = useState<Record<string, "pending" | "verifying" | "verified" | "failed">>({});
  const [verificationResults, setVerificationResults] = useState<
    Record<
      string,
      {
        verified: boolean;
        eventsFound: number;
        expectedEvents: number;
        missingEvents: string[];
        errors?: string[];
      }
    >
  >({});
  const fetcher = useFetcher();
  const handleCopy = useCallback(async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(itemId);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      const { debugError } = await import("../../utils/debug-log.client");
      debugError("Failed to copy:", error);
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
  const handleVerifyTest = useCallback(
    (itemId: string) => {
      const item = testItems.find((i) => i.id === itemId);
      if (!item) return;
      setTestStatuses((prev) => ({ ...prev, [itemId]: "verifying" }));
      const formData = new FormData();
      formData.append("_action", "verifyTestItem");
      formData.append("itemId", itemId);
      formData.append("eventType", item.eventType || "purchase");
      formData.append("expectedEvents", JSON.stringify(item.expectedEvents));
      fetcher.submit(formData, { method: "post" });
    },
    [testItems, fetcher]
  );
  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean; itemId?: string }).success) {
      const data = fetcher.data as {
        itemId: string;
        verified: boolean;
        eventsFound: number;
        expectedEvents: number;
        missingEvents: string[];
        errors?: string[];
      };
      setTestStatuses((prev) => ({
        ...prev,
        [data.itemId]: data.verified ? "verified" : "failed",
      }));
      setVerificationResults((prev) => ({
        ...prev,
        [data.itemId]: {
          verified: data.verified,
          eventsFound: data.eventsFound,
          expectedEvents: data.expectedEvents,
          missingEvents: data.missingEvents,
          errors: data.errors,
        },
      }));
      if (onTestComplete) {
        onTestComplete(data.itemId, data.verified);
      }
    }
  }, [fetcher.data, onTestComplete]);
  const testStoreUrl = `https://${shopDomain}`;
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
              快速开始（PRD 2.5: 对齐 Shopify 官方测试路径）
            </Text>
            <List type="bullet">
              <List.Item>在 Shopify 后台启用测试模式（Settings → Checkout → Test mode）</List.Item>
              <List.Item>使用测试支付方式（Bogus Gateway）完成订单</List.Item>
              <List.Item>在实时监控中查看事件触发情况</List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>参考 Shopify 官方文档：</strong>
              <br />•{" "}
              <a
                href="https://help.shopify.com/en/manual/checkout-settings/test-checkout"
                target="_blank"
                rel="noopener noreferrer"
              >
                测试结账流程
              </a>
              <br />•{" "}
              <a
                href="https://help.shopify.com/en/manual/online-store/themes/customizing-themes/checkout-extensibility/web-pixels-api/test-custom-pixels"
                target="_blank"
                rel="noopener noreferrer"
              >
                测试自定义像素
              </a>
            </Text>
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
                    <Button size="slim" variant="plain" onClick={() => toggleExpanded(item.id)}>
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
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            预期事件
                          </Text>
                          <Button
                            size="slim"
                            variant="secondary"
                            icon={RefreshIcon}
                            onClick={() => handleVerifyTest(item.id)}
                            loading={testStatuses[item.id] === "verifying"}
                            disabled={testStatuses[item.id] === "verifying"}
                          >
                            {testStatuses[item.id] === "verifying"
                              ? "验证中..."
                              : testStatuses[item.id] === "verified"
                                ? "已验证"
                                : testStatuses[item.id] === "failed"
                                  ? "验证失败"
                                  : "自动验证"}
                          </Button>
                        </InlineStack>
                        <InlineStack gap="100" wrap>
                          {item.expectedEvents.map((event) => {
                            const result = verificationResults[item.id];
                            const isFound = result?.missingEvents ? !result.missingEvents.includes(event) : undefined;
                            return (
                              <Badge
                                key={event}
                                tone={isFound === true ? "success" : isFound === false ? "critical" : "info"}
                              >
                                {`${event}${isFound === true ? " ✓" : isFound === false ? " ✗" : ""}`}
                              </Badge>
                            );
                          })}
                        </InlineStack>
                        {verificationResults[item.id] && (
                          <Box
                            background={
                              verificationResults[item.id].verified ? "bg-surface-success" : "bg-surface-critical"
                            }
                            padding="300"
                            borderRadius="200"
                          >
                            <BlockStack gap="200">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  验证结果
                                </Text>
                                <Badge tone={verificationResults[item.id].verified ? "success" : "critical"}>
                                  {verificationResults[item.id].verified ? "通过" : "未通过"}
                                </Badge>
                              </InlineStack>
                              <Text as="span" variant="bodySm">
                                找到 {verificationResults[item.id].eventsFound} /{" "}
                                {verificationResults[item.id].expectedEvents} 个预期事件
                              </Text>
                              {verificationResults[item.id].missingEvents.length > 0 && (
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    缺失事件：
                                  </Text>
                                  <List type="bullet">
                                    {verificationResults[item.id].missingEvents.map((event, idx) => (
                                      <List.Item key={idx}>{event}</List.Item>
                                    ))}
                                  </List>
                                  {verificationResults[item.id].missingEvents.some(
                                    (e) =>
                                      e.toLowerCase().includes("checkout_completed") ||
                                      e.toLowerCase().includes("purchase")
                                  ) && <CheckoutCompletedBehaviorHint mode="missing" collapsible={true} />}
                                </BlockStack>
                              )}
                              {verificationResults[item.id].errors &&
                                verificationResults[item.id].errors!.length > 0 && (
                                  <BlockStack gap="200">
                                    <Banner tone="critical">
                                      <List type="bullet">
                                        {verificationResults[item.id].errors!.map((err, idx) => (
                                          <List.Item key={idx}>{err}</List.Item>
                                        ))}
                                      </List>
                                    </Banner>
                                    {verificationResults[item.id].missingEvents.some(
                                      (e) =>
                                        e.toLowerCase().includes("checkout_completed") ||
                                        e.toLowerCase().includes("purchase")
                                    ) && <CheckoutCompletedBehaviorHint mode="missing" collapsible={true} />}
                                  </BlockStack>
                                )}
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
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
              <List.Item>测试订单不会产生实际费用，但会触发真实的像素事件</List.Item>
              <List.Item>建议在测试环境中完成所有验证，再切换到生产模式</List.Item>
              <List.Item>如果事件未触发，请检查像素配置和网络连接</List.Item>
            </List>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}
