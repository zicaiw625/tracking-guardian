import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  Tabs,
  Checkbox,
  Icon,
  List,
  Tag,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  SettingsIcon,
  RefreshIcon,
  ExternalIcon,
} from "~/components/icons";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getUiModuleConfigs,
  updateUiModuleConfig,
  getEnabledModulesCount,
  batchToggleModules,
} from "../services/ui-extension.server";
import { generateModulePreviewUrl, isDevStore } from "../utils/dev-store.server";
import {
  UI_MODULES,
  type ModuleKey,
  type UiModuleConfig,
} from "../types/ui-extension";
import { getPlanOrDefault, type PlanId, BILLING_PLANS } from "../services/billing/plans";
import { logger } from "../utils/logger.server";
import { PCD_CONFIG } from "../utils/config";
import { checkCustomerAccountsEnabled } from "../services/customer-accounts.server";

interface LoaderData {
  shop: {
    id: string;
    plan: PlanId;
  } | null;
  shopDomain: string;
  modules: UiModuleConfig[];
  enabledCount: number;
  maxModules: number;
  planInfo: typeof BILLING_PLANS[PlanId];
  isDevStore: boolean;
  modulePreviewUrls: Record<string, { thank_you?: string; order_status?: string }>;
  surveySubmissionCount?: number;
  customerAccountsEnabled: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  const customerAccountsEnabled = customerAccountsStatus.enabled;
  if (!shop) {
    return json<LoaderData>({
      shop: null,
      shopDomain,
      modules: [],
      enabledCount: 0,
      maxModules: 0,
      planInfo: BILLING_PLANS.free,
      isDevStore: false,
      modulePreviewUrls: {},
      surveySubmissionCount: 0,
      customerAccountsEnabled: false,
    });
  }
  const planId = shop.plan as PlanId;
  const planInfo = getPlanOrDefault(planId);
  const modules = await getUiModuleConfigs(shop.id);
  const enabledCount = await getEnabledModulesCount(shop.id);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const surveySubmissionCount = await prisma.surveyResponse.count({
    where: {
      shopId: shop.id,
      createdAt: {
        gte: sevenDaysAgo,
      },
    },
  });
  const isDev = isDevStore(shopDomain);
  const modulePreviewUrls: Record<string, { thank_you?: string; order_status?: string }> = {};
  if (isDev) {
    for (const module of modules) {
      const urls: { thank_you?: string; order_status?: string } = {};
      if (UI_MODULES[module.moduleKey].targets.includes("thank_you")) {
        urls.thank_you = generateModulePreviewUrl(shopDomain, module.moduleKey, "thank_you") || undefined;
      }
      if (UI_MODULES[module.moduleKey].targets.includes("order_status")) {
        urls.order_status = generateModulePreviewUrl(shopDomain, module.moduleKey, "order_status") || undefined;
      }
      modulePreviewUrls[module.moduleKey] = urls;
    }
  }
  return json<LoaderData>({
    shop: { id: shop.id, plan: planId },
    shopDomain,
    modules,
    enabledCount,
    maxModules: planInfo.uiModules,
    planInfo,
    isDevStore: isDev,
    modulePreviewUrls,
    surveySubmissionCount,
    customerAccountsEnabled,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }
  switch (actionType) {
    case "toggle_module": {
      const moduleKey = formData.get("moduleKey") as ModuleKey;
      if (moduleKey === "reorder") {
        if (!PCD_CONFIG.APPROVED) {
          return json({ error: "Reorder 功能需要 Protected Customer Data 审核批准，当前默认禁用" }, { status: 403 });
        }
      } else if (UI_MODULES[moduleKey].disabled) {
        return json({ error: UI_MODULES[moduleKey].disabledReason || `${moduleKey} 模块当前不可用` }, { status: 400 });
      }
      const isEnabled = formData.get("isEnabled") === "true";
      if (isEnabled && UI_MODULES[moduleKey].targets.includes("order_status")) {
        const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
        if (!customerAccountsStatus.enabled) {
          return json({ error: "Order Status 模块需要启用 Customer Accounts 功能。请在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后重试。" }, { status: 403 });
        }
      }
      const result = await updateUiModuleConfig(shop.id, moduleKey, { isEnabled });
      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true, actionType: "toggle_module", moduleKey, isEnabled });
    }
    case "batch_toggle_modules": {
      const updatesJson = formData.get("updates") as string;
      try {
        const updates = JSON.parse(updatesJson) as Array<{ moduleKey: ModuleKey; isEnabled: boolean }>;
        const customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
        const filteredUpdates = updates.filter((update) => {
          if (update.moduleKey === "reorder") {
            if (update.isEnabled && !PCD_CONFIG.APPROVED) {
              return false;
            }
          } else if (UI_MODULES[update.moduleKey].disabled) {
            return false;
          }
          if (update.isEnabled && UI_MODULES[update.moduleKey].targets.includes("order_status")) {
            if (!customerAccountsStatus.enabled) {
              return false;
            }
          }
          return true;
        });
        if (filteredUpdates.length === 0) {
          return json({ error: "没有可操作的模块（已过滤禁用的模块或需要 Customer Accounts 的模块）" }, { status: 400 });
        }
        const result = await batchToggleModules(shop.id, filteredUpdates);
        if (!result.success) {
          return json({ error: "批量操作失败" }, { status: 400 });
        }
        return json({
          success: true,
          actionType: "batch_toggle_modules",
          results: result.results
        });
      } catch {
        return json({ error: "无效的批量操作数据" }, { status: 400 });
      }
    }
    default:
      return json({ error: "未知操作" }, { status: 400 });
  }
};

