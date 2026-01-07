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

  return json({
    shop: { id: shop.id, domain: shop.shopDomain },
    pixelConfigs,
  });
};

export default function PixelsListPage() {
  const { shop, pixelConfigs } = useLoaderData<typeof loader>();

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

  const rows = pixelConfigs.map((config) => [
    PLATFORM_LABELS[config.platform] || config.platform,
    config.platformId || "—",
    config.environment === "live" ? (
      <Badge tone="success">生产</Badge>
    ) : (
      <Badge tone="warning">测试</Badge>
    ),
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
  ]);

  return (
    <Page
      title="Pixels"
      primaryAction={{ content: "新建 Pixel 配置", url: "/app/pixels/new" }}
    >
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
                  ]}
                  headings={["平台", "平台 ID", "环境", "版本", "更新时间", "操作"]}
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
    </Page>
  );
}
