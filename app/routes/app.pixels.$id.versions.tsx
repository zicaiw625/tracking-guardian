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
import type { Platform } from "~/services/migration.server";
import type { PlatformType } from "~/types/enums";
import { logger } from "~/utils/logger.server";
import { useTranslation } from "react-i18next";
import { i18nServer } from "~/i18n.server";

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
  const t = await i18nServer.getFixedT(request);
  const shopDomain = session.shop;
  const pixelConfigId = params.id;
  if (!pixelConfigId) {
    return json({ success: false, error: t("pixels.versions.errors.missingConfigId") }, { status: 400 });
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
    return json({ success: false, error: t("pixels.versions.errors.configNotFound") }, { status: 404 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (actionType === "getConfigVersionHistory") {
    try {
      const platform = (pixelConfig.platform && ["meta", "google", "tiktok"].includes(pixelConfig.platform) ? pixelConfig.platform : "meta") as Platform;
      const history = await getConfigVersionHistory(shop.id, platform, pixelConfig.environment as "test" | "live");
      if (!history) {
        return json({ success: false, error: t("pixels.versions.errors.configNotFound") }, { status: 404 });
      }
      return json({ success: true, history });
    } catch (error) {
      logger.error("Failed to get config version history", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : t("pixels.versions.errors.historyFailed"),
      }, { status: 500 });
    }
  }
  if (actionType === "rollbackConfig") {
    try {
      const platform = (pixelConfig.platform && ["meta", "google", "tiktok"].includes(pixelConfig.platform) ? pixelConfig.platform : "meta") as Platform;
      const result = await rollbackConfig(shop.id, platform, pixelConfig.environment as "test" | "live");
      return json(result);
    } catch (error) {
      logger.error("Failed to rollback config", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : t("pixels.versions.errors.rollbackFailed"),
      }, { status: 500 });
    }
  }
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export default function PixelVersionsPage() {
  const { t } = useTranslation();
  const { shop, pixelConfig } = useLoaderData<typeof loader>();
  if (!shop || !pixelConfig) {
    return (
      <Page title={t("pixels.versions.title")}>
        <EnhancedEmptyState
          icon="⚠️"
          title={t("pixels.versions.configNotFound.title") || "Config Not Found"}
          description={t("pixels.versions.configNotFound.desc") || "Pixel config not found."}
          primaryAction={{ content: t("pixels.versions.back"), url: "/app/pixels" }}
        />
      </Page>
    );
  }
  return (
    <Page
      title={t("pixels.versions.title")}
      subtitle={t("pixels.versions.subtitle")}
      backAction={{ content: t("pixels.versions.back"), url: "/app/pixels" }}
    >
      <PageIntroCard
        title={t("pixels.versions.intro.title")}
        description={t("pixels.versions.intro.desc")}
        items={[
          t("pixels.versions.intro.items.0"),
          t("pixels.versions.intro.items.1"),
        ]}
        primaryAction={{ content: t("pixels.versions.back"), url: "/app/pixels" }}
      />
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("pixels.versions.currentConfig.title")}
          </Text>
          <Text as="p" tone="subdued">
            {t("pixels.versions.currentConfig.desc", { platform: pixelConfig.platform, environment: pixelConfig.environment, version: pixelConfig.configVersion })}
          </Text>
        </BlockStack>
      </Card>
      <ConfigVersionManager
        shopId={shop.id}
        platform={(pixelConfig.platform && ["meta", "google", "tiktok"].includes(pixelConfig.platform) ? pixelConfig.platform : "meta") as PlatformType}
        currentVersion={pixelConfig.configVersion}
        historyEndpoint={`/app/pixels/${pixelConfig.id}/versions`}
      />
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            {t("pixels.versions.rollbackBanner")}
          </Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
