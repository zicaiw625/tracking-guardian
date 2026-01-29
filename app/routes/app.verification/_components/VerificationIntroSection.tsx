import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  List,
  Layout,
  Button,
} from "@shopify/polaris";
import { ClipboardIcon, ExportIcon } from "~/components/icons";
import { CheckoutExtensibilityWarning } from "~/components/verification/CheckoutExtensibilityWarning";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { TestGuidePanel } from "~/components/verification/TestGuidePanel";
import type { TestChecklist } from "~/services/verification-checklist.server";
import { generateChecklistMarkdown, generateChecklistCSV } from "~/utils/verification-checklist";

export interface VerificationIntroSectionProps {
  testGuide: { steps: Array<{ step: number; title: string; description: string }>; tips: string[]; estimatedTime: string };
  configuredPlatforms: string[];
  copyTestGuide: () => void;
  guideExpanded: boolean;
  onGuideExpandedChange: (expanded: boolean) => void;
  testChecklist: (Omit<TestChecklist, "generatedAt"> & { generatedAt: string | Date }) | null;
  showSuccess: (msg: string) => void;
  latestRun: { runId: string } | null;
  canExportReports: boolean;
  currentPlan: string | null;
}

export function VerificationIntroSection({
  testGuide,
  configuredPlatforms,
  copyTestGuide,
  guideExpanded,
  onGuideExpandedChange,
  testChecklist,
  showSuccess,
  latestRun,
  canExportReports,
  currentPlan,
}: VerificationIntroSectionProps) {
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            📊 验收类型说明
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            PRD 2.5要求：验收分为两类，请根据您的需求选择相应的验收方式。
          </Text>
          <Layout>
            <Layout.Section variant="oneHalf">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">
                      🎯 像素层验收
                    </Text>
                    <Badge tone="success">所有套餐可用</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    <strong>验收范围：</strong>Web Pixels 标准事件
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">事件触发次数</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">payload 参数完整率（value/currency/items）</Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">checkout_completed 的金额/币种一致性</Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>支持的事件：</strong>checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等
                  </Text>
                </BlockStack>
              </Box>
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200" />
            </Layout.Section>
          </Layout>
        </BlockStack>
      </Card>
      <Banner title="⚠️ v1.0 验收范围说明（重要）" tone="warning">
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            <strong>v1.0 版本仅支持 checkout/purchase 漏斗事件验收</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>✅ 支持的事件类型：</strong>checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等 Web Pixels 标准 checkout 漏斗事件
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>❌ 不支持的事件类型：</strong>退款（refund）、订单取消（cancel）、订单编辑（order_edit）、订阅订单（subscription）等事件在 v1.0 中不可验收
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>补充：</strong>Web Pixels 仅覆盖 checkout 漏斗，订单层事件（refund/cancel）需通过订单 webhook 才能验收。
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>原因：</strong>Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单 webhooks 实现（严格做 PII 最小化）
              </Text>
            </List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            <strong>注意：</strong>v1.0 验收范围与 Web Pixel Extension 的能力范围一致，符合隐私最小化原则。
          </Text>
        </BlockStack>
      </Banner>
      <Banner tone="info" title="重要说明：验收范围与平台归因">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            <strong>本应用验收侧重于事件触发与数据质量，不保证平台侧归因一致。</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>我们提供：</strong>像素事件触发记录、参数完整率、订单金额/币种一致性等验收证据。
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制等。
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm">
                <strong>验收报告说明：</strong>如果验收显示“通过”，表示像素事件在本应用的接收与校验链路中表现正常；平台侧归因可能仍存在差异，这是正常现象。
              </Text>
            </List.Item>
          </List>
        </BlockStack>
      </Banner>
      <CheckoutExtensibilityWarning />
      {latestRun && !canExportReports && (
        <Banner
          title="📄 生成验收报告（CSV）- 核心付费点"
          tone="warning"
          action={{ content: "升级到 Growth 套餐（$79/月）", url: "/app/billing?upgrade=growth" }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              需要 <strong>Growth 成长版</strong> ($79/月) 或 <strong>Agency 版</strong> ($199/月) 套餐。
            </Text>
            <Text as="p" variant="bodySm">
              报告包含：测试清单 + 事件触发记录 + 参数完整率 + 订单金额/币种一致性 + 隐私合规检查（consent/customerPrivacy）
            </Text>
            <Text as="p" variant="bodySm">
              这是项目的核心交付件，适合 Agency 直接报给客户的验收报告。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              当前套餐：<strong>{currentPlan === "free" ? "免费版" : currentPlan === "starter" ? "Migration 迁移版" : currentPlan}</strong>
            </Text>
          </BlockStack>
        </Banner>
      )}
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">📋 v1.0 验收范围说明</Text>
          <Text as="p" variant="bodySm"><strong>v1.0 版本验收范围：</strong></Text>
          <List type="bullet">
            <List.Item>✅ <strong>Checkout/Purchase 漏斗事件</strong>：checkout_started, checkout_completed, product_added_to_cart, product_viewed, page_viewed 等</List.Item>
            <List.Item>❌ <strong>退款、取消、编辑订单、订阅事件</strong>：这些事件类型将在 v1.1+ 版本中通过订单 webhooks 实现</List.Item>
          </List>
          <Text as="p" variant="bodySm" tone="subdued">
            <strong>原因：</strong>Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，v1.0 版本仅依赖 Web Pixel Extension，不处理订单相关 webhooks（符合隐私最小化原则）。
          </Text>
        </BlockStack>
      </Banner>
      <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
      <TestGuidePanel
        testGuide={testGuide}
        configuredPlatforms={configuredPlatforms}
        onCopyGuide={copyTestGuide}
        guideExpanded={guideExpanded}
        onGuideExpandedChange={onGuideExpandedChange}
      />
      {testChecklist && testChecklist.items.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">📝 详细测试清单</Text>
              <InlineStack gap="200">
                <Button
                  icon={ClipboardIcon}
                  size="slim"
                  onClick={() => {
                    const checklist: TestChecklist = { ...testChecklist, generatedAt: new Date(testChecklist.generatedAt) };
                    const markdown = generateChecklistMarkdown(checklist);
                    navigator.clipboard.writeText(markdown);
                    showSuccess("测试清单已复制到剪贴板");
                  }}
                >
                  复制清单
                </Button>
                <Button
                  icon={ExportIcon}
                  size="slim"
                  onClick={() => {
                    const checklist: TestChecklist = { ...testChecklist, generatedAt: new Date(testChecklist.generatedAt) };
                    const csv = generateChecklistCSV(checklist);
                    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `test-checklist-${new Date().toISOString().split("T")[0]}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showSuccess("测试清单已导出");
                  }}
                >
                  导出 CSV
                </Button>
              </InlineStack>
            </InlineStack>
            <BlockStack gap="200">
              <InlineStack gap="300" wrap>
                <Badge tone="info">{`${String(testChecklist.requiredItemsCount)} 项必需`}</Badge>
                <Badge>{`${String(testChecklist.optionalItemsCount)} 项可选`}</Badge>
                <Badge tone="success">{`预计 ${String(Math.floor(testChecklist.totalEstimatedTime / 60))} 小时 ${String(testChecklist.totalEstimatedTime % 60)} 分钟`}</Badge>
              </InlineStack>
            </BlockStack>
            <BlockStack gap="300">
              {testChecklist.items.map((item) => (
                <Box key={item.id} background={item.required ? "bg-fill-warning-secondary" : "bg-surface-secondary"} padding="400" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">{item.required ? "✅" : "⚪"} {item.name}</Text>
                          <Badge tone={item.required ? "warning" : "info"}>{item.required ? "必需" : "可选"}</Badge>
                          <Badge>{item.category}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">{item.description}</Text>
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">平台: {item.platforms.join(", ")}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">• 预计 {item.estimatedTime} 分钟</Text>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">操作步骤</Text>
                      <List type="number">
                        {item.steps.map((step, i) => (
                          <List.Item key={i}>
                            <Text as="span" variant="bodySm">{step.replace(/^\d+\.\s*/, "")}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingSm">预期结果</Text>
                      <List>
                        {item.expectedResults.map((result, i) => (
                          <List.Item key={i}>
                            <Text as="span" variant="bodySm">{result}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
      <Banner tone="info" title="重要说明：验收范围与平台归因">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            <strong>本应用验收侧重于事件触发与数据质量，不保证平台侧归因一致。</strong>
          </Text>
          <List type="bullet">
            <List.Item>
              <Text as="span" variant="bodySm"><strong>我们提供：</strong>像素事件触发记录、参数完整率、订单金额/币种一致性等验收证据。</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、平台数据去重和合并规则等。</Text>
            </List.Item>
            <List.Item>
              <Text as="span" variant="bodySm"><strong>验证方法：</strong>您可以通过本应用的验收报告查看事件触发与数据质量，或使用平台提供的工具验证事件接收情况。</Text>
            </List.Item>
          </List>
        </BlockStack>
      </Banner>
    </>
  );
}
