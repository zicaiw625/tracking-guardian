import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  List,
  Badge,
  Box,
  Divider,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, PlayIcon, ClipboardIcon } from "~/components/icons";
import type { TestChecklist } from "~/services/verification-checklist.server";
import { CheckoutCompletedBehaviorHint } from "./CheckoutCompletedBehaviorHint";

export interface VerificationWizardProps {
  shopId: string;
  testChecklist: TestChecklist;
  onStartTest?: () => void;
  onComplete?: () => void;
}

export function VerificationWizard({
  shopId,
  testChecklist,
  onStartTest,
  onComplete,
}: VerificationWizardProps) {
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const [currentStep, setCurrentStep] = useState<number>(0);
  const handleItemComplete = useCallback((itemId: string) => {
    setCompletedItems((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }, []);
  const progress = testChecklist.items.length > 0
    ? (completedItems.size / testChecklist.items.length) * 100
    : 0;
  const allCompleted = completedItems.size === testChecklist.items.length;
  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">
              验收测试向导
            </Text>
            <Badge tone={allCompleted ? "success" : "info"}>
              {`${completedItems.size} / ${testChecklist.items.length}`}
            </Badge>
          </InlineStack>
          <Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd" as="span">
                  完成进度
                </Text>
                <Text variant="headingSm" as="span">
                  {Math.round(progress)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={progress} size="small" />
            </BlockStack>
          </Box>
          <Divider />
          <Banner tone="info" title="重要提示：v1.0 验收范围（符合 PRD 4.5 要求）">
            <BlockStack gap="200">
              <Text variant="bodySm" as="p">
                <strong>v1.0 验收范围：</strong>v1.0 版本仅支持 checkout/purchase 漏斗事件的验收，包括：
              </Text>
              <List type="bullet">
                <List.Item>✅ checkout_started（开始结账）</List.Item>
                <List.Item>✅ checkout_completed（完成购买）</List.Item>
                <List.Item>✅ checkout_contact_info_submitted（提交联系信息）</List.Item>
                <List.Item>✅ checkout_shipping_info_submitted（提交配送信息）</List.Item>
                <List.Item>✅ payment_info_submitted（提交支付信息）</List.Item>
                <List.Item>✅ product_added_to_cart（加入购物车）</List.Item>
                <List.Item>✅ product_viewed（商品浏览）</List.Item>
                <List.Item>✅ page_viewed（页面浏览）</List.Item>
              </List>
              <Text variant="bodySm" as="p" tone="critical">
                <strong>⚠️ v1.0 不支持的事件类型：</strong>退款（refund）、订单取消（cancel）、订单编辑（order_edit）、订阅（subscription）等事件在 v1.0 中不可验收。
              </Text>
              <Text variant="bodySm" as="p">
                <strong>原因：</strong>Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单相关 webhooks（orders/updated, refunds/create 等）实现。
              </Text>
              <Text variant="bodySm" as="p">
                <strong>checkout_completed 事件触发位置：</strong>在有 upsell/post-purchase 时，该事件可能在第一个 upsell 页触发，而不是在 Thank you 页。如果触发页加载失败，则可能完全不触发。
              </Text>
              <Text variant="bodySm" as="p">
                <strong>Web Pixel 隐私与 consent：</strong>在需要 consent 的地区，回调会在 consent 后执行，之前注册的事件会 replay。
              </Text>
            </BlockStack>
          </Banner>
          <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
          <BlockStack gap="300">
            <Text variant="headingSm" as="h3">
              测试清单
            </Text>
            <List>
              {testChecklist.items.map((item, index) => {
                const isCompleted = completedItems.has(item.id);
                return (
                  <List.Item key={item.id}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <InlineStack gap="200" blockAlign="center">
                          {isCompleted ? (
                            <CheckCircleIcon />
                          ) : (
                            <Box minWidth="20px" />
                          )}
                          <Text
                            variant="bodyMd"
                            as="span"
                            fontWeight={isCompleted ? "regular" : "semibold"}
                          >
                            {index + 1}. {item.name}
                          </Text>
                        </InlineStack>
                        {isCompleted && <Badge tone="success">已完成</Badge>}
                      </InlineStack>
                      {item.description && (
                        <Text variant="bodySm" as="span" tone="subdued">
                          {item.description}
                        </Text>
                      )}
                      {item.expectedResults && item.expectedResults.length > 0 && (
                        <Box>
                          <Text variant="bodySm" as="span" fontWeight="semibold">
                            预期结果:
                          </Text>
                          <InlineStack gap="100">
                            {item.expectedResults.map((result) => (
                              <Badge key={result} tone="info">
                                {result}
                              </Badge>
                            ))}
                          </InlineStack>
                        </Box>
                      )}
                      {!isCompleted && (
                        <Button
                          size="slim"
                          onClick={() => handleItemComplete(item.id)}
                        >
                          标记为已完成
                        </Button>
                      )}
                    </BlockStack>
                  </List.Item>
                );
              })}
            </List>
          </BlockStack>
          {allCompleted && (
            <Banner tone="success">
              <BlockStack gap="200">
                <Text variant="bodyMd" as="span" fontWeight="semibold">
                  所有测试项已完成！
                </Text>
                <Text variant="bodySm" as="span">
                  您可以继续查看事件详情或生成验收报告。
                </Text>
              </BlockStack>
            </Banner>
          )}
          <Divider />
          <InlineStack align="end">
            {onStartTest && (
              <Button onClick={onStartTest} icon={PlayIcon}>
                开始测试
              </Button>
            )}
            {allCompleted && onComplete && (
              <Button onClick={onComplete} variant="primary">
                完成验收
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
