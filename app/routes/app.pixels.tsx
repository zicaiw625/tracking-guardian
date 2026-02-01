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
import { useTranslation, Trans } from "react-i18next";

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
  const platforms = Array.from(new Set(pixelConfigs.map((config: any) => config.platform)));
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
  const latestByKey = recentReceipts.reduce((acc: any, receipt: any) => {
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
  const { t } = useTranslation();
  const { shop, pixelConfigs, latestByKey, backendUrlInfo } = useLoaderData<typeof loader>();
  if (!shop) {
    return (
      <Page title="Pixels">
        <EnhancedEmptyState
          icon="⚠️"
          title={t("pixels.list.configured.empty")}
          description={t("pixels.new.shopNotFoundDesc")}
          primaryAction={{ content: t("common.back"), url: "/app" }}
        />
      </Page>
    );
  }
  const rows = pixelConfigs.map((config) => {
    const statusKey = `${config.platform}:${config.environment}`;
    const latestAttempt = latestByKey?.[statusKey];
    const statusLabel =
      latestAttempt?.status === "ok"
        ? { label: t("pixels.list.status.success"), tone: "success" as const }
        : latestAttempt?.status === "fail"
          ? { label: t("pixels.list.status.fail"), tone: "critical" as const }
          : latestAttempt?.status === "pending"
            ? { label: t("pixels.list.status.pending"), tone: "warning" as const }
            : null;
    const statusCell = latestAttempt ? (
      <BlockStack gap="100">
        {statusLabel ? (
          <Badge tone={statusLabel.tone}>{statusLabel.label}</Badge>
        ) : (
          <Badge>{latestAttempt.status}</Badge>
        )}
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(latestAttempt.createdAt).toLocaleString()}
        </Text>
      </BlockStack>
    ) : (
      <Text as="span" variant="bodySm" tone="subdued">
        {t("pixels.list.status.noRecord")}
      </Text>
    );
    return [
      PLATFORM_LABELS[config.platform] || config.platform,
      config.platformId || "—",
      config.environment === "live" ? (
        <Badge tone="success">{t("pixels.list.env.prod")}</Badge>
      ) : (
        <Badge tone="warning">{t("pixels.list.env.test")}</Badge>
      ),
      statusCell,
      <Badge>{`v${config.configVersion}`}</Badge>,
      new Date(config.updatedAt).toLocaleString(),
      <InlineStack gap="200">
        <Button size="slim" url={`/app/pixels/${config.id}/test`}>
          {t("pixels.list.actions.test")}
        </Button>
        <Button size="slim" variant="plain" url={`/app/pixels/${config.id}/versions`}>
          {t("pixels.list.actions.version")}
        </Button>
      </InlineStack>,
    ];
  });
  return (
    <Page
      title={t("pixels.list.title")}
      primaryAction={{ content: t("pixels.list.create"), url: "/app/pixels/new" }}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("pixels.list.intro.title")}
          description={t("pixels.list.intro.desc")}
          items={t("pixels.list.intro.items", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("pixels.list.intro.primary"), url: "/app/pixels/new" }}
          secondaryAction={{ content: t("pixels.list.intro.secondary"), url: "/app/pixels/new" }}
        />
        {backendUrlInfo.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.placeholder.title")}
              </Text>
              <Text as="p" variant="bodySm">
                 <Trans i18nKey="pixels.new.banners.placeholder.desc" />
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.placeholder.stepsTitle")}
              </Text>
              <List type="number">
                {(t("pixels.new.banners.placeholder.steps", { returnObjects: true }) as string[]).map((step, i) => (
                  <List.Item key={i}>
                    <Text as="span" variant="bodySm">
                       <span dangerouslySetInnerHTML={{ __html: step }} />
                    </Text>
                  </List.Item>
                ))}
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("pixels.new.banners.placeholder.tip")}
              </Text>
              <Button url="/app/pixels/new" variant="primary" size="slim">
                {t("pixels.list.actions.test")}
              </Button>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo.placeholderDetected && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("pixels.new.banners.configured.important")}
              </Text>
              <Text as="p" variant="bodySm">
                 <span dangerouslySetInnerHTML={{ __html: t("pixels.new.banners.configured.importantDesc") }} />
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("pixels.new.banners.sandbox.title")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("pixels.new.banners.sandbox.desc")}
            </Text>
            <List type="bullet">
              {(t("pixels.new.banners.sandbox.limitations", { returnObjects: true }) as string[]).map((item, i) => (
                 <List.Item key={i}>
                    <Text as="span" variant="bodySm">{item}</Text>
                 </List.Item>
              ))}
              <List.Item>
                <Text as="span" variant="bodySm">
                   <span dangerouslySetInnerHTML={{ __html: t("pixels.new.banners.sandbox.unsupported.desc") }} />
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("pixels.new.banners.sandbox.reviewPoints.desc")}
            </Text>
          </BlockStack>
        </Banner>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("pixels.list.banners.eventSource.title")}
            </Text>
            <Text as="p" variant="bodySm">
               <span dangerouslySetInnerHTML={{ __html: t("pixels.list.banners.eventSource.desc") }} />
            </Text>
            <List type="bullet">
               {(t("pixels.list.banners.eventSource.items", { returnObjects: true }) as string[]).map((item, i) => (
                  <List.Item key={i}>
                    <Text as="span" variant="bodySm">{item}</Text>
                  </List.Item>
               ))}
            </List>
          </BlockStack>
        </Card>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("pixels.list.configured.title")}
                </Text>
                <Badge tone="success">{`${pixelConfigs.length} ${t("common.countItems", { count: pixelConfigs.length }).trim()}`}</Badge>
              </InlineStack>
              {pixelConfigs.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    {t("pixels.list.configured.empty")}
                  </Text>
                  <Button variant="primary" url="/app/pixels/new">
                    {t("pixels.list.configured.create")}
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
                    "text",
                  ]}
                  headings={[
                    t("pixels.list.table.platform"),
                    t("pixels.list.table.id"),
                    t("pixels.list.table.env"),
                    t("pixels.list.table.lastSent"),
                    t("pixels.list.table.version"),
                    t("pixels.list.table.updated"),
                    t("pixels.list.table.actions")
                  ]}
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
                {t("pixels.list.quickActions.title")}
              </Text>
              <BlockStack gap="200">
                <Button url="/app/pixels/new" variant="primary">
                  {t("pixels.list.quickActions.create")}
                </Button>
                <Button url="/app/verification" variant="plain">
                  {t("pixels.list.quickActions.verify")}
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
