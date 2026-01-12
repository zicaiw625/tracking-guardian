import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  ProgressBar,
  Badge,
  Layout,
  Divider,
  List,
} from "@shopify/polaris";
import { CheckCircleIcon, ArrowRightIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking } from "../services/scanner.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";

type MigrationStep = "audit" | "pixels" | "modules" | "verification";

interface StepStatus {
  completed: boolean;
  inProgress: boolean;
  canAccess: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      webPixelId: true,
      pixelConfigs: {
        where: { isActive: true },
        select: { platform: true, environment: true },
        take: 1,
      },
    },
  });

  if (!shop) {
    return json({
      shop: null,
      planId: "free" as PlanId,
      steps: {
        audit: { completed: false, inProgress: false, canAccess: true },
        pixels: { completed: false, inProgress: false, canAccess: false },
        modules: { completed: false, inProgress: false, canAccess: false },
        verification: { completed: false, inProgress: false, canAccess: false },
      },
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const latestScan = await prisma.scanReport.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const hasPixels = shop.pixelConfigs.length > 0;
  const hasWebPixel = !!shop.webPixelId;

  const uiModules = await prisma.shop.findUnique({
    where: { id: shop.id },
    select: { settings: true },
  });
  const settings = (uiModules?.settings as Record<string, unknown>) || {};
  const uiModulesConfig = (settings.uiModules as Record<string, unknown>) || {};
  const hasEnabledModules = Object.values(uiModulesConfig).some(
    (module: unknown) => module && typeof module === "object" && "isEnabled" in module && (module as { isEnabled: boolean }).isEnabled
  );

  const latestVerification = await prisma.verificationRun.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  const steps: Record<MigrationStep, StepStatus> = {
    audit: {
      completed: !!latestScan,
      inProgress: false,
      canAccess: true,
    },
    pixels: {
      completed: hasPixels && hasWebPixel,
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
    modules: {
      completed: hasEnabledModules,
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
    verification: {
      completed: !!latestVerification && latestVerification.status === "completed",
      inProgress: false,
      canAccess: isPlanAtLeast(planId, "starter"),
    },
  };

  return json({
    shop: { id: shop.id, domain: shopDomain },
    planId,
    steps,
  });
};

export default function MigratePage() {
  const { shop, planId, steps } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const getStepProgress = () => {
    const completedCount = Object.values(steps).filter((s) => s.completed).length;
    return (completedCount / Object.keys(steps).length) * 100;
  };

  const progress = getStepProgress();

  const stepConfigs = [
    {
      id: "audit" as MigrationStep,
      title: "1. 扫描与评估",
      description: "自动扫描店铺中的追踪脚本，生成迁移清单和风险报告",
      url: "/app/audit",
      icon: CheckCircleIcon,
    },
    {
      id: "pixels" as MigrationStep,
      title: "2. 配置像素迁移",
      description: "创建 Web Pixel，配置事件映射和平台凭证",
      url: "/app/pixels/new",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
    {
      id: "modules" as MigrationStep,
      title: "3. 发布 UI 模块",
      description: "配置并发布 Thank you / Order status 页面模块",
      url: "/app/modules",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
    {
      id: "verification" as MigrationStep,
      title: "4. 验收与监控",
      description: "运行验收测试，生成报告，设置断档告警",
      url: "/app/verification",
      icon: CheckCircleIcon,
      requiresPlan: "starter" as PlanId,
    },
  ];

  if (!shop) {
    return (
      <Page title="迁移向导">
        <Banner tone="critical" title="未找到店铺信息">
          <Text as="p" variant="bodySm">
            请确保应用已正确安装。
          </Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="迁移向导" subtitle="从 Legacy Checkout 迁移到 Checkout Extensibility 的完整流程">
      <BlockStack gap="500">
        <PageIntroCard
          title="迁移向导"
          description="按照以下步骤完成从 Legacy Checkout 到 Checkout Extensibility 的迁移"
          items={[
            "扫描现有追踪脚本并评估风险",
            "配置 Web Pixel 和事件映射",
            "发布 UI 模块替代功能",
            "验收测试并生成报告",
          ]}
          primaryAction={{ content: "开始迁移", url: "/app/audit" }}
        />

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                迁移进度
              </Text>
              <Badge tone={progress === 100 ? "success" : progress > 0 ? "info" : undefined}>
                {Math.round(progress)}%
              </Badge>
            </InlineStack>
            <ProgressBar progress={progress} tone={progress === 100 ? "success" : undefined} />
            <Text as="p" variant="bodySm" tone="subdued">
              {Object.values(steps).filter((s) => s.completed).length} / {Object.keys(steps).length} 个步骤已完成
            </Text>
          </BlockStack>
        </Card>

        <Layout>
          {stepConfigs.map((stepConfig, index) => {
            const stepStatus = steps[stepConfig.id];
            const canAccess = stepConfig.requiresPlan
              ? isPlanAtLeast(planId, stepConfig.requiresPlan) && stepStatus.canAccess
              : stepStatus.canAccess;

            return (
              <Layout.Section key={stepConfig.id} variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          {stepStatus.completed ? (
                            <CheckCircleIcon tone="success" />
                          ) : (
                            <Text as="span" variant="headingLg" fontWeight="bold">
                              {index + 1}
                            </Text>
                          )}
                          <Text as="h3" variant="headingSm">
                            {stepConfig.title}
                          </Text>
                          {stepStatus.completed && <Badge tone="success">已完成</Badge>}
                          {!canAccess && stepConfig.requiresPlan && (
                            <Badge tone="warning">
                              {stepConfig.requiresPlan === "starter" ? "需要 Starter+" : "需要升级"}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stepConfig.description}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="end">
                      {canAccess ? (
                        <Button
                          url={stepConfig.url}
                          variant={stepStatus.completed ? "secondary" : "primary"}
                          icon={stepStatus.completed ? undefined : ArrowRightIcon}
                        >
                          {stepStatus.completed ? "查看详情" : "开始"}
                        </Button>
                      ) : (
                        <Button
                          url="/app/billing"
                          variant="secondary"
                          icon={LockIcon}
                        >
                          升级解锁
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        {progress === 100 && (
          <Banner tone="success" title="迁移完成！">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                恭喜！您已完成所有迁移步骤。建议定期运行验收测试以确保追踪持续稳定。
              </Text>
              <InlineStack gap="200">
                <Button url="/app/verification" variant="primary">
                  运行验收测试
                </Button>
                <Button url="/app/diagnostics" variant="secondary">
                  查看诊断
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              迁移步骤说明
            </Text>
            <Divider />
            <List type="number">
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    扫描与评估
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    自动扫描 ScriptTags 和 Web Pixels，手动粘贴识别 Additional Scripts，生成迁移清单和风险分级报告。
                    这是免费功能，帮助您了解需要迁移的内容。
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    配置像素迁移
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    创建 Web Pixel Extension，配置事件映射（Shopify 标准事件 → 平台事件），
                    设置平台凭证（GA4/Meta/TikTok）。需要 Starter ($29/月) 及以上套餐。
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    发布 UI 模块
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    配置并发布 Thank you / Order status 页面的 UI 模块（Survey、Help 等，Reorder 仅在 Order status 可用），
                    替代原有的 Additional Scripts 功能。需要 Starter ($29/月) 及以上套餐。
                  </Text>
                </BlockStack>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    验收与监控
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    运行验收测试验证事件触发和参数完整性，生成可交付的验收报告（PDF/CSV），
                    设置断档告警。报告导出需要 Growth ($79/月) 或 Agency ($199/月) 套餐。
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
          </BlockStack>
        </Card>

        <Banner tone="info" title="重要提示">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Shopify 升级截止日期
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  Plus 店铺：从 2026-01 开始自动升级（legacy 定制会丢失）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  非 Plus 店铺：最晚 2026-08-26 必须完成升级
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              建议尽早完成迁移，避免在截止日期前匆忙处理。
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Page>
  );
}
