import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { Suspense, lazy, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  Link,
  List,
} from "@shopify/polaris";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { validateTestEnvironment } from "~/services/migration-wizard.server";
import { normalizePlanId, planSupportsFeature } from "~/services/billing/plans";
import { getPixelEventIngestionUrl } from "~/utils/config.server";

const RealtimeEventMonitor = lazy(() => import("~/components/verification/RealtimeEventMonitor").then(module => ({
  default: module.RealtimeEventMonitor,
})));

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    throw new Response("Missing pixel config id", { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, plan: true },
  });
  if (!shop) {
    return json({ shop: null, pixelConfig: null, hasVerificationAccess: false, backendUrlInfo: { url: "", usage: "none" } });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: {
      id: true,
      platform: true,
      environment: true,
      configVersion: true,
      platformId: true,
    },
  });
  if (!pixelConfig) {
    throw new Response("Pixel config not found", { status: 404 });
  }
  const planId = normalizePlanId(shop.plan ?? "free");
  const hasVerificationAccess = planSupportsFeature(planId, "verification");
    if (!hasVerificationAccess) {
    const { trackEvent } = await import("~/services/analytics.server");
    const { safeFireAndForget } = await import("~/utils/helpers.server");
    safeFireAndForget(
            trackEvent({
        shopId: shop.id,
        shopDomain: shop.shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "pixels_test",
          plan: shop.plan ?? "free",
          pixelConfigId: pixelConfigId,
          environment: pixelConfig?.environment || "test",
        },
      })
    );
  }
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfig,
    hasVerificationAccess,
    backendUrlInfo,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    return json({ success: false, error: "缺少配置 ID" }, { status: 400 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: { platform: true },
  });
  if (!pixelConfig) {
    return json({ success: false, error: "配置不存在" }, { status: 404 });
  }
  if (actionType === "validateTestEnvironment") {
    const platform = pixelConfig.platform;
    if (!["google", "meta", "tiktok"].includes(platform)) {
      return json({
        success: false,
        error: "当前仅支持 GA4、Meta、TikTok 的测试环境验证。",
      }, { status: 400 });
    }
    try {
      const result = await validateTestEnvironment(shop.id, platform as "google" | "meta" | "tiktok");
      return json({ success: true, ...result });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "验证失败",
      }, { status: 500 });
    }
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

