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
  Badge,
  Button,
  Icon,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  SettingsIcon,
  ChartVerticalFilledIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Get shop data
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      scanReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      pixelConfigs: {
        where: { isActive: true },
      },
      reconciliationReports: {
        orderBy: { reportDate: "desc" },
        take: 7,
      },
      _count: {
        select: {
          conversionLogs: {
            where: {
              createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      },
    },
  });

  // Calculate health score based on recent reconciliation
  let healthScore = 100;
  let healthStatus: "success" | "warning" | "critical" = "success";
  const recentReports = shop?.reconciliationReports || [];

  if (recentReports.length > 0) {
    const avgDiscrepancy =
      recentReports.reduce((sum, r) => sum + r.orderDiscrepancy, 0) /
      recentReports.length;
    if (avgDiscrepancy > 0.2) {
      healthScore = 40;
      healthStatus = "critical";
    } else if (avgDiscrepancy > 0.1) {
      healthScore = 70;
      healthStatus = "warning";
    } else {
      healthScore = 95;
    }
  }

  const latestScan = shop?.scanReports[0] || null;
  const configuredPlatforms = shop?.pixelConfigs?.length || 0;
  const weeklyConversions = shop?._count?.conversionLogs || 0;

  return json({
    shopDomain,
    healthScore,
    healthStatus,
    latestScan: latestScan
      ? {
          status: latestScan.status,
          riskScore: latestScan.riskScore,
          createdAt: latestScan.createdAt,
          identifiedPlatforms: latestScan.identifiedPlatforms,
        }
      : null,
    configuredPlatforms,
    weeklyConversions,
    plan: shop?.plan || "free",
  });
};

export default function Index() {
  const {
    shopDomain,
    healthScore,
    healthStatus,
    latestScan,
    configuredPlatforms,
    weeklyConversions,
    plan,
  } = useLoaderData<typeof loader>();

  const getHealthBadge = () => {
    switch (healthStatus) {
      case "critical":
        return <Badge tone="critical">需要关注</Badge>;
      case "warning":
        return <Badge tone="warning">有风险</Badge>;
      default:
        return <Badge tone="success">健康</Badge>;
    }
  };

  return (
    <Page title="Tracking Guardian">
      <BlockStack gap="500">
        {/* Welcome Banner */}
        <Banner
          title="欢迎使用 Tracking Guardian"
          tone="info"
          onDismiss={() => {}}
        >
          <p>
            帮助您扫描、迁移和监控 Thank you / Order status 页面的追踪脚本，
            确保在 Checkout Extensibility 迁移后转化追踪正常工作。
          </p>
        </Banner>

        <Layout>
          {/* Health Score Card */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    追踪健康度
                  </Text>
                  {getHealthBadge()}
                </InlineStack>
                <Box
                  background="bg-surface-secondary"
                  padding="600"
                  borderRadius="200"
                >
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading3xl" fontWeight="bold">
                      {healthScore}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      / 100
                    </Text>
                  </BlockStack>
                </Box>
                <Text as="p" variant="bodySm" tone="subdued">
                  基于过去 7 天的转化数据对账结果
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Quick Stats */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  快速统计
                </Text>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="span">已配置平台</Text>
                    <Text as="span" fontWeight="semibold">
                      {configuredPlatforms} 个
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span">本周转化记录</Text>
                    <Text as="span" fontWeight="semibold">
                      {weeklyConversions} 条
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span">当前套餐</Text>
                    <Badge>{plan === "free" ? "免费版" : plan}</Badge>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Latest Scan */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    最新扫描
                  </Text>
                  {latestScan && (
                    <Badge
                      tone={
                        latestScan.riskScore > 60
                          ? "critical"
                          : latestScan.riskScore > 30
                            ? "warning"
                            : "success"
                      }
                    >
                      {`风险分 ${latestScan.riskScore}`}
                    </Badge>
                  )}
                </InlineStack>
                {latestScan ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      扫描时间:{" "}
                      {new Date(latestScan.createdAt).toLocaleDateString(
                        "zh-CN"
                      )}
                    </Text>
                    <Text as="p" variant="bodySm">
                      识别到的平台:{" "}
                      {(
                        (latestScan.identifiedPlatforms as string[]) || []
                      ).join(", ") || "无"}
                    </Text>
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">
                    尚未进行扫描
                  </Text>
                )}
                <Button url="/app/scan" fullWidth icon={SearchIcon}>
                  开始扫描
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Quick Actions */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  快速操作
                </Text>
                <InlineStack gap="300" wrap={false}>
                  <Button url="/app/scan" size="large" icon={SearchIcon}>
                    扫描追踪脚本
                  </Button>
                  <Button url="/app/migrate" size="large" icon={SettingsIcon}>
                    迁移到新像素
                  </Button>
                  <Button url="/app/monitor" size="large" icon={ChartVerticalFilledIcon}>
                    查看监控报告
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Migration Deadline Warning */}
        <Layout>
          <Layout.Section>
            <Banner title="重要迁移截止日期" tone="warning">
              <BlockStack gap="200">
                <Text as="p">
                  <strong>Shopify Plus 商家:</strong> Additional Scripts 将于{" "}
                  <strong>2025年8月28日</strong> 变为只读
                </Text>
                <Text as="p">
                  <strong>非 Plus 商家:</strong> ScriptTags 将于{" "}
                  <strong>2026年8月26日</strong> 关闭
                </Text>
                <Text as="p" tone="subdued">
                  建议尽早完成迁移，确保追踪数据不中断
                </Text>
              </BlockStack>
            </Banner>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

