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
  Icon,
} from "@shopify/polaris";
import { ExternalIcon, ImageIcon } from "~/components/icons";
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
                  目标位置（Targets）
                </Text>
                <List type="bullet">
                  {targetCards.map((item) => (
                    <List.Item key={item.target}>
                      <Text as="span" variant="bodySm">
                        <strong>{item.label}</strong>：<code>{item.target}</code>。
                        {item.description}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  操作步骤（图文指引）
                </Text>
                <List type="number">
                  <List.Item>
                    进入 Shopify Admin，打开 <strong>Checkout Editor</strong>。
                  </List.Item>
                  <List.Item>
                    在顶部切换到 <strong>Thank you</strong> 或 <strong>Order status</strong> 页面。
                  </List.Item>
                  <List.Item>
                    点击 “添加区块”，在应用列表中选择 <strong>Tracking Guardian</strong> 并添加
                    {moduleName} 模块。
                  </List.Item>
                  <List.Item>
                    调整模块位置，点击 “保存并发布”。完成后返回应用查看状态。
                  </List.Item>
                </List>
                <Divider />
                <InlineStack gap="400" wrap>
                  <Box
                    padding="400"
                    borderRadius="200"
                    background="bg-surface-secondary"
                    minWidth="220px"
                  >
                    <BlockStack gap="200" align="center">
                      <Icon source={ImageIcon} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        打开 Checkout Editor
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        在 Shopify Admin 中进入结账编辑器。
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
                      <Icon source={ImageIcon} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        添加应用 Block
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        选择 Tracking Guardian 并插入模块。
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
                      <Icon source={ImageIcon} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        保存并发布
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        保存后刷新应用确认生效。
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
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  发布前检查清单
                </Text>
                <List type="bullet">
                  <List.Item>确认模块已启用并保存配置。</List.Item>
                  <List.Item>检查 target 页面已正确添加应用 block。</List.Item>
                  <List.Item>发布后使用测试订单或测试结账流程验证显示。</List.Item>
                </List>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