type ActionResult = { success: true; valid?: boolean; message?: string; details?: unknown } | { success: false; error: string };
export default function PixelTestPage() {
  const { shop, pixelConfig, hasVerificationAccess, backendUrlInfo } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  useEffect(() => {
    if (!actionData) return;
    if (actionData.success && actionData.valid) {
      showSuccess(actionData.message || "测试环境验证通过");
    } else if (actionData.success && actionData.valid === false) {
      showError(actionData.message || "测试环境验证失败");
    } else if (actionData.success === false && "error" in actionData && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, showSuccess, showError]);
  if (!shop || !pixelConfig) {
    return (
      <Page title="Pixel 测试">
        <EnhancedEmptyState
          icon="⚠️"
          title="配置不存在"
          description="未找到对应的 Pixel 配置，请返回列表重新选择。"
          primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
        />
      </Page>
    );
  }
  const handleValidate = () => {
    const formData = new FormData();
    formData.append("_action", "validateTestEnvironment");
    formData.append("platform", pixelConfig.platform);
    submit(formData, { method: "post" });
  };
  const isSubmitting = navigation.state === "submitting";
  return (
    <Page
      title="Pixel 测试"
      subtitle="实时事件流 / Payload 预览"
      backAction={{ content: "返回 Pixels", url: "/app/pixels" }}
    >
      <PageIntroCard
        title="Test 环境验收"
        description="跟随测试清单触发标准事件，检查 payload 参数完整率与平台发送状态。"
        items={[
          "优先验证 checkout_started/checkout_completed",
          "确认 value/currency/items 参数完整率",
          "验收通过后再切换 Live",
        ]}
        primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
        secondaryAction={{ content: "查看验收页", url: "/app/verification" }}
      />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {PLATFORM_LABELS[pixelConfig.platform] || pixelConfig.platform}
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={pixelConfig.environment === "live" ? "critical" : "warning"}>
                    {pixelConfig.environment === "live" ? "生产" : "测试"}
                  </Badge>
                  <Badge>{`v${pixelConfig.configVersion}`}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                平台 ID：{pixelConfig.platformId || "未填写"}
              </Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">后端 URL 配置检查（硬校验）</Text>
                {backendUrlInfo.placeholderDetected ? (
                  <Banner tone="critical">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        检测到占位符，URL 未在构建时替换
                      </Text>
                      <Text as="p" variant="bodySm">
                        {backendUrlInfo.warning || "像素扩展配置中仍包含 __BACKEND_URL_PLACEHOLDER__，这表明构建流程未正确替换占位符。"}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        影响说明：
                      </Text>
                      <Text as="p" variant="bodySm">
                        如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        修复方法：请在 CI/CD 流程中确保运行 'pnpm ext:inject' 或相应的构建脚本，将 SHOPIFY_APP_URL 环境变量注入到扩展配置中。同时确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        CI/CD 流程检查清单：
                      </Text>
                      <List type="number">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            确保在构建前设置 SHOPIFY_APP_URL 环境变量
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            在构建流程中运行 <code>pnpm ext:inject</code> 或 <code>node scripts/build-extensions.mjs inject</code>
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            验证占位符已被替换（检查 extensions/shared/config.ts 中的 BUILD_TIME_URL）
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            确保该 URL 已在 Partner Dashboard → App → API access → UI extensions network access 的 allowlist 中配置
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            <strong>重要：</strong>必须在 Partner Dashboard → App → API access → UI extensions network access 中批准该权限，否则部署会失败或模块无法正常工作。请确认权限状态为 'Approved' 或 '已批准'，如果显示为 'Pending' 或 '未批准'，请等待审核完成后再部署。
                          </Text>
                        </List.Item>
                      </List>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        服务器端检测到的 URL（脱敏）：
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {(() => {
                          try {
                            const url = new URL(backendUrlInfo.url);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.url.substring(0, 30) + "...";
                          }
                        })()}
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        像素扩展端解析到的 backendUrl（硬校验）：
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {backendUrlInfo.pixelExtensionUrl ? (() => {
                          try {
                            const url = new URL(backendUrlInfo.pixelExtensionUrl);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.pixelExtensionUrl.substring(0, 50) + "...";
                          }
                        })() : "未配置（占位符未替换）"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 硬校验说明：此 URL 是服务器端根据构建时注入的 SHOPIFY_APP_URL 环境变量解析得到的，应与像素扩展端解析到的 URL 一致。如果占位符未替换，像素扩展将无法发送事件。您可以在浏览器控制台（开发模式下）检查像素扩展实际解析到的 URL（查找 "[Tracking Guardian]" 日志中的 "Backend URL resolved (硬校验)"），确保与服务器端检测到的 URL 一致。如果两者不一致或占位符未替换，请检查 CI/CD 流程是否正确替换了 __BACKEND_URL_PLACEHOLDER__，并确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置。这是导致事件丢失的常见原因，必须在上线前验证。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        构建流程验证步骤：
                      </Text>
                      <List type="number">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            检查构建日志中是否显示 "Successfully injected BACKEND_URL"
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            验证 extensions/shared/config.ts 中的 BUILD_TIME_URL 不包含 "__BACKEND_URL_PLACEHOLDER__"
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            在浏览器控制台（开发模式）检查像素扩展解析到的 backendUrl，确保与服务器端一致
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            确认该 URL 已在 Partner Dashboard 的 allowlist 中配置
                          </Text>
                        </List.Item>
                      </List>
                      {backendUrlInfo.allowlistStatus && (
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            Allowlist 状态对照（硬校验）：
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {backendUrlInfo.allowlistStatus.inAllowlist ? "✅ 已配置" : "⚠️ 需要验证"}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            服务器端检测到的主机名：{backendUrlInfo.allowlistStatus.hostname}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            允许的主机列表：{backendUrlInfo.allowlistStatus.allowedHosts.length > 0 ? backendUrlInfo.allowlistStatus.allowedHosts.join(", ") : "无"}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            像素扩展解析到的主机名：{backendUrlInfo.allowlistStatus.pixelExtensionHostname || backendUrlInfo.allowlistStatus.hostname}
                          </Text>
                          {!backendUrlInfo.allowlistStatus.inAllowlist && (
                            <Text as="p" variant="bodySm" tone="critical">
                              ⚠️ 警告：检测到后端 URL 可能未在 allowlist 中。请检查 Web Pixel Extension 配置，确保后端域名已添加到 allowlist，否则像素事件将无法发送。这是导致事件丢失的常见原因。
                            </Text>
                          )}
                        </BlockStack>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 硬校验说明：此页面显示服务器端检测到的 URL 和像素扩展端解析到的 URL。如果占位符未替换或 URL 不一致，像素事件将无法发送。请确保 CI/CD 流程正确替换了 __BACKEND_URL_PLACEHOLDER__。您可以在浏览器控制台（开发模式下）检查像素扩展实际解析到的 URL（查找 "[Tracking Guardian]" 日志中的 "Backend URL resolved (硬校验)"），确保与服务器端检测到的 URL 一致。这是导致事件丢失的常见原因，必须在上线前验证。
                      </Text>
                    </BlockStack>
                  </Banner>
                ) : backendUrlInfo.isConfigured ? (
                  <Banner tone={backendUrlInfo.isLocalhost ? "warning" : "success"}>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        后端 URL 配置状态
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        服务器端检测到的 URL（脱敏）：
                      </Text>
                      <Text as="p" variant="bodySm">
                        {(() => {
                          try {
                            const url = new URL(backendUrlInfo.url);
                            const hostname = url.hostname;
                            if (hostname.length > 30) {
                              return hostname.substring(0, 20) + "..." + hostname.substring(hostname.length - 10);
                            }
                            return hostname;
                          } catch {
                            return backendUrlInfo.url.substring(0, 50) + "...";
                          }
                        })()}
                      </Text>
                      {backendUrlInfo.allowlistStatus && (
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            Allowlist 状态对照：
                          </Text>
                          <Text as="p" variant="bodySm">
                            {backendUrlInfo.allowlistStatus.inAllowlist ? "✅ 已配置" : "⚠️ 需要验证"}
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            像素扩展端解析到的 backendUrl（硬校验）：
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {backendUrlInfo.allowlistStatus.pixelExtensionHostname || backendUrlInfo.allowlistStatus.hostname || "未解析到"}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            💡 硬校验说明：此 URL 是服务器端根据构建时注入的 SHOPIFY_APP_URL 环境变量解析得到的，应与像素扩展端解析到的 URL 一致。如果占位符未替换，像素扩展将无法发送事件。您可以在浏览器控制台（开发模式下）检查像素扩展实际解析到的 URL（查找 "[Tracking Guardian]" 日志中的 "Backend URL resolved (硬校验)"），确保与服务器端检测到的 URL 一致。如果两者不一致或占位符未替换，请检查 CI/CD 流程是否正确替换了 __BACKEND_URL_PLACEHOLDER__，并确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置。这是导致事件丢失的常见原因，必须在上线前验证。
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            允许的主机列表：{backendUrlInfo.allowlistStatus.allowedHosts.length > 0 ? backendUrlInfo.allowlistStatus.allowedHosts.join(", ") : "无"}
                          </Text>
                          {!backendUrlInfo.allowlistStatus.inAllowlist && (
                            <Text as="p" variant="bodySm" tone="critical">
                              ⚠️ 警告：检测到后端 URL 可能未在 allowlist 中。请检查 Web Pixel Extension 配置，确保后端域名已添加到 allowlist，否则像素事件将无法发送。这是导致事件丢失的常见原因。
                            </Text>
                          )}
                        </BlockStack>
                      )}
                      {backendUrlInfo.warning && (
                        <Text as="p" variant="bodySm">
                          {backendUrlInfo.warning}
                        </Text>
                      )}
                      <Text as="p" variant="bodySm" tone="subdued">
                        像素扩展将使用此 URL 发送事件。请确保此 URL 已在 Web Pixel Extension 的 allowlist 中配置。如果事件未发送，请检查扩展配置中的 allowlist 设置。
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 硬校验说明：此页面显示服务器端检测到的 URL 和像素扩展端解析到的 URL。如果占位符未替换或 URL 不一致，像素事件将无法发送。请确保 CI/CD 流程正确替换了 __BACKEND_URL_PLACEHOLDER__，并且该 URL 已在 Web Pixel Extension 的 allowlist 中配置。
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        上线前必须验证：
                      </Text>
                      <List type="bullet">
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            占位符已在构建时替换（检查 extensions/shared/config.ts）
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            服务器端和像素扩展端 URL 一致
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            URL 已在 Partner Dashboard 的 allowlist 中配置
                          </Text>
                        </List.Item>
                        <List.Item>
                          <Text as="span" variant="bodySm">
                            使用测试订单验证事件能正常发送
                          </Text>
                        </List.Item>
                      </List>
                    </BlockStack>
                  </Banner>
                ) : (
                  <Banner tone="critical">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        后端 URL 未正确配置
                      </Text>
                      <Text as="p" variant="bodySm">
                        {backendUrlInfo.warning || "SHOPIFY_APP_URL 环境变量未设置，像素事件可能无法发送。"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        请在 CI/CD 流程中确保 SHOPIFY_APP_URL 环境变量已正确设置，并在构建时替换 __BACKEND_URL_PLACEHOLDER__。同时确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置。
                      </Text>
                    </BlockStack>
                  </Banner>
                )}
              </BlockStack>
              <Divider />
              <Banner tone="warning">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问 DOM 元素、localStorage、第三方 cookie 等
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        部分事件字段可能为 null 或 undefined（如 buyer.email、buyer.phone、deliveryAddress、shippingAddress、billingAddress 等），这是平台限制，不是故障
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>v1.0 不支持的事件类型：</strong>退款（refund）、订单取消（order_cancelled）、订单编辑（order_edited）、订阅订单（subscription_created、subscription_updated、subscription_cancelled）等事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取。这些事件将在 v1.1+ 版本中通过订单 webhooks 实现
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 提示：这是 Shopify 平台的设计限制，不是应用故障。验收报告中会自动标注所有因 strict sandbox 限制而无法获取的字段和事件。在 App Review 时，请向 Shopify 说明这些限制是平台设计，不是应用缺陷。
                  </Text>
                </BlockStack>
              </Banner>
              <Divider />
              {pixelConfig.environment === "test" ? (
                <InlineStack gap="200" wrap>
                  <Button
                    variant="primary"
                    onClick={handleValidate}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    发送测试事件
                  </Button>
                  <Button url={`/app/pixels/${pixelConfig.id}/versions`} variant="plain">
                    查看版本历史
                  </Button>
                </InlineStack>
              ) : (
                <Banner tone="warning" title="当前为生产环境">
                  <Text as="p" variant="bodySm">
                    生产环境将发送真实事件。建议在测试环境完成验证后再切换生产。
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">实时事件流</Text>
              <Text as="p" tone="subdued">
                监听实时事件并查看 payload 详情，确保事件成功发送。
              </Text>
              {!hasVerificationAccess ? (
                <>
                  <Banner tone="warning" title="PRD 3 转化节点2：Verification 实时事件流需付费">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm">
                        <strong>Pixels配置完成后（Test阶段）</strong>：付费解锁"Verification实时事件流 + 报告导出"
                      </Text>
                      <Text as="p" variant="bodySm">
                        需要 <strong>Starter ($29/月)</strong> 或更高套餐才能使用实时事件流验证功能。
                      </Text>
                      <Button url="/app/billing" variant="primary" size="slim">
                        升级解锁
                      </Button>
                    </BlockStack>
                  </Banner>
                </>
              ) : (
                <Suspense fallback={<Text as="p">加载实时监控...</Text>}>
                  <RealtimeEventMonitor
                    shopId={shop.id}
                    platforms={[pixelConfig.platform]}
                    autoStart
                  />
                </Suspense>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">PRD 2.3: Shopify 官方测试指引</Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    参考 Shopify 官方"测试自定义像素"操作路径
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    PRD 2.3要求：Test指引可以直接复用Shopify官方"测试自定义像素"的操作路径，把它做成Verification的"自动清单"
                  </Text>
                  <Link url="https://help.shopify.com/en/manual/online-store/themes/customizing-themes/checkout-extensibility/web-pixels-api/test-custom-pixels" external>
                    查看 Shopify 官方测试指南
                  </Link>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">自动测试清单</Text>
                <Banner tone="success">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ✅ 按照以下步骤操作，系统会自动检测事件是否成功触发
                  </Text>
                </Banner>
                <List type="number">
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        测试 checkout_started 事件
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>操作：</strong>进入店铺的 checkout 页面（每次进入都会触发 checkout_started 事件）
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>验证：</strong>在实时事件流中查看事件是否到达，确认 payload 中包含正确的参数
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>注意：</strong>checkout_started 在 extensible 店铺每次进入 checkout 都会触发，可能多次触发
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        测试 checkout_shipping_info_submitted 事件
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>操作：</strong>在 checkout 页面填写 shipping 信息并提交
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>验证：</strong>在实时事件流中查看 checkout_shipping_info_submitted 事件是否到达
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        测试 checkout_completed 事件
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>操作：</strong>完成测试订单，在 Thank you 页面应触发 checkout_completed 事件
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>验证：</strong>在实时事件流中查看 checkout_completed 事件是否到达，确认这是最重要的转化事件
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>注意：</strong>checkout_completed 不一定在 Thank you 页触发，当存在 upsell/post-purchase 时可能在第一个 upsell 页触发
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        验证 payload 参数
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>操作：</strong>在实时事件流中展开 payload 预览
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>验证：</strong>确认 value、currency、items 等关键参数完整
                      </Text>
                    </BlockStack>
                  </List.Item>
                  <List.Item>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        平台后台验证
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>操作：</strong>在平台后台（GA4 DebugView、Meta Events Manager、TikTok Events Manager）查看
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        <strong>验证：</strong>确认事件已成功接收并正确归因
                      </Text>
                    </BlockStack>
                  </List.Item>
                </List>
                <Divider />
                <Text as="h3" variant="headingSm">重要提示</Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      checkout_started 在 extensible 店铺每次进入 checkout 都会触发，可能多次触发
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      建议使用测试订单（低金额）进行验证，避免影响真实数据
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果事件未到达，检查 Web Pixel 是否已正确安装和启用
                    </Text>
                  </List.Item>
                </List>
                <Divider />
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      上线前安全措施验证（必须执行）
                    </Text>
                    <Text as="p" variant="bodySm">
                      以下测试是上线前的关键验证步骤，**必须在生产环境部署前完成**，避免在生产环境高峰期出现事件丢失或服务不可用。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      1. 高并发下单/事件峰值测试（必须执行）
                    </Text>
                    <Text as="p" variant="bodySm">
                      模拟黑五等高峰期的下单场景（建议峰值：100-1000 订单/分钟），验证 rate limit 配置是否会导致误杀正常请求。重点验证：rate limit 阈值是否合理，避免在高并发场景下误杀正常请求。如果压测中发现误杀，需要调整 rate limit 配置。这是上线前必须验证的关键测试，避免在生产环境高峰期出现事件丢失。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>执行方法：</strong>使用项目内置压测脚本 <code>scripts/load-test-pixel-ingestion.mjs</code> 进行测试。运行命令：<code>CONCURRENT_REQUESTS=50 DURATION=60 node scripts/load-test-pixel-ingestion.mjs</code>（其中 CONCURRENT_REQUESTS 为并发数，DURATION 为持续时间秒数）。建议在生产环境部署前，在测试环境进行充分压测，确保 rate limit 配置不会误杀正常请求。如果压测中发现误杀，需要调整 rate limit 配置，避免在生产环境高峰期出现事件丢失。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      验收标准：
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          无 rate limit 误杀（所有正常请求应成功）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          事件处理延迟 {'<'} 2秒（P95）
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          错误率 {'<'} 0.1%
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          数据库连接池无耗尽
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      2. Origin: null 场景测试（必须执行）
                    </Text>
                    <Text as="p" variant="bodySm">
                      某些 Shopify 场景（如 Web Worker 沙箱环境）可能出现 <code>Origin: null</code>，生产环境必须设置 <code>PIXEL_ALLOW_NULL_ORIGIN=true</code> 才能正常接收事件。如果未设置此环境变量，像素事件将在 Origin: null 场景下被拒绝，导致事件丢失。这是上线前必须验证的关键配置，避免在生产环境出现事件丢失。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>执行方法：</strong>使用压测脚本的 <code>--null-origin-only</code> 参数专门测试 Origin: null 场景，确保生产环境配置正确。运行命令：<code>node scripts/load-test-pixel-ingestion.mjs --null-origin-only</code>。如果测试失败，请检查环境变量 <code>PIXEL_ALLOW_NULL_ORIGIN</code> 是否已设置为 <code>true</code>。这是上线前必须验证的关键测试，避免在生产环境出现事件丢失。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>环境变量配置：</strong>在生产环境部署时，确保在环境变量中设置 <code>PIXEL_ALLOW_NULL_ORIGIN=true</code>。如果未设置此环境变量，像素事件将在 Origin: null 场景下被拒绝，导致事件丢失。这是上线前必须验证的关键配置，必须在生产环境部署前完成验证。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      验收标准：
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          所有 Origin: null 请求应成功处理
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          无事件丢失
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          日志中正确标记 Origin: null 请求
                        </Text>
                      </List.Item>
                    </List>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