function ModuleCard({
  module,
  onToggle,
  isSubmitting,
  canEnable,
  upgradeRequired,
  isSelected,
  onSelect,
  surveySubmissionCount,
  customerAccountsEnabled,
}: {
  module: UiModuleConfig;
  onToggle: (moduleKey: ModuleKey, enabled: boolean) => void;
  isSubmitting: boolean;
  canEnable: boolean;
  upgradeRequired?: PlanId;
  isSelected?: boolean;
  onSelect?: (moduleKey: ModuleKey, selected: boolean) => void;
  surveySubmissionCount?: number;
  customerAccountsEnabled: boolean;
}) {
  const info = UI_MODULES[module.moduleKey];
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            {onSelect && (
              <Checkbox
                checked={isSelected || false}
                onChange={(checked) => onSelect(module.moduleKey, checked)}
                label=""
              />
            )}
            <Box
              background={module.isEnabled ? "bg-fill-success-secondary" : "bg-surface-secondary"}
              padding="200"
              borderRadius="full"
            >
              <Text as="span" variant="headingMd">
                {info.icon}
              </Text>
            </Box>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  {info.name}
                </Text>
                {module.isEnabled && (
                  <Badge tone="success">已启用</Badge>
                )}
                {upgradeRequired && !module.isEnabled && (
                  <Badge tone="attention">需要升级</Badge>
                )}
                {(module.moduleKey === "survey" || module.moduleKey === "helpdesk" || module.moduleKey === "reorder") && (
                  <Badge tone="success" size="small">v1 支持</Badge>
                )}
                {module.moduleKey !== "survey" && module.moduleKey !== "helpdesk" && module.moduleKey !== "reorder" && !info.disabled && (
                  <Badge tone="info" size="small">v1.1+</Badge>
                )}
                {info.disabled && (
                  <Badge tone="info" size="small">v1.1+ 规划中</Badge>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {info.description}
                {info.disabled && info.disabledReason && `（${info.disabledReason}）`}
                {info.targets.includes("order_status") && (
                  <Banner tone="warning">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        重要：Order Status 模块仅支持 Customer Accounts 体系
                      </Text>
                      <Text as="p" variant="bodySm">
                        Order Status 模块使用 <code>customer-account.order-status.block.render</code> target，仅适用于 Customer Accounts 体系下的订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                      </Text>
                      <Text as="p" variant="bodySm">
                        请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。如果未启用，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后才能使用 Order status 模块。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        文档引用说明（避免误导）：
                      </Text>
                      <Text as="p" variant="bodySm">
                        请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                      </Text>
                    </BlockStack>
                  </Banner>
                )}
              </Text>
              {module.moduleKey === "survey" && surveySubmissionCount !== undefined && surveySubmissionCount > 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  最近7天提交量: {surveySubmissionCount} 条
                </Text>
              )}
            </BlockStack>
          </InlineStack>
          <InlineStack gap="200">
            <Button
              url={`/app/modules/${module.moduleKey}/publish`}
              variant="plain"
              size="slim"
            >
              发布指引
            </Button>
            <Button
              variant={module.isEnabled ? "secondary" : "primary"}
              onClick={() => onToggle(module.moduleKey, !module.isEnabled)}
              loading={isSubmitting}
              disabled={(!canEnable && !module.isEnabled) || (module.moduleKey !== "reorder" && info.disabled) || (module.moduleKey === "reorder" && !PCD_CONFIG.APPROVED) || (info.targets.includes("order_status") && !customerAccountsEnabled && !module.isEnabled)}
              size="slim"
            >
              {module.isEnabled ? "停用" : info.disabled ? "v1.1+ 支持" : (module.moduleKey === "reorder" && !PCD_CONFIG.APPROVED) ? "需要 PCD 审核" : (info.targets.includes("order_status") && !customerAccountsEnabled) ? "需要 Customer Accounts" : "启用"}
            </Button>
          </InlineStack>
        </InlineStack>
        <InlineStack gap="100">
          {info.targets.map((target) => (
            <Tag key={target}>
              {target === "thank_you" ? "Thank You 页" : "Order Status 页（仅 Customer Accounts 体系）"}
            </Tag>
          ))}
          <Tag>{getCategoryLabel(info.category)}</Tag>
        </InlineStack>
        {upgradeRequired && !module.isEnabled && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              此模块需要 {BILLING_PLANS[upgradeRequired].name} 或更高套餐。
              <Button url="/app/billing" variant="plain" size="slim">
                升级套餐
              </Button>
            </Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case "engagement":
      return "用户互动";
    case "support":
      return "客户支持";
    case "conversion":
      return "转化提升";
    default:
      return category;
  }
}


export default function UiBlocksPage() {
  const { shop, shopDomain, modules, enabledCount, maxModules, planInfo, isDevStore, modulePreviewUrls, surveySubmissionCount, customerAccountsEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { showSuccess, showError } = useToastContext();
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedModules, setSelectedModules] = useState<Set<ModuleKey>>(new Set());
  const isSubmitting = navigation.state === "submitting";
  useEffect(() => {
    if (actionData) {
      const data = actionData as { success?: boolean; error?: string; actionType?: string };
      if (data.success) {
        showSuccess("操作成功");
        if (data.actionType === "toggle_module") {
          revalidator.revalidate();
        }
      } else if (data.error) {
        showError(data.error);
      }
    }
  }, [actionData, showSuccess, showError, revalidator]);
  const handleToggleModule = useCallback(
    (moduleKey: ModuleKey, enabled: boolean) => {
      const formData = new FormData();
      formData.append("_action", "toggle_module");
      formData.append("moduleKey", moduleKey);
      formData.append("isEnabled", String(enabled));
      submit(formData, { method: "post" });
    },
    [submit]
  );
  const handleBatchEnable = useCallback(() => {
    if (selectedModules.size === 0) return;
    const updates = Array.from(selectedModules)
      .filter((moduleKey) => !UI_MODULES[moduleKey].disabled)
      .map((moduleKey) => ({
        moduleKey,
        isEnabled: true,
      }));
    if (updates.length === 0) return;
    const formData = new FormData();
    formData.append("_action", "batch_toggle_modules");
    formData.append("updates", JSON.stringify(updates));
    submit(formData, { method: "post" });
    setSelectedModules(new Set());
  }, [selectedModules, submit]);
  const handleBatchDisable = useCallback(() => {
    if (selectedModules.size === 0) return;
    const updates = Array.from(selectedModules).map((moduleKey) => ({
      moduleKey,
      isEnabled: false,
    }));
    const formData = new FormData();
    formData.append("_action", "batch_toggle_modules");
    formData.append("updates", JSON.stringify(updates));
    submit(formData, { method: "post" });
    setSelectedModules(new Set());
  }, [selectedModules, submit]);
  const canEnableMore = maxModules === -1 || enabledCount < maxModules;
  const tabs = [
    { id: "all", content: "全部模块" },
    { id: "engagement", content: "用户互动" },
    { id: "support", content: "客户支持" },
    { id: "conversion", content: "转化提升" },
  ];
  const filterModules = (category?: string) => {
    const availableModules = modules.filter((m) => !UI_MODULES[m.moduleKey].disabled);
    if (!category || category === "all") return availableModules;
    return availableModules.filter((m) => UI_MODULES[m.moduleKey].category === category);
  };
  const filteredModules = filterModules(
    selectedTab === 0 ? undefined : tabs[selectedTab].id
  );
  if (!shop) {
    return (
      <Page title="UI 模块配置">
        <Banner tone="critical">
          <Text as="p">未找到店铺信息，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }
  const getRequiredPlan = (moduleKey: ModuleKey): PlanId | undefined => {
    const info = UI_MODULES[moduleKey];
    const planOrder: PlanId[] = ["free", "starter", "growth", "agency"];
    const currentIndex = planOrder.indexOf(shop.plan);
    const requiredIndex = planOrder.indexOf(info.requiredPlan);
    if (currentIndex < requiredIndex) {
      return info.requiredPlan;
    }
    return undefined;
  };
  return (
      <Page
      title="Thank you / Order status 模块"
      subtitle="v1 仅支持：Survey 问卷 + Helpdesk 帮助中心（二选一）• 基于 Customer Accounts UI Extensions，符合 Shopify 官方推荐 • Survey 是官方教程背书的场景 • Migration $49/月"
      primaryAction={{
        content: "刷新",
        onAction: () => revalidator.revalidate(),
        icon: RefreshIcon,
      }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="模块发布流程"
          description="启用模块后，在 Shopify Checkout Editor 中完成发布和配置。"
          items={[
            "Thank you / Order status 双 target 支持",
            "在 Checkout Editor 中配置文案和样式",
            "发布后可回到本页查看状态",
          ]}
          primaryAction={{ content: "查看发布指引", url: "/app/modules/survey/publish" }}
          secondaryAction={{ content: "查看 Audit 报告", url: "/app/audit/report" }}
        />
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200">
                <Text as="h2" variant="headingMd">
                  UI 模块配额
                </Text>
                <Badge tone={canEnableMore ? "success" : "warning"}>
                  {planInfo.name}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {maxModules === -1
                  ? "无限模块"
                  : `已启用 ${enabledCount} / ${maxModules} 个模块`}
              </Text>
            </BlockStack>
            {maxModules !== -1 && !canEnableMore && (
              <Button url="/app/billing" variant="primary">
                升级解锁更多
              </Button>
            )}
          </InlineStack>
        </Card>
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              v1.0 支持范围说明：
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v1.0 已支持</strong>：购后问卷（Survey）、帮助中心（Helpdesk）、再购按钮（Reorder）
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v1.1+ 规划</strong>：物流追踪（Order Tracking）、追加销售（Upsell）模块将在 v1.1+ 版本中提供
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v2.0+ 规划</strong>：第三方物流集成（AfterShip/17Track）将在 v2.0+ 版本中提供
            </Text>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              付费触发点（3个强CTA，直接对应商家的"升级项目交付"）：
            </Text>
            <List type="number">
              <List.Item><strong>启用像素迁移（Test 环境）</strong> → 进入付费试用/订阅（Starter $29/月）</List.Item>
              <List.Item><strong>发布 Thank you/Order status 模块</strong> → 进入付费（Starter $29/月）</List.Item>
              <List.Item><strong>生成验收报告（PDF/CSV）</strong> → 付费（Growth $79/月 或 Agency $199/月）</List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm">
              配置完成后，模块将在对应页面显示（Survey 和 Helpdesk 支持 Thank You 和 Order Status）。注意：Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。
              您需要在 Shopify Admin 的 <strong>Checkout Editor</strong> 中手动添加并发布模块，然后才能在客户侧看到。这是 Shopify 平台的设计限制，模块不会自动显示。必须手动在 Checkout Editor 中放置并发布。
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              快速配置步骤（强烈推荐）：
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  点击上方"一键打开 Checkout Editor（Deep Link）"按钮，直接跳转到编辑器
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  在页面选择器中选择 Thank You 或 Order Status 页面（根据模块 target 选择）。注意：Order Status 页面仅支持 Customer Accounts 体系，如果您的店铺使用旧版订单状态页，请选择 Thank You 页面。
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  点击"添加区块"，找到 Tracking Guardian 应用，选择对应模块并添加
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  使用拖拽功能预览模块在不同位置的显示效果（placement-reference 功能），选择最佳位置
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  确认位置后，点击"保存并发布"
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              💡 提示：使用 deep link 可以快速定位到需要配置的页面，使用 placement-reference 预览功能可以避免发布后才发现位置不合适的问题。这是 Shopify 官方推荐的方式。强烈建议在发布前使用 placement-reference 功能预览不同位置的显示效果，选择最佳放置位置。
            </Text>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  <strong>重要提示：Order Status 模块仅支持 Customer Accounts 体系</strong>
                </Text>
                <Text as="p" variant="bodySm">
                  Order Status 模块使用 <code>customer-account.order-status.block.render</code> target，仅适用于 Customer Accounts 体系下的订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），Order Status 模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                </Text>
                <Text as="p" variant="bodySm">
                  请确认您的店铺已启用 Customer Accounts 功能，否则模块不会在订单状态页显示。您可以在 Shopify Admin → 设置 → 客户账户中检查 Customer Accounts 是否已启用。如果未启用，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后才能使用 Order status 模块。
                </Text>
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
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  文档引用说明：
                </Text>
                <Text as="p" variant="bodySm">
                  Order status block 使用 <code>customer-account.order-status.block.render</code> target，请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                </Text>
              </BlockStack>
            </Banner>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Target 说明：
              </Text>
              <List type="bullet">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    <strong>Thank you block：</strong>使用 <code>purchase.thank-you.block.render</code> target
                  </Text>
                </List.Item>
                <List.Item>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm">
                      <strong>Order status block：</strong>使用 <code>customer-account.order-status.block.render</code> target。
                    </Text>
                    <Banner tone="warning">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          重要：仅适用于 Customer Accounts 体系下的订单状态页
                        </Text>
                        <Text as="p" variant="bodySm">
                          不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
                        </Text>
                        <Text as="p" variant="bodySm">
                          如果您的店铺未启用 Customer Accounts，Order status 模块将无法使用，请先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能。
                        </Text>
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          文档引用说明：
                        </Text>
                        <Text as="p" variant="bodySm">
                          请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                        </Text>
                      </BlockStack>
                    </Banner>
                  </BlockStack>
                </List.Item>
              </List>
            </BlockStack>
            <InlineStack gap="200">
              <Button
                url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                variant="plain"
                size="slim"
                external
              >
                查看 Customer Accounts UI Extensions 文档
              </Button>
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
                跳转到 Thank You 页面
              </Button>
              <Button
                url={`https://admin.shopify.com/store/${shopDomain}/settings/checkout?page=order-status`}
                variant="plain"
                size="slim"
                external
              >
                跳转到 Order Status 页面
              </Button>
            </InlineStack>
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  文档引用说明（避免误导）
                </Text>
                <Text as="p" variant="bodySm">
                  Order status block 使用 <code>customer-account.order-status.block.render</code> target，请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。
                </Text>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  重要：不要参考 checkout-ui-extensions 文档
                </Text>
                <Text as="p" variant="bodySm">
                  checkout-ui-extensions 文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。请务必使用 Customer Accounts UI Extensions 文档作为参考。
                </Text>
              </BlockStack>
            </Banner>
          </BlockStack>
        </Banner>
        {selectedModules.size > 0 && (
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodyMd">
                已选择 {selectedModules.size} 个模块
              </Text>
              <InlineStack gap="200">
                <Button
                  size="slim"
                  onClick={handleBatchEnable}
                  loading={isSubmitting}
                  disabled={!canEnableMore}
                >
                  批量启用
                </Button>
                <Button
                  size="slim"
                  variant="secondary"
                  onClick={handleBatchDisable}
                  loading={isSubmitting}
                >
                  批量停用
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => setSelectedModules(new Set())}
                >
                  取消选择
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        )}
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <Box paddingBlockStart="400">
            <BlockStack gap="400">
              {filteredModules.length === 0 ? (
                <EnhancedEmptyState
                  icon="📦"
                  title="暂无模块"
                  description="此分类下暂无可用模块。"
                  helpText="请选择其他分类查看模块，或等待新模块上线。"
                />
              ) : (
                filteredModules.map((module) => (
                  <ModuleCard
                    key={module.moduleKey}
                    module={module}
                    onToggle={handleToggleModule}
                    isSubmitting={isSubmitting}
                    canEnable={canEnableMore}
                    customerAccountsEnabled={customerAccountsEnabled}
                    upgradeRequired={getRequiredPlan(module.moduleKey)}
                    isSelected={selectedModules.has(module.moduleKey)}
                    onSelect={(moduleKey, selected) => {
                      const newSelected = new Set(selectedModules);
                      if (selected) {
                        newSelected.add(moduleKey);
                      } else {
                        newSelected.delete(moduleKey);
                      }
                      setSelectedModules(newSelected);
                    }}
                    surveySubmissionCount={surveySubmissionCount}
                  />
                ))
              )}
            </BlockStack>
          </Box>
        </Tabs>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              🔗 相关页面
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/settings">平台设置</Button>
              <Button url="/app/audit/report">扫描报告</Button>
              <Button url="/app/migrate">像素迁移</Button>
              <Button url="/app/verification">验收向导</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
