import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { EnhancedEmptyState } from "~/components/ui";
import { ConfigVersionManager } from "~/components/migrate/ConfigVersionManager";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { getConfigVersionHistory, rollbackConfig } from "~/services/pixel-config-version.server";
import { logger } from "~/utils/logger.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    throw new Response("Missing pixel config id", { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
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
    },
  });
  if (!pixelConfig) {
    throw new Response("Pixel config not found", { status: 404 });
  }
  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfig,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    return json({ success: false, error: "缺少配置 ID" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const pixelConfig = await prisma.pixelConfig.findFirst({
    where: { id: pixelConfigId, shopId: shop.id },
    select: {
      platform: true,
      environment: true,
    },
  });
  if (!pixelConfig) {
    return json({ success: false, error: "配置不存在" }, { status: 404 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (actionType === "getConfigVersionHistory") {
    try {
      const history = await getConfigVersionHistory(
        shop.id,
        pixelConfig.platform as "google" | "meta" | "tiktok" | "",
        pixelConfig.environment as "test" | "live"
      );
      if (!history) {
        return json({ success: false, error: "配置不存在" }, { status: 404 });
      }
      return json({ success: true, history });
    } catch (error) {
      logger.error("Failed to get config version history", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "获取版本历史失败",
      }, { status: 500 });
    }
  }
  if (actionType === "rollbackConfig") {
    try {
      const result = await rollbackConfig(
        shop.id,
        pixelConfig.platform as "google" | "meta" | "tiktok" | "",
        pixelConfig.environment as "test" | "live"
      );
      return json(result);
    } catch (error) {
      logger.error("Failed to rollback config", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "回滚失败",
      }, { status: 500 });
    }
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export default function PixelVersionsPage() {
  const { shop, pixelConfig } = useLoaderData<typeof loader>();
  if (!shop || !pixelConfig) {
    return (
      <Page title="版本历史">
        <EnhancedEmptyState
          icon="⚠️"
          title="配置不存在"
          description="未找到对应的 Pixel 配置，请返回列表重新选择。"
          primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
        />
      </Page>
    );
  }
  return (
    <Page
      title="版本历史"
      subtitle="查看配置版本并回滚"
      backAction={{ content: "返回 Pixels", url: "/app/pixels" }}
    >
      <PageIntroCard
        title="版本管理"
        description="查看历史配置并在必要时回滚，确保 Live 环境可恢复。"
        items={[
          "每次回滚会生成新的版本快照",
          "建议先在 Test 环境验证",
        ]}
        primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
      />
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            当前配置
          </Text>
          <Text as="p" tone="subdued">
            平台：{pixelConfig.platform}，环境：{pixelConfig.environment}，版本：v{String(pixelConfig.configVersion)}
          </Text>
        </BlockStack>
      </Card>
      <ConfigVersionManager
        shopId={shop.id}
        platform={pixelConfig.platform as "google" | "meta" | "tiktok" | ""}
        currentVersion={pixelConfig.configVersion}
        historyEndpoint={`/app/pixels/${pixelConfig.id}/versions`}
      />
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            回滚后会创建新的版本快照，方便再次恢复。
          </Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
