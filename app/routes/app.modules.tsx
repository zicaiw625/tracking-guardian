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
  shopDomain,
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
  shopDomain: string;
}) {
  const info = UI_MODULES[module.moduleKey];
  const hasOrderStatusTarget = info.targets.includes("order_status");
  const showOrderStatusWarning = hasOrderStatusTarget && !customerAccountsEnabled;
  return (
    <Card>
      <BlockStack gap="400">
        {showOrderStatusWarning && (
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="bold">
                ⚠️ 严重：此模块需要 Customer Accounts 才能使用
              </Text>
              <Text as="p" variant="bodySm">
                Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果未启用 Customer Accounts，此模块将完全无法使用，不会在订单状态页显示。这是 Shopify 平台的设计限制，无法绕过。
              </Text>
              <Button
                url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                variant="primary"
                size="slim"
                external
              >
                立即前往启用 Customer Accounts
              </Button>
            </BlockStack>
          </Banner>
        )}
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
                {module.moduleKey === "reorder" && !PCD_CONFIG.APPROVED && (
                  <Banner tone="critical">
                    <BlockStack gap="400">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>⚠️ Reorder 功能需要 Protected Customer Data (PCD) 审核批准</strong>
                      </Text>
                      <Text as="p" variant="bodySm">
                        Reorder 功能当前默认禁用，因为需要访问 Protected Customer Data (PCD)。这是 Shopify 平台的安全和隐私要求，所有访问 PCD 的应用必须通过审核。
                      </Text>
                      <Divider />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>为什么需要 PCD 审核？</strong>
                      </Text>
                      <Text as="p" variant="bodySm">
                        Reorder 功能需要读取客户的订单历史数据（订单 ID、商品信息、价格等），这些数据属于 Shopify 的 Protected Customer Data (PCD) 保护范围。Shopify 要求所有访问 PCD 的应用必须通过审核，确保数据使用符合隐私和安全要求。
                      </Text>
                      <List type="bullet">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            Reorder 功能需要读取客户的订单历史数据（订单 ID、商品信息、价格等）
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            这些数据属于 Shopify 的 Protected Customer Data (PCD) 保护范围
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            Shopify 要求所有访问 PCD 的应用必须通过审核，确保数据使用符合隐私和安全要求
                          </Text>
                        </List.Item>
                      </List>
                      <Divider />
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>📋 如何申请 PCD 审核（详细步骤）</strong>
                      </Text>
                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            ⚠️ 重要：为什么必须申请 PCD 审核？
                          </Text>
                          <Text as="p" variant="bodySm">
                            Reorder 功能需要访问客户的订单历史数据（订单 ID、商品信息、价格等），这些数据属于 Shopify 的 Protected Customer Data (PCD) 保护范围。Shopify 要求所有访问 PCD 的应用必须通过审核，确保数据使用符合隐私和安全要求。未通过审核的应用无法访问客户订单历史等 PCD 数据。
                          </Text>
                          <Text as="p" variant="bodySm">
                            <strong>合规要求：</strong>这是 Shopify 平台的安全和隐私要求，不是可选功能。所有访问 PCD 的应用必须通过审核，否则功能将被禁用。
                          </Text>
                        </BlockStack>
                      </Banner>
                      <List type="number">
                        <List.Item>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              步骤 1：访问 Shopify Partner Dashboard
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              登录 <a href="https://partners.shopify.com" target="_blank" rel="noopener noreferrer">Shopify Partner Dashboard</a>，进入"应用" → 选择您的应用 → 点击"Protected Customer Data"选项
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              💡 提示：如果找不到"Protected Customer Data"选项，请确认您有应用的管理权限，或联系应用所有者
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              📍 位置说明：在 Partner Dashboard 中，进入"应用"页面，选择您的应用，然后在左侧导航栏中找到"Protected Customer Data"选项
                            </Text>
                          </BlockStack>
                        </List.Item>
                        <List.Item>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              步骤 2：填写 PCD 使用申请表
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              详细说明 Reorder 功能的数据使用场景：
                            </Text>
                            <List type="bullet">
                              <List.Item>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  功能用途：允许客户快速重新购买之前的订单商品
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  数据访问范围：仅访问订单 ID、商品信息、价格等必要数据
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  数据使用方式：仅用于生成重新购买链接，不存储或分享给第三方
                                </Text>
                              </List.Item>
                            </List>
                            <Text as="span" variant="bodySm" tone="subdued">
                              📖 参考文档：<a href="https://shopify.dev/docs/apps/store/data-protection/protected-customer-data" target="_blank" rel="noopener noreferrer">Shopify Protected Customer Data 官方文档</a>
                            </Text>
                          </BlockStack>
                        </List.Item>
                        <List.Item>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              步骤 3：等待 Shopify 审核
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              审核通常需要 1-2 周时间。Shopify 会审查您的申请，确保数据使用符合隐私和安全要求
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              💡 提示：审核期间，您可以在 Partner Dashboard 中查看申请状态。如有疑问，可联系 Shopify Partner Support
                            </Text>
                          </BlockStack>
                        </List.Item>
                        <List.Item>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              步骤 4：审核通过后启用功能
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              审核通过后，联系技术支持或设置环境变量 <code>PCD_APPROVED=true</code> 以启用 Reorder 功能
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              💡 提示：启用后，请测试 Reorder 功能，确认客户信息正常显示。如果遇到客户信息为 null 的情况，请先确认 PCD 权限是否已获批
                            </Text>
                          </BlockStack>
                        </List.Item>
                      </List>
                      <Divider />
                      <InlineStack gap="200" align="start">
                        <Button
                          url="https://partners.shopify.com"
                          variant="primary"
                          external
                        >
                          前往 Shopify Partner Dashboard 申请 PCD 审核
                        </Button>
                        <Button
                          url="https://shopify.dev/docs/apps/store/data-protection/protected-customer-data"
                          variant="secondary"
                          external
                        >
                          查看 PCD 官方文档
                        </Button>
                      </InlineStack>
                      <Divider />
                      <Banner tone="info">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            📖 申请 PCD 审核的常见问题
                          </Text>
                          <List type="bullet">
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                <strong>Q: 为什么必须申请 PCD 审核？</strong> A: Shopify 要求所有访问 Protected Customer Data 的应用必须通过审核，这是平台的安全和隐私要求。未通过审核的应用无法访问客户订单历史等 PCD 数据。
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                <strong>Q: 审核需要多长时间？</strong> A: 通常需要 1-2 周时间。Shopify 会审查您的申请，确保数据使用符合隐私和安全要求。
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                <strong>Q: 审核通过后如何启用功能？</strong> A: 审核通过后，联系技术支持或设置环境变量 <code>PCD_APPROVED=true</code> 以启用 Reorder 功能。
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                <strong>Q: 如果审核被拒绝怎么办？</strong> A: 如果审核被拒绝，Shopify 会提供拒绝原因。请根据反馈修改申请，重新提交审核。
                              </Text>
                            </List.Item>
                            <List.Item>
                              <Text as="span" variant="bodySm">
                                <strong>Q: 申请过程中可以继续使用其他功能吗？</strong> A: 可以。PCD 审核仅影响 Reorder 功能，其他功能（如 Survey、Helpdesk）不受影响。
                              </Text>
                            </List.Item>
                          </List>
                        </BlockStack>
                      </Banner>
                    </BlockStack>
                  </Banner>
                )}
                {info.targets.includes("order_status") && (
                  <Banner tone={customerAccountsEnabled ? "info" : "critical"}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {customerAccountsEnabled ? "✅ Customer Accounts 已启用" : "❌ Customer Accounts 未启用 - 模块无法使用"}
                          </Text>
                          {!customerAccountsEnabled && (
                            <>
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                <strong>⚠️ 重要限制：</strong>Order Status 模块仅支持 Customer Accounts 体系
                              </Text>
                              <Text as="p" variant="bodySm">
                                Order Status 模块使用 <code>customer-account.order-status.block.render</code> target，这是 Shopify Customer Accounts UI Extensions 的专用 target。此模块<strong>仅在 Customer Accounts 体系下的订单状态页显示</strong>，不会在旧版订单状态页显示。
                              </Text>
                              <Text as="p" variant="bodySm">
                                <strong>平台限制说明：</strong>这是 Shopify 平台的设计限制，不是本应用的限制。Order status block target 是 Customer Accounts UI Extensions 的功能，只能在启用 Customer Accounts 的店铺中使用。
                              </Text>
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                立即启用步骤：
                              </Text>
                              <List type="number">
                                <List.Item>
                                  <Text as="span" variant="bodySm">
                                    点击右侧"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                                  </Text>
                                </List.Item>
                                <List.Item>
                                  <Text as="span" variant="bodySm">
                                    在"客户账户"设置页面中启用 Customer Accounts 功能
                                  </Text>
                                </List.Item>
                                <List.Item>
                                  <Text as="span" variant="bodySm">
                                    返回本页面，刷新后即可启用 Order Status 模块
                                  </Text>
                                </List.Item>
                              </List>
                              <Text as="p" variant="bodySm" tone="subdued">
                                💡 提示：如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请先在 Shopify Admin 中启用 Customer Accounts 功能。
                              </Text>
                            </>
                          )}
                          {customerAccountsEnabled && (
                            <Text as="p" variant="bodySm">
                              ✅ 您的店铺已启用 Customer Accounts，Order Status 模块可以正常使用。模块将显示在 Customer Accounts 体系下的订单状态页。
                            </Text>
                          )}
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            文档引用说明：
                          </Text>
                          <Text as="p" variant="bodySm">
                            请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
                          </Text>
                        </BlockStack>
                        {!customerAccountsEnabled && (
                          <Button
                            url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                            variant="primary"
                            size="large"
                            external
                          >
                            立即前往启用 Customer Accounts
                          </Button>
                        )}
                      </InlineStack>
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
  const hasOrderStatusModules = modules.some(m => UI_MODULES[m.moduleKey].targets.includes("order_status"));
  const orderStatusWarning = hasOrderStatusModules && !customerAccountsEnabled;
  const anyModuleHasOrderStatusTarget = modules.some(m => UI_MODULES[m.moduleKey].targets.includes("order_status"));
  return (
      <Page
      title="Thank you / Order status 模块"
      subtitle={orderStatusWarning ? "⚠️ 严重：Order Status 模块无法使用 - 必须启用 Customer Accounts（仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过）" : "v1 仅支持：Survey 问卷 + Helpdesk 帮助中心（二选一）• 基于 Customer Accounts UI Extensions，符合 Shopify 官方推荐 • Survey 是官方教程背书的场景 • Migration $49/月"}
      primaryAction={{
        content: "刷新",
        onAction: () => revalidator.revalidate(),
        icon: RefreshIcon,
      }}
    >
      <BlockStack gap="500">
        {anyModuleHasOrderStatusTarget && !customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="400">
              <Text as="p" variant="headingLg" fontWeight="bold">
                ⚠️ 严重警告：Order Status 模块无法使用 - 必须启用 Customer Accounts
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="bold" tone="critical">
                这是 Shopify 平台的设计限制，无法绕过。Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                <strong>检测到您的店铺未启用 Customer Accounts 功能。</strong>Order Status 模块（订单状态页模块）仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果未启用 Customer Accounts，Order Status 模块将完全无法使用，不会在订单状态页显示。
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                <strong>这是 Shopify 平台的设计限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                <strong>影响范围：</strong>所有支持 <code>order_status</code> target 的模块（包括 Survey 问卷、Helpdesk 帮助中心、Reorder 再购按钮等）都需要 Customer Accounts 才能正常工作。如果未启用 Customer Accounts，这些模块在订单状态页将不会显示。
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                立即启用步骤（3 步）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodyMd">
                    点击下方"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd">
                    在"客户账户"设置页面中启用 Customer Accounts 功能
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodyMd">
                    返回本页面，点击右上角"刷新"按钮更新状态，然后即可正常使用 Order Status 模块
                  </Text>
                </List.Item>
              </List>
              <InlineStack gap="200">
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="large"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
                <Button
                  url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                  variant="secondary"
                  size="medium"
                  external
                >
                  查看官方文档
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {!customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="headingMd" fontWeight="bold">
                ⚠️ 重要提示：Order Status 模块需要 Customer Accounts 功能
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>检测到您的店铺未启用 Customer Accounts 功能。</strong>如果您计划使用 Order Status 模块（订单状态页模块），必须先启用 Customer Accounts 功能。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>重要限制：</strong>Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果您的店铺未启用 Customer Accounts，Order Status 模块将完全无法使用，不会在订单状态页显示。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>这是 Shopify 平台的设计限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                启用步骤（3 步）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    点击下方"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在"客户账户"设置页面中启用 Customer Accounts 功能
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    返回本页面，点击右上角"刷新"按钮更新状态
                  </Text>
                </List.Item>
              </List>
              <InlineStack gap="200">
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="large"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
                <Button
                  url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                  variant="secondary"
                  size="medium"
                  external
                >
                  查看官方文档
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {hasOrderStatusModules && !customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="headingMd" fontWeight="bold">
                ⚠️ 严重警告：Order Status 模块无法使用 - 必须启用 Customer Accounts
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>检测到您已启用或尝试启用 Order Status 模块，但您的店铺尚未启用 Customer Accounts 功能。</strong>
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>重要限制：</strong>Order Status 模块（订单状态页模块）仅支持 Customer Accounts 体系，不支持旧版订单状态页。如果您的店铺未启用 Customer Accounts，Order Status 模块将完全无法使用，不会在订单状态页显示。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>这是 Shopify 平台的设计限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                立即启用步骤（3 步）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    点击下方"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在"客户账户"设置页面中启用 Customer Accounts 功能
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    返回本页面，点击右上角"刷新"按钮更新状态，然后即可正常使用 Order Status 模块
                  </Text>
                </List.Item>
              </List>
              <InlineStack gap="200">
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="large"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
                <Button
                  url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                  variant="secondary"
                  size="medium"
                  external
                >
                  查看官方文档
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {!customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="headingSm" fontWeight="bold">
                ❌ 严重：Order Status 模块无法使用 - 必须启用 Customer Accounts
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>重要限制：</strong>Order Status 模块（订单状态页模块）仅支持 Customer Accounts 体系，不支持旧版订单状态页。如果您的店铺未启用 Customer Accounts，Order Status 模块将完全无法使用，不会在订单状态页显示。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                <strong>这是 Shopify 平台的设计限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                如果您计划使用 Order Status 模块，请先启用 Customer Accounts：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    点击下方"前往启用 Customer Accounts"按钮，或手动进入 Shopify Admin → 设置 → 客户账户
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在"客户账户"设置页面中启用 Customer Accounts 功能
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    返回本页面，点击右上角"刷新"按钮更新状态
                  </Text>
                </List.Item>
              </List>
              <InlineStack gap="200">
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="medium"
                  external
                >
                  前往启用 Customer Accounts
                </Button>
                <Button
                  url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                  variant="secondary"
                  size="medium"
                  external
                >
                  查看官方文档
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {hasOrderStatusModules && !customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="300">
                  <Text as="p" variant="headingSm" fontWeight="bold">
                    ⚠️ 重要：Order Status 模块需要启用 Customer Accounts
                  </Text>
                  <Text as="p" variant="bodySm">
                    检测到您已启用或尝试启用 Order Status 模块，但您的店铺尚未启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不会在旧版订单状态页显示。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <strong>这是 Shopify 平台的设计限制，不是应用限制。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    立即启用步骤（3 步）：
                  </Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        点击右侧"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        在"客户账户"设置页面中启用 Customer Accounts 功能
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        返回本页面，点击右上角"刷新"按钮更新状态，然后即可正常使用 Order Status 模块
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="large"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {!customerAccountsEnabled && (
          <Banner tone="warning">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ 前置提示：Order Status 模块仅支持 Customer Accounts 体系
              </Text>
              <Text as="p" variant="bodySm">
                如果您计划使用 Order Status 模块（订单状态页模块），请先确认您的店铺已启用 Customer Accounts 功能。Order Status 模块使用 <code>customer-account.order-status.block.render</code> target，这是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。
              </Text>
              <Text as="p" variant="bodySm">
                如果您的店铺未启用 Customer Accounts，Order Status 模块将无法使用。这是 Shopify 平台的设计限制，不是应用限制。
              </Text>
              <InlineStack gap="200">
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="medium"
                  external
                >
                  前往启用 Customer Accounts
                </Button>
                <Button
                  url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions"
                  variant="secondary"
                  size="medium"
                  external
                >
                  查看官方文档
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasOrderStatusModules && !customerAccountsEnabled && (
          <Banner tone="critical">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="300">
                  <Text as="p" variant="headingSm" fontWeight="bold">
                    ⚠️ 重要：Order Status 模块需要启用 Customer Accounts
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>检测到您的店铺未启用 Customer Accounts 功能。</strong>Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果未启用 Customer Accounts，Order Status 模块将无法使用。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <strong>这是 Shopify 平台的设计限制，不是应用限制。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>影响范围：</strong>所有支持 <code>order_status</code> target 的模块（包括 Survey 问卷、Helpdesk 帮助中心、Reorder 再购按钮等）都需要 Customer Accounts 才能正常工作。如果未启用 Customer Accounts，这些模块在订单状态页将不会显示。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    立即操作（3 步）：
                  </Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        点击右侧"立即前往启用 Customer Accounts"按钮，直接跳转到 Shopify Admin 设置页面
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        在"客户账户"设置页面中启用 Customer Accounts 功能
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        返回本页面，点击右上角"刷新"按钮更新状态，然后即可启用 Order Status 模块
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
                <Button
                  url={`https://admin.shopify.com/store/${shopDomain}/settings/customer-accounts`}
                  variant="primary"
                  size="large"
                  external
                >
                  立即前往启用 Customer Accounts
                </Button>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  如何检查店铺是否支持 Customer Accounts：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果 Shopify Admin → 设置中没有"客户账户"或"Customer Accounts"选项，说明您的店铺当前不支持 Customer Accounts 功能
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      某些地区、店铺类型或 Shopify 计划可能暂时不支持 Customer Accounts，请以 Shopify Admin 中的实际选项为准
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果支持但未启用：请按照 Shopify 官方指引启用 Customer Accounts 功能。启用后，订单状态页将自动切换到 Customer Accounts 体系，旧版订单状态页将不再使用
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果店铺不支持 Customer Accounts：Order Status 模块将无法使用。这是 Shopify 平台的设计限制，Order Status 模块只能在 Customer Accounts 体系下工作
                    </Text>
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  💡 提示：如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请先在 Shopify Admin 中启用 Customer Accounts 功能。系统会在您刷新页面时自动检测 Customer Accounts 状态。
                </Text>
              </BlockStack>
            </BlockStack>
          </Banner>
        )}
        {modules.some(m => UI_MODULES[m.moduleKey].targets.includes("order_status")) && customerAccountsEnabled && (
          <Banner tone="success">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ Customer Accounts 已启用 - Order Status 模块可用
              </Text>
              <Text as="p" variant="bodySm">
                您的店铺已启用 Customer Accounts，Order Status 模块可以正常使用。模块将显示在 Customer Accounts 体系下的订单状态页。
              </Text>
            </BlockStack>
          </Banner>
        )}
        <PageIntroCard
          title="模块发布流程"
          description={hasOrderStatusModules && !customerAccountsEnabled ? "⚠️ 严重：Order Status 模块无法使用 - 必须启用 Customer Accounts（仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过）。启用模块后，在 Shopify Checkout Editor 中完成发布和配置。" : "启用模块后，在 Shopify Checkout Editor 中完成发布和配置。"}
          items={[
            "Thank you / Order status 双 target 支持",
            hasOrderStatusModules && !customerAccountsEnabled ? "⚠️ 严重：Order Status 模块需要 Customer Accounts（仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过）" : "在 Checkout Editor 中配置文案和样式",
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
                  文档引用说明（避免误导）：
                </Text>
                <Text as="p" variant="bodySm">
                  Order status block 使用 <code>customer-account.order-status.block.render</code> target，请参考 <strong>Customer Accounts UI Extensions</strong> 官方文档（<a href="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" target="_blank" rel="noopener noreferrer">https://shopify.dev/docs/apps/customer-accounts/ui-extensions</a>）。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。正确的文档入口是 Customer Accounts UI Extensions，不是 Checkout UI Extensions。
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
                    shopDomain={shopDomain}
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
        </Layout.Section>
      </Layout>
      </BlockStack>
    </Page>
  );
}
