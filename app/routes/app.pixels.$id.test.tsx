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
} from "@shopify/polaris";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { validateTestEnvironment } from "~/services/migration-wizard.server";
import { normalizePlanId, planSupportsFeature } from "~/services/billing/plans";

const RealtimeEventMonitor = lazy(() => import("~/components/verification/RealtimeEventMonitor").then(module => ({
  default: module.RealtimeEventMonitor,
})));

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
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
    return json({ shop: null, pixelConfig: null });
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
    const { safeFireAndForget } = await import("~/utils/helpers");
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

  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfig,
    hasVerificationAccess,
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

export default function PixelTestPage() {
  const { shop, pixelConfig, hasVerificationAccess } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  useEffect(() => {
    if (!actionData) return;
    if (actionData.success && actionData.valid) {
      showSuccess(actionData.message || "测试环境验证通过");
    } else if (actionData.success && actionData.valid === false) {
      showError(actionData.message || "测试环境验证失败");
    } else if (actionData.success === false && actionData.error) {
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
                  <Badge>v{String(pixelConfig.configVersion)}</Badge>
                </InlineStack>
              </InlineStack>
              <Text as="p" tone="subdued">
                平台 ID：{pixelConfig.platformId || "未填写"}
              </Text>
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
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
