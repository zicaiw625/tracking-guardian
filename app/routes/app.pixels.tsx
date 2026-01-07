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
} from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });

  if (!shop) {
    return json({ shop: null, pixelConfigs: [] });
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
  const environments = Array.from(new Set(pixelConfigs.map((config) => config.environment)));
  const recentAttempts = platforms.length
    ? await prisma.deliveryAttempt.findMany({
        where: {
          shopId: shop.id,
          destinationType: { in: platforms },
          environment: { in: environments },
        },
        orderBy: { createdAt: "desc" },
        select: {
          destinationType: true,
          environment: true,
          status: true,
          createdAt: true,
        },
        take: 200,
      })
    : [];

  const latestByKey = recentAttempts.reduce((acc, attempt) => {
    const key = `${attempt.destinationType}:${attempt.environment}`;
    if (!acc[key]) {
      acc[key] = {
        status: attempt.status,
        createdAt: attempt.createdAt.toISOString(),
      };
    }
    return acc;
  }, {} as Record<string, { status: string; createdAt: string }>);

  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfigs,
    latestByKey,
  });
};

export default function PixelsListPage() {
  const { shop, pixelConfigs, latestByKey } = useLoaderData<typeof loader>();

  if (!shop) {
    return (
      <Page title="Pixels">
        <EnhancedEmptyState
          icon="⚠️"
          title="店铺信息未找到"
          description="未找到店铺信息，请重新安装应用。"
          primaryAction={{ content: "返回首页", url: "/app" }}
        />
      </Page>
    );
  }

  const rows = pixelConfigs.map((config) => {
    const statusKey = `${config.platform}:${config.environment}`;
    const latestAttempt = latestByKey?.[statusKey];
    const statusLabel =
      latestAttempt?.status === "ok"
        ? { label: "成功", tone: "success" as const }
        : latestAttempt?.status === "fail"
          ? { label: "失败", tone: "critical" as const }
          : latestAttempt?.status === "pending"
            ? { label: "处理中", tone: "warning" as const }
            : null;

    const statusCell = latestAttempt ? (
      <BlockStack gap="100">
        {statusLabel ? (
          <Badge tone={statusLabel.tone}>{statusLabel.label}</Badge>
        ) : (
          <Badge>{latestAttempt.status}</Badge>
        )}
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(latestAttempt.createdAt).toLocaleString("zh-CN")}
        </Text>
      </BlockStack>
    ) : (
      <Text as="span" variant="bodySm" tone="subdued">
        暂无发送记录
      </Text>
    );

    return [
      PLATFORM_LABELS[config.platform] || config.platform,
      config.platformId || "—",
      config.environment === "live" ? (
        <Badge tone="success">生产</Badge>
      ) : (
        <Badge tone="warning">测试</Badge>
      ),
      statusCell,
      <Badge key={`version-${config.id}`}>v{String(config.configVersion)}</Badge>,
      new Date(config.updatedAt).toLocaleString("zh-CN"),
      <InlineStack key={`actions-${config.id}`} gap="200">
        <Button size="slim" url={`/app/pixels/${config.id}/test`}>
          测试
        </Button>
        <Button size="slim" variant="plain" url={`/app/pixels/${config.id}/versions`}>
          版本
        </Button>
      </InlineStack>,
    ];
  });

  return (
    <Page
      title="Pixels"
      primaryAction={{ content: "新建 Pixel 配置", url: "/app/pixels/new" }}
    >
      <BlockStack gap="500">
        {}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📋 事件源说明
            </Text>
            <Text as="p" variant="bodySm">
              <strong>PRD 2.3要求：</strong>事件源以 Shopify <strong>Standard events</strong> 为准，再映射到 GA4/Meta/TikTok。
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>Shopify 标准事件：</strong>checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>事件映射：</strong>系统会自动将 Shopify 标准事件映射到各平台对应的事件类型（如 checkout_completed → GA4的purchase、Meta的Purchase、TikTok的CompletePayment）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>Test 指引：</strong>可直接复用 Shopify 官方"测试自定义像素"的操作路径（进入 checkout 测 checkout_started、填 shipping 测 shipping_submitted 等），详见测试页面指引。
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Card>

      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  已配置的 Pixel
                </Text>
                <Badge tone="success">{String(pixelConfigs.length)} 个</Badge>
              </InlineStack>
              {pixelConfigs.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    还没有配置 Pixel。点击右上角按钮开始创建。
                  </Text>
                  <Button variant="primary" url="/app/pixels/new">
                    创建 Pixel 配置
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
                  headings={["平台", "平台 ID", "环境", "最近发送", "版本", "更新时间", "操作"]}
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
                快速操作
              </Text>
              <BlockStack gap="200">
                <Button url="/app/pixels/new" variant="primary">
                  新建配置
                </Button>
                <Button url="/app/monitor" variant="plain">
                  查看实时监控
                </Button>
                <Button url="/app/verification" variant="plain">
                  前往验收
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
