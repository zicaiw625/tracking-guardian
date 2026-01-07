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
              {!hasVerificationAccess && (
                <Banner tone="warning" title="Verification 实时事件流需付费">
                  <Text as="p" variant="bodySm">
                    升级至付费套餐后可启用实时事件流验证能力。
                  </Text>
                </Banner>
              )}
              <Suspense fallback={<Text as="p">加载实时监控...</Text>}>
                <RealtimeEventMonitor
                  shopId={shop.id}
                  platforms={[pixelConfig.platform]}
                  autoStart
                />
              </Suspense>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">测试提示</Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  1. 创建测试订单或触发 checkout_completed 事件。
                </Text>
                <Text as="p" variant="bodySm">
                  2. 在实时事件流中查看事件是否到达，展开 payload 预览。
                </Text>
                <Text as="p" variant="bodySm">
                  3. 确认平台后台也收到对应测试事件。
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
