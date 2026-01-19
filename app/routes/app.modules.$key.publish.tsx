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
import { UI_MODULES, type ModuleKey, validateModuleTargets } from "../types/ui-extension";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { checkCustomerAccountsEnabled } from "../services/customer-accounts.server";
import { logger } from "../utils/logger.server";
import { getShopifyAdminUrl } from "../utils/helpers";
import { PCD_ORDER_UNAVAILABLE_MERCHANT } from "~/constants/pcd";
import * as fs from "fs";
import * as path from "path";

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
  const targetValidation = validateModuleTargets(moduleKey, moduleInfo.targets);
  if (!targetValidation.valid) {
    throw new Response(`模块 target 配置无效: ${targetValidation.errors.join(", ")}`, { status: 400 });
  }
  if (targetValidation.warnings.length > 0) {
    logger.warn(`模块 ${moduleKey} target 警告:`, { warnings: targetValidation.warnings });
  }
  const hasOrderStatusTarget = moduleInfo.targets.includes("order_status");
  let customerAccountsStatus = null;
  if (hasOrderStatusTarget) {
    customerAccountsStatus = await checkCustomerAccountsEnabled(admin);
  }
  let networkAccessConfigured = false;
  let networkAccessCheckError: string | null = null;
  try {
    const extensionConfigPath = path.join(process.cwd(), "extensions/thank-you-blocks/shopify.extension.toml");
    if (fs.existsSync(extensionConfigPath)) {
      const content = fs.readFileSync(extensionConfigPath, "utf-8");
      networkAccessConfigured = content.includes("network_access = true") || 
                                content.includes("network_access=true") ||
                                /network_access\s*=\s*true/.test(content);
    }
  } catch (error) {
    networkAccessCheckError = error instanceof Error ? error.message : String(error);
  }
  let backendUrlInjected = true;
  let backendUrlCheckError: string | null = null;
  const configFiles = [
    { path: "extensions/shared/config.ts", label: "Shared config" },
    { path: "extensions/thank-you-blocks/src/config.ts", label: "Thank-you blocks config" },
  ];
  try {
    const placeholderPattern = /__BACKEND_URL_PLACEHOLDER__/;
    const buildTimeUrlPattern = /const\s+BUILD_TIME_URL\s*=\s*(["'])([^"']+)\1;/;
    for (const configFile of configFiles) {
      const filePath = path.join(process.cwd(), configFile.path);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const match = content.match(buildTimeUrlPattern);
        if (match) {
          const urlValue = match[2];
          if (placeholderPattern.test(urlValue)) {
            backendUrlInjected = false;
            backendUrlCheckError = `${configFile.label}: URL 仍为占位符，需要在部署前运行 'pnpm ext:inject' 或 'pnpm deploy:ext'。这是严重的配置错误，如果占位符未被替换，扩展将无法发送事件到后端，导致功能无法正常工作。必须在生产环境部署前修复。`;
            break;
          }
        }
      }
    }
  } catch (error) {
    backendUrlCheckError = error instanceof Error ? error.message : String(error);
  }
  return json({
    moduleKey,
    moduleName: moduleInfo.name,
    targets: moduleInfo.targets,
    shopDomain,
    customerAccountsStatus,
    hasOrderStatusTarget,
    networkAccessConfigured,
    networkAccessCheckError,
    backendUrlInjected,
    backendUrlCheckError,
  });
};

