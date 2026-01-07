import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  List,
  Divider,
  Badge,
  Box,
} from "@shopify/polaris";
import { ClipboardIcon, CheckCircleIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  generateTestChecklist,
  type TestChecklist,
} from "../services/verification-checklist.server";
import {
  generateChecklistMarkdown,
  generateChecklistCSV,
} from "../utils/verification-checklist";
import { VERIFICATION_TEST_ITEMS } from "../services/verification.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({
      shop: null,
      testChecklist: null,
      testItems: VERIFICATION_TEST_ITEMS,
    });
  }

  const testChecklist = generateTestChecklist(shop.id, "quick");

  return json({
    shop: { id: shop.id, domain: shopDomain },
    testChecklist,
    testItems: VERIFICATION_TEST_ITEMS,
  });
};

export default function VerificationStartPage() {
  const { shop, testChecklist, testItems } = useLoaderData<typeof loader>();

  if (!shop || !testChecklist) {
    return (
      <Page title="验收测试清单">
        <Banner tone="warning">
          <Text as="p">店铺信息未找到，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }

  const handleCopyChecklist = async () => {
    const markdown = generateChecklistMarkdown(testChecklist);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(markdown);
      alert("测试清单已复制到剪贴板");
    }
  };

  const handleDownloadCSV = () => {
    const csv = generateChecklistCSV(testChecklist);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `verification-checklist-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  return (
    <Page
      title="验收测试清单生成"
      subtitle="生成测试清单（可复制）"
      backAction={{ content: "返回验收页面", url: "/app/verification" }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="生成测试清单"
          description="将验收步骤整理为清单，便于测试与交付。"
          items={[
            "覆盖像素层标准事件",
            "补充订单层对账验证",
            "支持复制或下载 CSV",
          ]}
          primaryAction={{ content: "返回验收页", url: "/app/verification" }}
        />
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>PRD 2.5要求：</strong>生成"测试清单"用于验收对账。
              按照以下步骤进行测试，确保像素事件和订单数据的一致性。
            </Text>
          </BlockStack>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                测试清单
              </Text>
              <InlineStack gap="200">
                <Button
                  icon={ClipboardIcon}
                  onClick={handleCopyChecklist}
                  size="slim"
                >
                  复制清单
                </Button>
                <Button onClick={handleDownloadCSV} size="slim">
                  下载 CSV
                </Button>
              </InlineStack>
            </InlineStack>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                像素层验收（Web Pixels 标准事件）
              </Text>
              <List type="number">
                {testChecklist.pixelLayer.map((item, index) => (
                  <List.Item key={index}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {item.eventName}
                        </Text>
                        <Badge tone={item.required ? "critical" : "info"}>
                          {item.required ? "必需" : "可选"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>验证点：</strong>
                        {item.verificationPoints.join("、")}
                      </Text>
                      {item.expectedParams && (
                        <Box
                          padding="300"
                          borderRadius="200"
                          background="bg-surface-secondary"
                        >
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            预期参数：
                          </Text>
                          <List type="bullet">
                            {item.expectedParams.map((param, pIndex) => (
                              <List.Item key={pIndex}>
                                <Text as="span" variant="bodySm">
                                  {param}
                                </Text>
                              </List.Item>
                            ))}
                          </List>
                        </Box>
                      )}
                    </BlockStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                订单层验收（Webhook/Admin API 对账）
              </Text>
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  <strong>PRD 2.5说明：</strong>标准事件覆盖的是"店内行为+checkout链路"，
                  它并不天然覆盖退款/取消等订单后事件，所以订单层验收是第二层验证。
                </Text>
              </Banner>
              <List type="number">
                {testChecklist.orderLayer.map((item, index) => (
                  <List.Item key={index}>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {item.eventType}
                        </Text>
                        <Badge tone={item.required ? "critical" : "info"}>
                          {item.required ? "必需" : "可选"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>验证点：</strong>
                        {item.verificationPoints.join("、")}
                      </Text>
                      {item.expectedFields && (
                        <Box
                          padding="300"
                          borderRadius="200"
                          background="bg-surface-secondary"
                        >
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            预期字段：
                          </Text>
                          <List type="bullet">
                            {item.expectedFields.map((field, fIndex) => (
                              <List.Item key={fIndex}>
                                <Text as="span" variant="bodySm">
                                  {field}
                                </Text>
                              </List.Item>
                            ))}
                          </List>
                        </Box>
                      )}
                    </BlockStack>
                  </List.Item>
                ))}
              </List>
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                测试步骤
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    进入 Shopify checkout 页面，触发 checkout_started 事件
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    填写联系信息，触发 checkout_contact_info_submitted 事件
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    填写配送信息，触发 checkout_shipping_info_submitted 事件
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    填写支付信息，触发 payment_info_submitted 事件
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    完成订单，触发 checkout_completed 事件
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在验收页面查看实时事件流，验证 payload 参数完整率
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    对比 Shopify 订单数据与平台事件数据，验证金额/币种一致性
                  </Text>
                </List.Item>
              </List>
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                下一步
              </Text>
              <Button url="/app/verification" variant="primary">
                前往验收页面
              </Button>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
