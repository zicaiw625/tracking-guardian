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
  Badge,
} from "@shopify/polaris";
import { ExternalIcon } from "~/components/icons";
import { authenticate } from "../shopify.server";
import { UI_MODULES, type ModuleKey } from "../types/ui-extension";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { checkCustomerAccountsEnabled } from "../services/customer-accounts.server";

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
    label: "Order status 页面（Customer Accounts）",
    target: "customer-account.order-status.block.render",
    description: "适用于 Customer Accounts 体系下的订单状态页，客户可在此查看物流与订单信息。重要：仅支持 Customer Accounts 体系，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。",
  },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const key = params.key;
  if (!key || !(key in UI_MODULES)) {
    throw new Response("模块不存在", { status: 404 });
  }
  const moduleKey = key as ModuleKey;
  const moduleInfo = UI_MODULES[moduleKey];
  if (moduleInfo.disabled) {
    throw new Response("模块不可用", { status: 403 });
  }
  const hasOrderStatusTarget = moduleInfo.targets.includes("order_status");
  let customerAccountsStatus = null;
  if (hasOrderStatusTarget) {
    customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  }
  return json({
    moduleKey,
    moduleName: moduleInfo.name,
    targets: moduleInfo.targets,
    shopDomain,
    customerAccountsStatus,
    hasOrderStatusTarget,
  });
};

