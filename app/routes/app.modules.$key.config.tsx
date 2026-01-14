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
  Button,
  Banner,
  Divider,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getUiModuleConfigs,
  type UiModuleConfig,
} from "../services/ui-extension.server";
import { UI_MODULES, type ModuleKey } from "../types/ui-extension";
import { getPlanOrDefault, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { checkCustomerAccountsEnabled } from "../services/customer-accounts.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const key = params.key;
  if (!key || !(key in UI_MODULES)) {
    throw new Response("模块不存在", { status: 404 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    throw new Response("店铺未找到", { status: 404 });
  }
  const moduleKey = key as ModuleKey;
  const moduleInfo = UI_MODULES[moduleKey];
  const planId = shop.plan as PlanId;
  const planInfo = getPlanOrDefault(planId);
  const modules = await getUiModuleConfigs(shop.id);
  const moduleConfig = modules.find((m) => m.moduleKey === moduleKey);
  if (!moduleConfig) {
    throw new Response("模块配置未找到", { status: 404 });
  }
  const canEdit = isPlanAtLeast(planId, moduleInfo.requiredPlan);
  const hasOrderStatusTarget = moduleInfo.targets.includes("order_status");
  let customerAccountsStatus = null;
  if (hasOrderStatusTarget) {
    customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  }
  return json({
    shop: { id: shop.id, plan: planId },
    moduleKey,
    moduleInfo,
    moduleConfig,
    canEdit,
    planInfo,
    customerAccountsStatus,
    hasOrderStatusTarget,
  });
};


export default function UiModuleConfigPage() {
  const { moduleKey, moduleInfo, moduleConfig, canEdit, planInfo, customerAccountsStatus, hasOrderStatusTarget } =
    useLoaderData<typeof loader>();
  const customerAccountsEnabled = customerAccountsStatus?.enabled ?? false;
  return (
    <Page
      title={`${moduleInfo.name} 配置`}
      subtitle="模块启用状态与发布指引"
      backAction={{ content: "返回模块列表", url: "/app/modules" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <PageIntroCard
              title="配置说明"
              description="在此页面启用/停用模块，文案和样式配置需在 Shopify Checkout Editor 中完成。"
              items={[
                "查看和切换模块启用状态",
                "文案和样式在 Checkout Editor 中配置",
                moduleKey === "reorder" 
                  ? "发布后模块将显示在 Order Status 页面（仅限 Customer Accounts 体系，需手动在 Checkout Editor 中放置）"
                  : "发布后模块将显示在 Thank You / Order Status 页面（需手动在 Checkout Editor 中放置，Order Status 仅支持 Customer Accounts 体系）",
              ]}
              primaryAction={{ content: "发布指引", url: `/app/modules/${moduleKey}/publish` }}
              secondaryAction={{ content: "返回模块列表", url: "/app/modules" }}
            />
            {!canEdit && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    <strong>需要升级：</strong>此模块需要 {planInfo.name}{" "}
                    及以上套餐才能配置。
                  </Text>
                  <Button url="/app/billing" size="slim">
                    升级套餐
                  </Button>
                </BlockStack>
              </Banner>
            )}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  模块信息
                </Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      模块名称
                    </Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {moduleInfo.name}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      模块状态
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {moduleConfig.isEnabled ? "已启用" : "未启用"}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">
                      适用页面
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {moduleInfo.targets
                        .map((t) =>
                          t === "thank_you"
                            ? "Thank you"
                            : "Order status（仅 Customer Accounts 体系，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能）"
                        )
                        .join(", ")}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
            {hasOrderStatusTarget && (
              <Banner tone={customerAccountsEnabled ? "warning" : "critical"}>
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
                        <strong>重要：仅支持 Customer Accounts 体系下的订单状态页</strong>，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                      </Text>
                      {moduleKey === "reorder" && (
                        <Text as="p" variant="bodySm">
                          <strong>再购功能仅在 Customer Accounts 的 Order Status 页面（customer-account.order-status.block.render）可用，不支持 Thank You 页面。</strong>此功能需要访问客户账户信息（如客户 ID），这些信息仅在 Customer Accounts 上下文中可用。
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        如何检查 Customer Accounts 是否已启用：
                      </Text>
                      <List type="number">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            进入 Shopify Admin → 设置 → 客户账户（Settings → Customer accounts）
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            查看"客户账户"设置页面，确认 Customer Accounts 功能已启用：如果页面显示"客户账户"相关设置选项（如登录方式、注册方式等），说明 Customer Accounts 已启用
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            如何确认店铺是否支持 Customer Accounts：如果 Shopify Admin → 设置中没有"客户账户"或"Customer Accounts"选项，说明您的店铺当前不支持 Customer Accounts 功能。某些地区、店铺类型或 Shopify 计划可能暂时不支持 Customer Accounts。请以 Shopify Admin 中的实际选项为准
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            如果支持但未启用：请按照 Shopify 官方指引启用 Customer Accounts 功能
                          </Text>
                        </List.Item>
                      </List>
                      <Text as="p" variant="bodySm" tone="subdued">
                        参考文档：请参考 <a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">Customer Accounts UI Extensions 官方文档</a>（注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions）。
                      </Text>
                      {moduleKey === "reorder" && (
                        <>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            ⚠️ 需要 PCD 审核批准
                          </Text>
                          <Text as="p" variant="bodySm">
                            再购功能需要 Shopify Protected Customer Data (PCD) 权限批准才能稳定可用。需要访问客户账户信息（如客户邮箱、地址等），这些数据受 PCD 保护。
                          </Text>
                          <Text as="p" variant="bodySm">
                            如果 PCD 权限未获批或用户未同意 consent，某些客户信息字段可能为 null，这是 Shopify 平台的合规行为，不是故障。
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            💡 提示：在启用此模块前，请确保应用已获得 Shopify PCD 权限批准，否则功能可能无法正常工作。
                          </Text>
                        </>
                      )}
                    </>
                  )}
                </BlockStack>
              </Banner>
            )}
            <Banner tone="warning">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  <strong>⚠️ Protected Customer Data (PCD) 重要说明</strong>
                </Text>
                <Text as="p" variant="bodySm">
                  自 <strong>2025-12-10</strong> 起，Shopify Web Pixels 中的客户个人信息（PII，如邮箱/电话/地址）将仅在应用获得批准的 <strong>Protected Customer Data (PCD)</strong> 权限后才会填充。未获批的应用，<strong>buyer.email / phone / address 等可能全为 null</strong>。
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  需要 Protected Customer Data 的属性：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>Thank you block (purchase.thank-you.block.render)：</strong>需要 PCD 权限才能访问订单相关的客户信息（如 <code>buyer.email</code>、<code>buyer.phone</code>、<code>deliveryAddress</code> 等）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>Order status block (customer-account.order-status.block.render)：</strong>仅支持 Customer Accounts 体系下的订单状态页，需要 PCD 权限才能访问客户账户信息（如客户邮箱、地址等）。旧版订单状态页（非 Customer Accounts）不会显示此模块。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。如果您的店铺使用旧版订单状态页，此模块将不会显示。请参考 <a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">Customer Accounts UI Extensions 官方文档</a>（注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions）。
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  UI Extensions 不支持的行为：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      不能随意注入脚本（script tags）或执行任意 JavaScript
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      不能访问 DOM 或修改页面结构
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      运行在严格沙箱环境（Web Worker）中，能力受限
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 <strong>提示：</strong>如果某些客户信息字段为 <code>null</code>，这可能是由于 PCD 权限未获批或用户未同意 consent，这是 Shopify 平台的合规行为，不是故障。
                </Text>
              </BlockStack>
            </Banner>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  下一步
                </Text>
                <Button
                  url={`/app/modules/${moduleKey}/publish`}
                  variant="primary"
                  disabled={hasOrderStatusTarget && !customerAccountsEnabled}
                >
                  查看发布指引
                </Button>
                {hasOrderStatusTarget && !customerAccountsEnabled && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodySm">
                      无法发布：您的店铺未启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能。
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