export default function UiModulePublishGuide() {
  const { moduleName, targets, shopDomain, customerAccountsStatus, hasOrderStatusTarget, networkAccessConfigured, networkAccessCheckError, backendUrlInjected, backendUrlCheckError } = useLoaderData<typeof loader>();
  const targetCards = targets.map((target) => TARGET_DETAILS[target]);
  const orderStatusTarget = targetCards.find((card) => card.target === "customer-account.order-status.block.render");
  const customerAccountsEnabled = customerAccountsStatus?.enabled ?? false;
  const canPublishOrderStatus = !hasOrderStatusTarget || customerAccountsEnabled;
  const orderStatusBlocked = hasOrderStatusTarget && !customerAccountsEnabled;
  return (
    <Page
      title={`${moduleName} 发布指引`}
      subtitle={orderStatusBlocked ? "❌ 严重：无法发布 - Order Status 模块需要启用 Customer Accounts（仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过。必须先在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，否则模块将无法显示）" : "在 Shopify Checkout Editor 中放置应用 block 并完成发布"}
      backAction={{ content: "返回模块列表", url: "/app/modules" }}
      primaryAction={orderStatusBlocked ? {
        content: "前往启用 Customer Accounts",
        url: getShopifyAdminUrl(shopDomain, "/settings/customer-accounts"),
        external: true,
      } : undefined}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasOrderStatusTarget && !customerAccountsEnabled && (
              <Banner tone="critical">
                <BlockStack gap="400">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    ⚠️ 严重警告：无法发布 Order Status 模块 - 必须启用 Customer Accounts
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    <strong>检测到您尝试发布 Order Status 模块，但您的店铺尚未启用 Customer Accounts 功能。</strong>
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    <strong>严重限制：Order Status 模块仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过。如果未启用 Customer Accounts，模块将完全无法使用，不会在订单状态页显示。</strong>
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    <strong>这是 Shopify 平台的设计限制，不是应用限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
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
                        返回本页面，刷新后即可发布 Order Status 模块
                      </Text>
                    </List.Item>
                  </List>
                  <InlineStack gap="200">
                    <Button
                      url={getShopifyAdminUrl(shopDomain, "/settings/customer-accounts")}
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
                        返回本页面，刷新后即可发布 Order Status 模块
                      </Text>
                    </List.Item>
                  </List>
                  <InlineStack gap="200">
                    <Button
                      url={getShopifyAdminUrl(shopDomain, "/settings/customer-accounts")}
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
            {hasOrderStatusTarget && !customerAccountsEnabled && (
              <Banner tone="critical">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="300">
                      <Text as="p" variant="headingMd" fontWeight="bold">
                        ⚠️ 严重警告：无法发布 Order Status 模块 - 必须启用 Customer Accounts
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
                        <strong>检测到您尝试发布 Order Status 模块，但您的店铺尚未启用 Customer Accounts 功能。</strong>
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
                        <strong>严重限制：Order Status 模块仅支持 Customer Accounts 体系，不支持旧版订单状态页。这是 Shopify 平台的设计限制，无法绕过。如果未启用 Customer Accounts，模块将完全无法使用，不会在订单状态页显示。</strong>
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>检测到您的店铺未启用 Customer Accounts 功能。</strong>Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果未启用 Customer Accounts，Order Status 模块将无法使用，不会显示。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>这是 Shopify 平台的设计限制，不是应用限制，无法绕过。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。如果未启用 Customer Accounts，模块将不会显示，这是平台级别的限制。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>影响范围：</strong>所有支持 <code>order_status</code> target 的模块（包括 Survey 问卷、Helpdesk 帮助中心、Reorder 再购按钮等）都需要 Customer Accounts 才能正常工作。如果未启用 Customer Accounts，这些模块在订单状态页将不会显示。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        解决方案：请在 Shopify Admin → 设置 → 客户账户中启用 Customer Accounts 功能，然后重新访问此页面。
                      </Text>
                    </BlockStack>
                    <Button
                      url={getShopifyAdminUrl(shopDomain, "/settings/customer-accounts")}
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
                      启用步骤（3 步）：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          点击上方"立即前往启用 Customer Accounts"按钮，或手动进入 Shopify Admin → 设置 → 客户账户（Settings → Customer accounts）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          在"客户账户"设置页面中启用 Customer Accounts 功能
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          返回本页面，刷新后即可发布 Order Status 模块
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
            <PageIntroCard
              title="发布步骤概览"
              description={hasOrderStatusTarget && !customerAccountsEnabled ? "⚠️ 无法发布：Order Status 模块需要启用 Customer Accounts（仅支持 Customer Accounts 体系，不支持旧版订单状态页）。将模块添加到 Checkout Editor 并发布，确保客户侧可见。" : "将模块添加到 Checkout Editor 并发布，确保客户侧可见。"}
              items={[
                hasOrderStatusTarget && !customerAccountsEnabled ? "⚠️ Order Status 模块需要 Customer Accounts（仅支持 Customer Accounts 体系）" : "选择正确的 target 页面",
                "完成配置后点击发布",
                "发布完成可回到模块列表查看状态",
              ]}
              primaryAction={{ content: "返回模块列表", url: "/app/modules" }}
            />
            {!backendUrlInjected && (
              <Banner tone="critical">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ 严重：BACKEND_URL 未注入 - 扩展无法正常工作
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>检测到扩展的 BACKEND_URL 仍为占位符，未正确注入。</strong>如果占位符未被替换，扩展将无法发送事件到后端，导致功能完全无法正常工作。这是导致事件丢失和功能失效的常见原因。
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    立即修复（必须在发布前完成）：
                  </Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        在项目根目录运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code> 命令
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        验证配置文件中的 BACKEND_URL 已从占位符替换为实际 URL
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        重新部署扩展：<code>shopify app deploy</code> 或使用 <code>pnpm deploy:ext</code>
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 提示：<strong>扩展的 BACKEND_URL 注入是生命线</strong>。如果占位符未被替换，扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。请在 CI/CD 流程中确保运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>。
                  </Text>
                  {backendUrlCheckError && (
                    <Text as="p" variant="bodySm" tone="critical">
                      {backendUrlCheckError}
                    </Text>
                  )}
                </BlockStack>
              </Banner>
            )}
            {backendUrlInjected && (
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ✅ BACKEND_URL 已正确注入
                  </Text>
                  <Text as="p" variant="bodySm">
                    扩展的 BACKEND_URL 已正确注入。生产环境部署时，请确保始终使用 <code>pnpm deploy:ext</code> 命令，该命令会自动执行 <code>pnpm ext:inject</code> 注入 BACKEND_URL。禁止直接使用 <code>shopify app deploy</code>。
                  </Text>
                </BlockStack>
              </Banner>
            )}
            {!canPublishOrderStatus && (
              <Banner tone="critical">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        <strong>⚠️ 无法发布 Order Status 模块 - 需要启用 Customer Accounts</strong>
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>检测到您的店铺未启用 Customer Accounts 功能。</strong>Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果未启用 Customer Accounts，Order Status 模块将无法使用。
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>这是 Shopify 平台的设计限制，不是应用限制。</strong>Order status block target 是 Customer Accounts UI Extensions 的专用功能，只能在启用 Customer Accounts 的店铺中使用。
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
                    <Button
                      url={getShopifyAdminUrl(shopDomain, "/settings/customer-accounts")}
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
                      启用步骤：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          点击上方"立即前往启用 Customer Accounts"按钮，或手动进入 Shopify Admin → 设置 → 客户账户（Settings → Customer accounts）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          在"客户账户"设置页面中启用 Customer Accounts 功能
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          返回本页面，刷新后即可发布 Order Status 模块
                        </Text>
                      </List.Item>
                    </List>
                  </BlockStack>
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
                                    <strong>⚠️ 未启用 Customer Accounts（Order status block 仅在 Customer Accounts 体系下生效）</strong>
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    检测到您的店铺未启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页，当前无法使用。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
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
                                    <strong>✅ Customer Accounts 已启用（Order status block 仅在 Customer Accounts 体系下生效）</strong>
                                  </Text>
                                  <Text as="p" variant="bodySm">
                                    <strong>Order status 模块：</strong>使用 <code>customer-account.order-status.block.render</code> target，仅适用于 Customer Accounts 体系下的订单状态页。旧版订单状态页（非 Customer Accounts）不会显示此模块。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。
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
                        💡 提示：您也可以直接访问 <code>{getShopifyAdminUrl(shopDomain, "/settings/checkout")}</code> 并点击"Checkout Editor"按钮。
                      </Text>
                      <InlineStack gap="200">
                        <Button
                          url={getShopifyAdminUrl(shopDomain, "/settings/checkout")}
                          variant="primary"
                          size="medium"
                          external
                        >
                          一键打开 Checkout Editor（Deep Link）
                        </Button>
                        <Button
                          url={getShopifyAdminUrl(shopDomain, "/settings/checkout?page=thank-you")}
                          variant="plain"
                          size="slim"
                          external
                        >
                          直接跳转到 Thank You 页面
                        </Button>
                        <Button
                          url={getShopifyAdminUrl(shopDomain, "/settings/checkout?page=order-status")}
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
                    <Text as="p" variant="bodySm" tone="critical">
                      <strong>重要提示：</strong>Order status block 仅在 Customer Accounts 体系下生效。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。这是 Shopify 平台的设计限制，无法绕过。请务必在发布前确认您的店铺已启用 Customer Accounts 功能。
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
                {hasOrderStatusTarget && (
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        ⚠️ Order status 模块限制说明（重要：仅支持 Customer Accounts 体系）
                      </Text>
                      <Text as="p" variant="bodySm">
                        Order status 模块仅支持 Customer Accounts 体系下的订单状态页，不支持旧版订单状态页。如果您的店铺使用旧版订单状态页（非 Customer Accounts），此模块将不会显示。请确认您的店铺已启用 Customer Accounts 功能（可在 Shopify Admin → 设置 → 客户账户中检查），否则模块不会在订单状态页显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。
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
                  {hasOrderStatusTarget && (
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>重要：</strong>确认店铺已启用 Customer Accounts 功能（Order status 模块仅支持 Customer Accounts 体系，不支持旧版订单状态页）。如果未启用，Order status 模块将不会显示。这是 Shopify 平台的设计限制，Order status 模块只能在 Customer Accounts 体系下工作。请参考 Customer Accounts UI Extensions 官方文档，不要参考 checkout-ui-extensions 文档（该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导）。
                      </Text>
                    </List.Item>
                  )}
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      确认模块位置符合设计要求（避免遮挡重要信息）。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>发布前必须验证（关键步骤）：</strong>确认已在 Partner Dashboard → App → API access → UI extensions network access 中批准该权限。如果未批准，即使配置了 <code>network_access = true</code>，部署也会失败或模块无法正常工作。这是上线前必须验证的关键配置，必须在发布前完成检查。如果 Partner Dashboard 没点"Allow network access"，部署会卡住。建议运行 <code>pnpm pre-deploy-check</code> 或 <code>pnpm validate-deployment</code> 脚本进行验证。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>发布前必须执行（关键步骤）：</strong>运行 <code>pnpm pre-deploy-check</code> 脚本验证 network access 配置。该脚本会检查扩展配置中的 <code>network_access = true</code> 设置，并提醒您确认 Partner Dashboard 中的批准状态。如果脚本检测到配置问题，请修复后再发布。如果 Partner Dashboard 未批准 network access 权限，部署会卡住或失败。这是发布前必须验证的关键配置，必须在发布前完成检查。
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      发布后使用测试订单或测试结账流程验证模块是否正常显示和功能是否正常。
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                <Banner tone={networkAccessConfigured ? "info" : "critical"}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      ⚠️ Network Access 权限检查（必须执行，发布前必须验证）
                    </Text>
                    {networkAccessCheckError ? (
                      <Text as="p" variant="bodySm" tone="critical">
                        检查配置时出错：{networkAccessCheckError}
                      </Text>
                    ) : networkAccessConfigured ? (
                      <>
                        <Text as="p" variant="bodySm">
                          前台 block 需要 network access 权限才能调用后端 API。扩展配置中已设置 <code>network_access = true</code>，但必须确保在 Partner Dashboard 中已批准该权限，否则部署会失败或模块无法正常工作。
                        </Text>
                    <Text as="p" variant="bodySm" tone="critical" fontWeight="semibold">
                      <strong>重要：</strong>仅配置 <code>network_access = true</code> 是不够的，必须在 Partner Dashboard → App → API access → UI extensions network access 中批准该权限。如果 Partner Dashboard 未批准，即使配置正确，部署也会失败或模块无法正常工作。如果 Partner Dashboard 没点"Allow network access"，部署会卡住。这是发布前必须验证的关键配置，必须在发布前完成检查。
                    </Text>
                      </>
                    ) : (
                      <Text as="p" variant="bodySm" tone="critical">
                        <strong>错误：</strong>扩展配置中缺少 <code>network_access = true</code>，前台 block 无法调用后端 API。请在 <code>extensions/thank-you-blocks/shopify.extension.toml</code> 中添加 <code>[extensions.capabilities]</code> 部分和 <code>network_access = true</code>，并在 Partner Dashboard 中批准该权限。
                      </Text>
                    )}
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      检查步骤（必须在发布前完成）：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          前往 Partner Dashboard → 您的应用 → API access
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          找到 "UI extensions network access" 部分
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>确认 network access 权限已批准（显示为 "Approved" 或 "已批准"）</strong>。如果显示为 "Pending" 或 "未批准"，请等待审核完成。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          如果未批准，请点击 "Request" 或 "请求" 按钮申请权限
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          等待 Shopify 审核批准（通常需要 1-3 个工作日）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>发布前必须确认权限已批准，否则部署会失败</strong>
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="critical" fontWeight="semibold">
                      <strong>警告：</strong>如果 Partner Dashboard → App → API access → UI extensions network access 中未批准该权限，即使扩展配置中设置了 <code>network_access = true</code>，部署也会失败或模块无法正常工作。如果 Partner Dashboard 没点"Allow network access"，部署会卡住。这是上线前必须验证的关键配置，必须在发布前完成检查。建议在发布前截图保存 Partner Dashboard 中的批准状态作为证据。强烈建议运行 <code>pnpm pre-deploy-check</code> 或 <code>pnpm validate-deployment</code> 脚本进行验证，这些脚本会检查 network access 配置并提醒您确认 Partner Dashboard 中的批准状态。
                    </Text>
                  </BlockStack>
                </Banner>
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
                          通用入口：<code>{getShopifyAdminUrl(shopDomain, "/settings/checkout")}</code>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          直接定位到 Thank You 页面：<code>{getShopifyAdminUrl(shopDomain, "/settings/checkout?page=thank-you")}</code>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          直接定位到 Order Status 页面（Customer Accounts）：<code>{getShopifyAdminUrl(shopDomain, "/settings/checkout?page=order-status")}</code>
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
                          {PCD_ORDER_UNAVAILABLE_MERCHANT}
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
