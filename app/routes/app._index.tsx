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
  Link,
  ProgressBar,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

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
      alertConfigs: {
        where: { isEnabled: true },
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

  let healthScore: number | null = null;
  let healthStatus: "success" | "warning" | "critical" | "uninitialized" = "uninitialized";
  const recentReports = shop?.reconciliationReports || [];
  const configuredPlatforms = shop?.pixelConfigs?.length || 0;

  if (recentReports.length > 0 && configuredPlatforms > 0) {
    const avgDiscrepancy =
      recentReports.reduce((sum, r) => sum + r.orderDiscrepancy, 0) /
      recentReports.length;
    if (avgDiscrepancy > 0.2) {
      healthScore = 40;
      healthStatus = "critical";
    } else if (avgDiscrepancy > 0.1) {
      healthScore = 70;
      healthStatus = "warning";
    } else if (avgDiscrepancy > 0.05) {
      healthScore = 85;
    } else {
      healthScore = 95;
      healthStatus = "success";
    }
  }

  const latestScan = shop?.scanReports[0] || null;
  const weeklyConversions = shop?._count?.conversionLogs || 0;
  const hasAlertConfig = (shop?.alertConfigs?.length || 0) > 0;

  // P2-11: Extract ScriptTags info for migration warning
  let scriptTagsCount = 0;
  let hasOrderStatusScripts = false;
  if (latestScan?.scriptTags) {
    const scriptTags = latestScan.scriptTags as Array<{ display_scope?: string }>;
    scriptTagsCount = scriptTags.length;
    hasOrderStatusScripts = scriptTags.some(tag => tag.display_scope === "order_status");
  }

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
    hasAlertConfig,
    plan: shop?.plan || "free",
    // P2-11: Migration risk info
    scriptTagsCount,
    hasOrderStatusScripts,
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
    hasAlertConfig,
    plan,
    scriptTagsCount,
    hasOrderStatusScripts,
  } = useLoaderData<typeof loader>();

  const setupSteps = [
    {
      id: "scan",
      label: "运行一次扫描",
      description: "检测现有追踪脚本和迁移风险",
      done: !!latestScan,
      cta: "开始扫描",
      url: "/app/scan",
    },
    {
      id: "connect",
      label: "连接追踪平台",
      description: "配置 Google、Meta、TikTok 等平台",
      done: configuredPlatforms > 0,
      cta: "配置追踪平台",
      url: "/app/migrate",
    },
    {
      id: "monitor",
      label: "启用监控与告警",
      description: "当追踪数据异常时及时通知",
      done: hasAlertConfig,
      cta: "开启监控",
      url: "/app/settings",
    },
  ];

  const completedSteps = setupSteps.filter((s) => s.done).length;
  const allStepsCompleted = completedSteps === setupSteps.length;

  const getHealthBadge = () => {
    switch (healthStatus) {
      case "critical":
        return <Badge tone="critical">需要关注</Badge>;
      case "warning":
        return <Badge tone="warning">有风险</Badge>;
      case "success":
        return <Badge tone="success">健康</Badge>;
      default:
        return <Badge tone="info">未初始化</Badge>;
    }
  };

  const nextStep = setupSteps.find((s) => !s.done);

  return (
    <Page
      title="Tracking Guardian"
      primaryAction={
        !allStepsCompleted && nextStep
          ? {
              content: nextStep.cta,
              url: nextStep.url,
            }
          : undefined
      }
    >
      <BlockStack gap="500">
        {}
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

        {}
        {!allStepsCompleted && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  开始设置
                </Text>
                <Badge tone="attention">
                  {completedSteps}/{setupSteps.length} 已完成
                </Badge>
              </InlineStack>
              <ProgressBar
                progress={(completedSteps / setupSteps.length) * 100}
                tone="primary"
                size="small"
              />
              <BlockStack gap="300">
                {setupSteps.map((step, index) => (
                  <Box
                    key={step.id}
                    background={step.done ? "bg-surface-success" : "bg-surface-secondary"}
                    padding="400"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="300" blockAlign="center">
                        <Box>
                          {step.done ? (
                            <Icon source={CheckCircleIcon} tone="success" />
                          ) : (
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {index + 1}
                            </Text>
                          )}
                        </Box>
                        <BlockStack gap="100">
                          <Text
                            as="span"
                            fontWeight="semibold"
                            tone={step.done ? "success" : undefined}
                          >
                            {step.label}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {step.description}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      {!step.done && (
                        <Button
                          url={step.url}
                          size="slim"
                          variant={step.id === nextStep?.id ? "primary" : undefined}
                        >
                          {step.cta}
                        </Button>
                      )}
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        <Layout>
          {}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    健康度
                  </Text>
                  {getHealthBadge()}
                </InlineStack>
                <Box
                  background={
                    healthScore === null
                      ? "bg-surface-secondary"
                      : healthScore > 80
                        ? "bg-fill-success"
                        : healthScore > 60
                          ? "bg-fill-warning"
                          : "bg-fill-critical"
                  }
                  padding="600"
                  borderRadius="200"
                >
                  <BlockStack gap="200" align="center">
                    {healthScore !== null ? (
                      <>
                        <Text as="p" variant="heading3xl" fontWeight="bold">
                          {healthScore}
                        </Text>
                        <Text as="p" variant="bodySm">
                          / 100
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text as="p" variant="headingLg" fontWeight="semibold">
                          未初始化
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          完成平台连接后开始评分
                        </Text>
                      </>
                    )}
                  </BlockStack>
                </Box>
                <Text as="p" variant="bodySm" tone="subdued">
                  {healthScore !== null
                    ? "评分依据：过去 7 天对账差异率 / 漏报率"
                    : "连接平台并产生订单数据后，系统将自动计算健康度评分"}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          {}
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

          {}
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
                {latestScan ? (
                  <Button url="/app/scan" fullWidth>
                    查看扫描报告
                  </Button>
                ) : (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      完成上方第 1 步开始扫描
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      预计耗时约 10 秒，不会修改任何设置
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* P2-11: 迁移风险提醒卡片 - 基于扫描结果 */}
        {scriptTagsCount > 0 && (
          <Banner
            title={`检测到 ${scriptTagsCount} 个 ScriptTag 需要迁移`}
            tone="critical"
            action={{
              content: "查看迁移方案",
              url: "/app/migrate",
            }}
            secondaryAction={{
              content: "查看扫描详情",
              url: "/app/scan",
            }}
          >
            <BlockStack gap="300">
              {hasOrderStatusScripts && (
                <Text as="p">
                  ⚠️ 检测到 <strong>订单状态页 ScriptTag</strong>，这是 Shopify 废弃公告的主要目标。
                  请尽快迁移到 Web Pixel 以避免追踪中断。
                </Text>
              )}
              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">
                  推荐迁移步骤：
                </Text>
                <Text as="p" variant="bodySm">
                  1. 在「设置」页面配置平台凭证（Meta CAPI / GA4 / TikTok）
                </Text>
                <Text as="p" variant="bodySm">
                  2. 在「迁移」页面安装 Tracking Guardian Web Pixel
                </Text>
                <Text as="p" variant="bodySm">
                  3. 验证新配置正常工作后，删除旧的 ScriptTag
                </Text>
              </BlockStack>
            </BlockStack>
          </Banner>
        )}

        {/* 通用迁移截止日期提醒 */}
        <Banner
          title="重要迁移截止日期"
          tone={scriptTagsCount > 0 ? "warning" : "info"}
          action={{
            content: "了解更多",
            url: "https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status",
            external: true,
          }}
        >
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="p">
                <strong>Shopify Plus 商家:</strong> 附加脚本（Additional Scripts）自{" "}
                <strong>2025年8月28日</strong> 起在 Checkout 设置中只读（不可再编辑）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <Link
                  url="https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/upgrade-thank-you-order-status/plus-upgrade-guide"
                  external
                >
                  查看 Plus 商家升级指南
                </Link>
              </Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p">
                <strong>非 Plus 商家:</strong> Order status 页 ScriptTags 将于{" "}
                <strong>2026年8月26日</strong> 关闭
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <Link
                  url="https://shopify.dev/docs/apps/build/online-store/blocking-script-tags"
                  external
                >
                  查看 ScriptTags 弃用时间表
                </Link>
              </Text>
            </BlockStack>
            <Text as="p" tone="subdued">
              checkout.liquid、附加脚本（Additional Scripts）、ScriptTags 将逐步下线，建议尽早迁移到 Web Pixels
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}