export default function UiModulePublishGuide() {
  const { moduleName, targets, shopDomain, customerAccountsStatus, hasOrderStatusTarget } = useLoaderData<typeof loader>();
  const targetCards = targets.map((target) => TARGET_DETAILS[target]);
  const orderStatusTarget = targetCards.find((card) => card.target === "customer-account.order-status.block.render");
  const customerAccountsEnabled = customerAccountsStatus?.enabled ?? false;
  const canPublishOrderStatus = !hasOrderStatusTarget || customerAccountsEnabled;
  return (
    <Page
      title={`${moduleName} 发布指引`}
      subtitle="在 Shopify Checkout Editor 中放置应用 block 并完成发布"
      backAction={{ content: "返回模块列表", url: "/app/modules" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <PageIntroCard
              title="发布步骤概览"
              description="将模块添加到 Checkout Editor 并发布，确保客户侧可见。"
              items={[
                "选择正确的 target 页面",
                "完成配置后点击发布",
                "发布完成可回到模块列表查看状态",
              ]}
              primaryAction={{ content: "返回模块列表", url: "/app/modules" }}
            />
            {!canPublishOrderStatus && (
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <strong>⚠️ 无法发布 Order Status 模块</strong>
                  </Text>
                  <Text as="p" variant="bodySm">
                    检测到您的店铺未启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，当前无法发布。
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>解决方案：</strong>请在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后重新访问此页面。
                  </Text>
                  {customerAccountsStatus?.error && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      检测错误：{customerAccountsStatus.error}
                    </Text>
                  )}
                </BlockStack>
              </Banner>
            )}
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
                          <Banner tone={customerAccountsEnabled ? "info" : "critical"}>
                            <BlockStack gap="200">
                              {!customerAccountsEnabled ? (
                                <>
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    <strong>⚠️ 未启用 Customer Accounts</strong>
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    检测到您的店铺未启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，当前无法使用。
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    <strong>解决方案：</strong>请在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后重新访问此页面。
                                  </Text>
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    如何检查并启用 Customer Accounts：
                                  </Text>
                                  <List type="number">
                                    <List.Item>
                                      前往 Shopify Admin → 设置 → 客户账户（Settings → Customer accounts）
                                    </List.Item>
                                    <List.Item>
                                      确认 Customer Accounts 功能已启用：如果设置页面显示"客户账户"或"Customer Accounts"选项，说明已启用。如果页面显示"客户账户"相关设置选项（如登录方式、注册方式等），说明 Customer Accounts 已启用
                                    </List.Item>
                                    <List.Item>
                                      如何确认店铺是否支持 Customer Accounts：如果 Shopify Admin → 设置中没有"客户账户"或"Customer Accounts"选项，说明您的店铺当前不支持 Customer Accounts 功能。某些地区、店铺类型或 Shopify 计划可能暂时不支持 Customer Accounts。请以 Shopify Admin 中的实际选项为准
                                    </List.Item>
                                    <List.Item>
                                      如果支持但未启用：请按照 Shopify 官方指引启用 Customer Accounts 功能。启用后，订单状态页将自动切换到 Customer Accounts 体系，旧版订单状态页将不再使用
                                    </List.Item>
                                    <List.Item>
                                      如果店铺不支持 Customer Accounts：Order Status 模块将无法使用。这是 Shopify 平台的设计限制，Order Status 模块只能在 Customer Accounts 体系下工作
                                    </List.Item>
                                  </List>
                                  {customerAccountsStatus?.error && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      检测错误：{customerAccountsStatus.error}
                                    </Text>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    <strong>✅ Customer Accounts 已启用</strong>
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    <strong>Order status 模块：</strong>使用 <code>customer-account.order-status.block.render</code> target，仅适用于 Customer Accounts 体系下的订单状态页。旧版订单状态页（非 Customer Accounts）不会显示此模块。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                                  </Text>
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    文档引用说明（避免误导）：
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    需要 protected customer data 权限才能访问客户账户信息（如客户邮箱、地址等）。请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    <strong>重要：不要参考 checkout-ui-extensions 文档</strong>，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。请务必使用 Customer Accounts UI Extensions 文档作为参考。
                                  </Text>
                                </>
                              )}
                            </BlockStack>
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
                    <strong>重要提示：</strong>UI Extensions 需要 protected customer data 权限才能访问部分客户信息。如果某些属性显示为 null，请检查应用的权限配置。Order status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。
                  </Text>
                </Banner>
                <List type="number">
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm">
                        进入 <strong>Shopify Admin</strong> → <strong>设置</strong> → <strong>结账和订单处理</strong> → <strong>Checkout Editor</strong>。
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 提示：您也可以直接访问 <code>https://admin.shopify.com/store/{'{'}您的店铺域名{'}'}/settings/checkout</code> 并点击"Checkout Editor"按钮。
                      </Text>
                      <InlineStack gap="200">
                        <Button
                          url={`https://admin.shopify.com/store/${shopDomain}/settings/checkout`}
                          variant="primary"
                          size="medium"
                          external
                        >
                          一键打开 Checkout Editor（Deep Link）
                        </Button>
                        <Button
                          url={`https://admin.shopify.com/store/${shopDomain}/settings/checkout?page=thank-you`}
                          variant="plain"
                          size="slim"
                          external
                        >
                          直接跳转到 Thank You 页面
                        </Button>
                        <Button
                          url={`https://admin.shopify.com/store/${shopDomain}/settings/checkout?page=order-status`}
                          variant="plain"
                          size="slim"
                          external
                          disabled={hasOrderStatusTarget && !customerAccountsEnabled}
                        >
                          直接跳转到 Order Status 页面
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm">
                        在顶部页面选择器中切换到 <strong>Thank you</strong> 或 <strong>Order status</strong> 页面（根据模块的 target 选择对应页面）。
                      </Text>
                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            💡 使用 placement-reference 预览测试位点（官方推荐，必须使用）
                          </Text>
                          <Text as="p" variant="bodySm">
                            在 Checkout Editor 中，您可以使用拖拽功能实时预览模块在不同位置的显示效果。Shopify 官方强烈推荐在发布前使用此功能预览不同位置的显示效果，帮助您选择最佳放置位置。
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            操作步骤：
                          </Text>
                          <List type="number">
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                在 Checkout Editor 中添加模块后，使用鼠标拖拽模块到不同位置
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                实时预览模块在不同位置的显示效果（包括 Thank You 和 Order Status 页面）
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                选择最佳放置位置，确保模块不会遮挡重要信息
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                确认位置后，点击"保存并发布"
                              </Text>
                            </List.Item>
                          </List>
                          <Text as="p" variant="bodySm">
                            详细使用方法请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                          </Text>
                          <Text as="p" variant="bodySm" tone="critical">
                            ⚠️ 重要：使用 placement-reference 预览功能可以避免发布后才发现位置不合适的问题，强烈建议在发布前充分测试不同位置的显示效果。这是 Shopify 官方推荐的方式，可以显著减少发布后的调整工作。
                          </Text>
                        </BlockStack>
                      </Banner>
                      <Banner tone="warning">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            ⚠️ 重要：Order status 页面仅支持 Customer Accounts 体系
                          </Text>
                          <Text as="p" variant="bodySm">
                            Order status 页面仅支持 Customer Accounts 体系下的订单状态页（customer-account.order-status.block.render target）。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                          </Text>
                          <Text as="p" variant="bodySm">
                            如果您的店铺未启用 Customer Accounts，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后才能使用 Order status 模块。
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            文档引用说明（避免误导）：
                          </Text>
                          <Text as="p" variant="bodySm">
                            请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                          </Text>
                        </BlockStack>
                      </Banner>
                    </BlockStack>
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
                <InlineStack gap="200" wrap>
                  <Button
                    url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                    external
                    icon={ExternalIcon}
                    size="slim"
                  >
                    查看 Customer Accounts UI Extensions 文档
                  </Button>
                  <Button
                    url="https://help.shopify.com/en/manual/checkout-settings/checkout-editor"
                    external
                    icon={ExternalIcon}
                    size="slim"
                  >
                    查看 Checkout Editor 官方指引
                  </Button>
                </InlineStack>
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
                      <strong>重要：Block 扩展需要手动放置</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      Shopify 的 block target 机制要求商家在 Checkout Editor 中手动放置应用 block。模块不会自动显示，必须按照上述步骤在编辑器中添加并发布。这是 Shopify 平台的设计限制，无法自动放置。所有 UI Extension block 都需要在 Checkout Editor 中手动添加并发布，系统不会自动放置。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>快速跳转到 Checkout Editor（Deep Link，强烈推荐）：</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      使用上方"一键打开 Checkout Editor（Deep Link）"按钮可直接跳转到编辑器，无需手动导航。这是最快速的跳转方式，可以直接打开编辑器进行配置。
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Deep Link 地址格式：</strong>
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          通用入口：<code>https://admin.shopify.com/store/{'{'}您的店铺域名{'}'}/settings/checkout</code>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          直接定位到 Thank You 页面：<code>https://admin.shopify.com/store/{'{'}您的店铺域名{'}'}/settings/checkout?page=thank-you</code>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          直接定位到 Order Status 页面（Customer Accounts）：<code>https://admin.shopify.com/store/{'{'}您的店铺域名{'}'}/settings/checkout?page=order-status</code>
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="subdued">
                      💡 提示：使用 deep link 可以快速定位到需要配置的页面，避免手动导航，提高配置效率。这是 Shopify 平台推荐的方式。点击上方"一键打开 Checkout Editor（Deep Link）"按钮可直接跳转。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>使用 placement-reference 预览测试位点（官方推荐，必须使用）：</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      在 Checkout Editor 中，您可以使用拖拽功能实时预览模块在不同位置的显示效果。Shopify 官方强烈推荐在发布前使用此功能预览不同位置的显示效果，帮助您选择最佳放置位置。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      操作步骤：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          在 Checkout Editor 中添加模块后，使用鼠标拖拽模块到不同位置
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          实时预览模块在不同位置的显示效果（包括 Thank You 和 Order Status 页面）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          选择最佳放置位置，确保模块不会遮挡重要信息
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          确认位置后，点击"保存并发布"
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm">
                      详细使用方法请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                    </Text>
                    <Text as="p" variant="bodySm" tone="critical">
                      ⚠️ 重要：使用 placement-reference 预览功能可以避免发布后才发现位置不合适的问题，强烈建议在发布前充分测试不同位置的显示效果。这是 Shopify 官方推荐的方式，可以显著减少发布后的调整工作。
                    </Text>
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
                          自 <strong>2025-12-10</strong> 起，部分属性（如 <code>buyer.email</code>、<code>buyer.phone</code>、<code>deliveryAddress</code> 等）需要 Protected Customer Data (PCD) 权限，否则会显示为 <code>null</code>。
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
