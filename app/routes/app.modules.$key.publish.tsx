import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  List,
  Button,
  Box,
  Banner,
  Divider,
} from "@shopify/polaris";
import { ExternalIcon } from "~/components/icons";
import { authenticate } from "../shopify.server";
import { UI_MODULES, type ModuleKey } from "../types/ui-extension";

const TARGET_DETAILS: Record<
  "thank_you" | "order_status",
  { label: string; target: string; description: string }
> = {
  thank_you: {
    label: "Thank you 页面",
    target: "purchase.thank-you.block.render",
    description: "适用于客户完成支付后的感谢页。",
  },
  order_status: {
    label: "Order status 页面",
    target: "customer-account.order-status.block.render",
    description: "适用于客户在订单状态页查看物流与订单信息。",
  },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const key = params.key;

  if (!key || !(key in UI_MODULES)) {
    throw new Response("模块不存在", { status: 404 });
  }

  const moduleKey = key as ModuleKey;
  const moduleInfo = UI_MODULES[moduleKey];

  return json({
    moduleKey,
    moduleName: moduleInfo.name,
    targets: moduleInfo.targets,
  });
};

export default function UiModulePublishGuide() {
  const { moduleName, targets } = useLoaderData<typeof loader>();
  const targetCards = targets.map((target) => TARGET_DETAILS[target]);

  return (
    <Page
      title={`${moduleName} 发布指引`}
      subtitle="在 Shopify Checkout Editor 中放置应用 block 并完成发布"
      backAction={{ content: "返回模块列表", url: "/app/ui-blocks" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  请在 <strong>Shopify Checkout Editor</strong> 中完成模块添加与发布。
                  以下步骤可帮助您将模块放置到正确的页面和位置。
                </Text>
              </BlockStack>
            </Banner>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  PRD 2.4: UI Extension Targets 说明
                </Text>
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      PRD要求：在模块配置页明确说明UI Extension targets
                    </Text>
                    <Text as="p" variant="bodySm">
                      每个模块都有对应的target，用于指定模块在Shopify Checkout系统中的显示位置
                    </Text>
                  </BlockStack>
                </Banner>
                <BlockStack gap="300">
                  {targetCards.map((item) => (
                    <Box
                      key={item.target}
                      padding="400"
                      borderRadius="200"
                      background="bg-surface-secondary"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {item.label}
                          </Text>
                          <Badge tone="info">{item.target}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.description}
                        </Text>
                        {item.target === "purchase.thank-you.block.render" && (
                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              <strong>Thank you 模块：</strong>使用 <code>purchase.thank-you.block.render</code> target，适用于客户完成支付后的感谢页。需要 protected customer data 权限才能访问订单相关的客户信息（如 buyer.email、buyer.phone、deliveryAddress 等）。
                            </Text>
                          </Banner>
                        )}
                        {item.target === "customer-account.order-status.block.render" && (
                          <Banner tone="info">
                            <Text as="p" variant="bodySm">
                              <strong>Order status 模块：</strong>使用 <code>customer-account.order-status.block.render</code> target，适用于客户在订单状态页查看物流与订单信息。需要 protected customer data 权限才能访问客户账户信息（如客户邮箱、地址等）。
                            </Text>
                          </Banner>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  操作步骤（图文指引）
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    <strong>重要提示：</strong>UI Extensions 需要 protected customer data 权限才能访问部分客户信息。如果某些属性显示为 null，请检查应用的权限配置。
                  </Text>
                </Banner>
                <List type="number">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      进入 <strong>Shopify Admin</strong> → <strong>设置</strong> → <strong>结账和订单处理</strong> → <strong>Checkout Editor</strong>。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      在顶部页面选择器中切换到 <strong>Thank you</strong> 或 <strong>Order status</strong> 页面（根据模块的 target 选择对应页面）。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      点击页面编辑器中的 <strong>"添加区块"</strong> 或 <strong>"Add block"</strong> 按钮，在应用列表中找到 <strong>Tracking Guardian</strong>，选择 <strong>{moduleName}</strong> 模块并添加。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      拖拽模块调整位置（建议放在页面顶部或底部），配置模块显示规则（如需要），然后点击 <strong>"保存并发布"</strong> 或 <strong>"Save and publish"</strong>。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      发布完成后，返回本应用查看模块状态，或使用测试订单验证模块是否正常显示。
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                {}
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      PRD 2.4要求：Checkout Editor 放置 block 的截图指引
                    </Text>
                    <Text as="p" variant="bodySm">
                      以下为关键步骤的可视化指引，详细截图请参考 Shopify 官方文档或联系支持获取完整截图包。
                    </Text>
                  </BlockStack>
                </Banner>
                <InlineStack gap="400" wrap>
                  <Box
                    padding="400"
                    borderRadius="200"
                    background="bg-surface-secondary"
                    minWidth="220px"
                  >
                    <BlockStack gap="200" align="center">
                      <img
                        src="/images/checkout-editor-step-1.svg"
                        alt="步骤1：打开 Checkout Editor"
                        style={{ width: "100%", maxWidth: "260px", borderRadius: "12px" }}
                      />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        步骤1：打开 Checkout Editor
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        在 Shopify Admin → 设置 → 结账和订单处理 → Checkout Editor
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box
                    padding="400"
                    borderRadius="200"
                    background="bg-surface-secondary"
                    minWidth="220px"
                  >
                    <BlockStack gap="200" align="center">
                      <img
                        src="/images/checkout-editor-step-2.svg"
                        alt="步骤2：添加应用 Block"
                        style={{ width: "100%", maxWidth: "260px", borderRadius: "12px" }}
                      />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        步骤2：添加应用 Block
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        点击“添加区块”，在应用列表中找到 Tracking Guardian
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box
                    padding="400"
                    borderRadius="200"
                    background="bg-surface-secondary"
                    minWidth="220px"
                  >
                    <BlockStack gap="200" align="center">
                      <img
                        src="/images/checkout-editor-step-3.svg"
                        alt="步骤3：保存并发布"
                        style={{ width: "100%", maxWidth: "260px", borderRadius: "12px" }}
                      />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        步骤3：保存并发布
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        拖拽调整位置，点击“保存并发布”
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineStack>
                <Button
                  url="https://help.shopify.com/en/manual/checkout-settings/checkout-editor"
                  external
                  icon={ExternalIcon}
                  size="slim"
                >
                  查看 Checkout Editor 官方指引
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  发布前检查清单
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      确认模块已在本应用中启用并保存配置。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      检查 target 页面（Thank you 或 Order status）已在 Checkout Editor 中正确添加应用 block。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      确认模块位置符合设计要求（避免遮挡重要信息）。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      发布后使用测试订单或测试结账流程验证模块是否正常显示和功能是否正常。
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>UI Extensions 限制说明：</strong>
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          UI Extensions 运行在严格沙箱环境中，不能随意注入脚本或访问 DOM。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          部分属性需要 protected customer data 权限，否则会显示为 null。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          某些行为 UI Extensions 不支持，请参考 Shopify 官方文档了解限制。
                        </Text>
                      </List.Item>
                    </List>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
