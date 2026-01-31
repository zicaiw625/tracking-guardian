import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  DataTable,
  List,
  Banner,
} from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { getPixelEventIngestionUrl } from "~/utils/config.server";
import { useLocale } from "~/context/LocaleContext";

function extractPlatformFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (payload.platform && typeof payload.platform === "string") {
    return payload.platform;
  }
  if (payload.destination && typeof payload.destination === "string") {
    return payload.destination;
  }
  return null;
}

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });
  if (!shop) {
    return json({ shop: null, pixelConfigs: [], latestByKey: {}, backendUrlInfo: getPixelEventIngestionUrl() });
  }
  const pixelConfigs = await prisma.pixelConfig.findMany({
    where: { shopId: shop.id, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      platform: true,
      environment: true,
      configVersion: true,
      platformId: true,
      updatedAt: true,
    },
  });
  const platforms = Array.from(new Set(pixelConfigs.map((config) => config.platform)));
  const recentReceipts = platforms.length
    ? await prisma.pixelEventReceipt.findMany({
        where: {
          shopId: shop.id,
        },
        orderBy: { createdAt: "desc" },
        select: {
          eventType: true,
          createdAt: true,
          payloadJson: true,
        },
        take: 200,
      })
    : [];
  const latestByKey = recentReceipts.reduce((acc, receipt) => {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    const platform = extractPlatformFromPayload(payload);
    if (!platform || !platforms.includes(platform)) return acc;
    const key = `${platform}:live`;
    if (!acc[key]) {
      const data = payload?.data as Record<string, unknown> | undefined;
      const hasValue = data && typeof data.value === "number";
      const hasCurrency = !!data?.currency;
      const status = hasValue && hasCurrency ? "ok" : "pending";
      acc[key] = {
        status,
        createdAt: receipt.createdAt.toISOString(),
      };
    }
    return acc;
  }, {} as Record<string, { status: string; createdAt: string }>);
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfigs,
    latestByKey,
    backendUrlInfo,
  });
};

export default function PixelsListPage() {
  const { t, tArray, locale } = useLocale();
  const { shop, pixelConfigs, latestByKey, backendUrlInfo } = useLoaderData<typeof loader>();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  if (!shop) {
    return (
      <Page title="Pixels">
        <EnhancedEmptyState
          icon="⚠️"
          title={t("pixels.shopNotFound")}
          description={t("pixels.shopNotFoundDesc")}
          primaryAction={{ content: t("pixels.backToHome"), url: "/app" }}
        />
      </Page>
    );
  }
  const rows = pixelConfigs.map((config) => {
    const statusKey = `${config.platform}:${config.environment}`;
    const latestAttempt = latestByKey?.[statusKey];
    const statusLabel =
      latestAttempt?.status === "ok"
        ? { label: t("pixels.statusSuccess"), tone: "success" as const }
        : latestAttempt?.status === "fail"
          ? { label: t("pixels.statusFail"), tone: "critical" as const }
          : latestAttempt?.status === "pending"
            ? { label: t("pixels.statusPending"), tone: "warning" as const }
            : null;
    const statusCell = latestAttempt ? (
      <BlockStack gap="100">
        {statusLabel ? (
          <Badge tone={statusLabel.tone}>{statusLabel.label}</Badge>
        ) : (
          <Badge>{latestAttempt.status}</Badge>
        )}
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(latestAttempt.createdAt).toLocaleString(dateLocale)}
        </Text>
      </BlockStack>
    ) : (
      <Text as="span" variant="bodySm" tone="subdued">
        {t("pixels.noSendRecords")}
      </Text>
    );
    return [
      PLATFORM_LABELS[config.platform] || config.platform,
      config.platformId || "—",
      config.environment === "live" ? (
        <Badge tone="success">{t("pixels.live")}</Badge>
      ) : (
        <Badge tone="warning">{t("pixels.test")}</Badge>
      ),
      statusCell,
      <Badge key={`version-${config.id}`}>{`v${config.configVersion}`}</Badge>,
      new Date(config.updatedAt).toLocaleString(dateLocale),
      <InlineStack key={`actions-${config.id}`} gap="200">
        <Button size="slim" url={`/app/pixels/${config.id}/test`}>
          {t("pixels.test")}
        </Button>
        <Button size="slim" variant="plain" url={`/app/pixels/${config.id}/versions`}>
          {t("pixels.version")}
        </Button>
      </InlineStack>,
    ];
  });
  return (
    <Page
      title="Pixels"
      primaryAction={{ content: t("pixels.newPixelConfig"), url: "/app/pixels/new" }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("pixels.pixelMigrationCenter")}
          description={t("pixels.pixelMigrationDesc")}
          items={tArray("pixels.pixelMigrationItems")}
          primaryAction={{ content: t("pixels.newPixelConfig"), url: "/app/pixels/new" }}
          secondaryAction={{ content: t("pixels.viewTestGuide"), url: "/app/pixels/new" }}
        />
        {backendUrlInfo.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ {t("dashboard.backendUrl.errorTitle")}
              </Text>
              <Text as="p" variant="bodySm">
                <strong>{t("dashboard.backendUrl.detected")}</strong> {t("dashboard.backendUrl.description")}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("dashboard.backendUrl.fixSteps")}
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("dashboard.backendUrl.step1")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("dashboard.backendUrl.step2")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("dashboard.backendUrl.step3")}
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    {t("dashboard.backendUrl.step4")}
                  </Text>
                </List.Item>
              </List>
              <Button url="/app/pixels/new" variant="primary" size="slim">
                {t("dashboard.enterReportCenter")}
              </Button>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo.placeholderDetected && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("dashboard.backendUrl.errorTitle")}
              </Text>
              <Text as="p" variant="bodySm">
                {t("dashboard.backendUrl.description")}
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("dashboard.pixelMigrationTech")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("dashboard.pixelMigrationTech")}
            </Text>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("dashboard.reportCenter")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("dashboard.reportCenterDesc")}
            </Text>
          </BlockStack>
        </Card>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("pixels.configuredPixels")}
                </Text>
                <Badge tone="success">{`${pixelConfigs.length} ${t("pixels.count")}`}</Badge>
              </InlineStack>
              {pixelConfigs.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    {t("pixels.noPixelYet")}
                  </Text>
                  <Button variant="primary" url="/app/pixels/new">
                    {t("pixels.createPixelConfig")}
                  </Button>
                </BlockStack>
              ) : (
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                    "text",
                  ]}
                  headings={[t("pixels.platform"), t("pixels.platformId"), t("pixels.environment"), t("pixels.lastSent"), t("pixels.version"), t("pixels.updatedAt"), t("pixels.actions")]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("pixels.quickActions")}
              </Text>
              <BlockStack gap="200">
                <Button url="/app/pixels/new" variant="primary">
                  {t("pixels.newPixelConfig")}
                </Button>
                <Button url="/app/verification" variant="plain">
                  {t("pixels.goToVerification")}
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      </BlockStack>
    </Page>
  );
}
