import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getUiModuleConfigs,
  updateUiModuleConfig,
  type UiModuleConfig,
} from "../services/ui-extension.server";
import { UI_MODULES, type ModuleKey } from "../types/ui-extension";
import { getPlanOrDefault, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";
import { DisplayRulesEditor } from "../components/ui-blocks/DisplayRulesEditor";
import { useToastContext } from "../components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  return json({
    shop: { id: shop.id, plan: planId },
    moduleKey,
    moduleInfo,
    moduleConfig,
    canEdit,
    planInfo,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const key = params.key;

  if (!key || !(key in UI_MODULES)) {
    return json({ error: "模块不存在" }, { status: 404 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }

  const moduleKey = key as ModuleKey;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "update_config") {
    const configJson = formData.get("config") as string;
    try {
      const config = JSON.parse(configJson);
      const result = await updateUiModuleConfig(shop.id, moduleKey, config);
      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true, actionType: "update_config", moduleKey });
    } catch {
      return json({ error: "无效的配置数据" }, { status: 400 });
    }
  }

  if (actionType === "update_display_rules") {
    const displayRulesJson = formData.get("displayRules") as string;
    try {
      const displayRules = JSON.parse(displayRulesJson);
      const result = await updateUiModuleConfig(shop.id, moduleKey, {
        displayRules,
      });
      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({
        success: true,
        actionType: "update_display_rules",
        moduleKey,
      });
    } catch {
      return json({ error: "无效的显示规则" }, { status: 400 });
    }
  }

  return json({ error: "未知操作" }, { status: 400 });
};

export default function UiModuleConfigPage() {
  const { moduleKey, moduleInfo, moduleConfig, canEdit, planInfo } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const { showSuccess, showError } = useToastContext();

  if (actionData?.success) {
    showSuccess("配置已保存");
  } else if (actionData?.error) {
    showError(actionData.error);
  }

  return (
    <Page
      title={`${moduleInfo.name} 配置`}
      subtitle="文案/本地化/显示规则"
      backAction={{ content: "返回模块列表", url: "/app/ui-blocks" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <PageIntroCard
              title="配置说明"
              description="调整文案、本地化与显示规则，发布后在 Checkout 中生效。"
              items={[
                "支持多语言与可见性规则",
                "配置后需在 Checkout Editor 发布",
              ]}
              primaryAction={{ content: "发布指引", url: `/app/modules/${moduleKey}/publish` }}
              secondaryAction={{ content: "返回模块列表", url: "/app/ui-blocks" }}
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
                            : "Order status"
                        )
                        .join(", ")}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  显示规则配置
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  配置模块在哪些条件下显示，例如：特定产品、特定订单金额、特定客户标签等。
                </Text>
                <Divider />
                <DisplayRulesEditor
                  moduleKey={moduleKey}
                  displayRules={moduleConfig.displayRules || {}}
                  onSave={(displayRules) => {
                    const formData = new FormData();
                    formData.append("_action", "update_display_rules");
                    formData.append("displayRules", JSON.stringify(displayRules));
                    submit(formData, { method: "post" });
                  }}
                  disabled={!canEdit}
                />
              </BlockStack>
            </Card>

            {}
            <Banner tone="warning">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  <strong>⚠️ Protected Customer Data (PCD) 重要说明</strong>
                </Text>
                <Text as="p" variant="bodySm">
                  自 <strong>2025-12-10</strong> 起，Shopify Web Pixels 中的客户个人信息（PII，如邮箱/电话/地址）将仅在应用获得批准的 <strong>Protected Customer Data (PCD)</strong> 权限后才会填充。未获批的应用，相关字段将为 <code>null</code>。
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
                      <strong>Order status block (customer-account.order-status.block.render)：</strong>需要 PCD 权限才能访问客户账户信息（如客户邮箱、地址等）
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
                >
                  查看发布指引
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
