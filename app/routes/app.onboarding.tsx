import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useActionData } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  ProgressBar,
  Icon,
  List,
  Checkbox,
  Link,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  ClockIcon,
} from "~/components/icons";
import { CardSkeleton, useToastContext } from "~/components/ui";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scanShopTracking } from "../services/scanner.server";
import { refreshTypOspStatus } from "../services/checkout-profile.server";
import { getScriptTagDeprecationStatus, getAdditionalScriptsDeprecationStatus, getMigrationUrgencyStatus, type ShopTier } from "../utils/deprecation-dates";
import type { ScriptTag, RiskItem } from "../types";
import { logger } from "../utils/logger.server";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers";
import { normalizePlanId } from "../services/billing/plans";
import { isPlanAtLeast } from "../utils/plans";

function estimateMigrationTime(
  scriptTagCount: number,
  platformCount: number,
  riskScore: number,
  riskItems?: RiskItem[]
): { hours: number; label: string; description: string } {
  const baseTime = 0.25;
  const highRiskScriptTags = riskItems?.filter(item => item.severity === "high").length || 0;
  const mediumRiskScriptTags = riskItems?.filter(item => item.severity === "medium").length || 0;
  const lowRiskScriptTags = (scriptTagCount - highRiskScriptTags - mediumRiskScriptTags) || 0;
  const perHighRiskScriptTag = 0.4;
  const perMediumRiskScriptTag = 0.25;
  const perLowRiskScriptTag = 0.15;
  const scriptTagTime =
    highRiskScriptTags * perHighRiskScriptTag +
    mediumRiskScriptTags * perMediumRiskScriptTag +
    lowRiskScriptTags * perLowRiskScriptTag;
  const simplePlatforms = ["google", "meta", "tiktok"];
  const perSimplePlatform = 0.3;
  const platformTime = platformCount * perSimplePlatform;
  let riskMultiplier = 1.0;
  if (riskScore > 70) {
    riskMultiplier = 1.6;
  } else if (riskScore > 50) {
    riskMultiplier = 1.4;
  } else if (riskScore > 30) {
    riskMultiplier = 1.2;
  } else if (riskScore > 10) {
    riskMultiplier = 1.1;
  }
  const parallelFactor = platformCount > 1 ? 0.7 : 1.0;
  const sequentialTime = baseTime + scriptTagTime + platformTime;
  const parallelTime = baseTime + scriptTagTime + (platformTime * parallelFactor);
  const totalHours = Math.max(sequentialTime, parallelTime) * riskMultiplier;
  let description = "";
  if (totalHours <= 0.5) {
    description = "您的配置相对简单，迁移将非常快速。建议一次性完成所有步骤。";
  } else if (totalHours <= 1) {
    description = "标准迁移流程，按步骤操作即可。建议预留 1 小时完成迁移和测试。";
  } else if (totalHours <= 2) {
    description = "需要一些时间处理多个平台或复杂配置。建议分 2-3 个阶段完成，每阶段完成后进行测试。";
  } else {
    description = "配置较为复杂，建议分阶段完成迁移。优先处理高风险项，确保每步验证后再继续。";
  }
  let label = "";
  if (totalHours <= 0.5) {
    label = "约 30 分钟";
  } else if (totalHours <= 1) {
    label = "约 1 小时";
  } else if (totalHours <= 1.5) {
    label = "约 1-1.5 小时";
  } else if (totalHours <= 2) {
    label = "约 1.5-2 小时";
  } else {
    label = "2+ 小时";
  }
  return {
    hours: Math.round(totalHours * 100) / 100,
    label,
    description
  };
}

interface OnboardingData {
  step: number;
  isScanning: boolean;
  scanComplete: boolean;
  shop: {
    id: string;
    domain: string;
    tier: ShopTier;
    typOspEnabled: boolean | null;
    typOspReason: string | null;
  } | null;
  scanResult: {
    riskScore: number;
    scriptTagCount: number;
    platformCount: number;
    platforms: string[];
    hasOrderStatusScripts: boolean;
    riskItems: RiskItem[];
  } | null;
  migrationEstimate: {
    hours: number;
    label: string;
    description: string;
  } | null;
  urgency: {
    level: "critical" | "high" | "medium" | "low" | "resolved";
    label: string;
    description: string;
  } | null;
  onboardingComplete: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const autoScan = url.searchParams.get("autoScan") === "true";
  const skipOnboarding = url.searchParams.get("skip") === "true";
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      shopTier: true,
      plan: true,
      typOspPagesEnabled: true,
      typOspStatusReason: true,
      ScanReports: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!shop) {
    return json<OnboardingData>({
      step: 1,
      isScanning: false,
      scanComplete: false,
      shop: null,
      scanResult: null,
      migrationEstimate: null,
      urgency: null,
      onboardingComplete: false,
    });
  }
  if (skipOnboarding) {
    return redirect("/app");
  }
    const planId = normalizePlanId(shop.plan ?? "free");
  const isAgency = isPlanAtLeast(planId, "agency");
    safeFireAndForget(
    trackEvent({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      event: "app_onboarding_started",
      eventId: `app_onboarding_started_${shop.id}`,
      metadata: {
        plan: shop.plan ?? "free",
        role: isAgency ? "agency" : "merchant",
              },
    })
  );
  const latestScan = shop.ScanReports?.[0];
  if (!latestScan && admin && !autoScan) {
    scanShopTracking(admin, shop.id).catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      logger.error("Auto-scan failed in onboarding", err instanceof Error ? err : new Error(String(err)), {
        shopId: shop.id,
        errorMessage,
        errorStack,
      });
    });
  }
  let scanResult: OnboardingData["scanResult"] = null;
  let migrationEstimate: OnboardingData["migrationEstimate"] = null;
  let urgency: OnboardingData["urgency"] = null;
  if (latestScan) {
    const scriptTags = (latestScan.scriptTags as ScriptTag[] | null) || [];
    const platforms = (latestScan.identifiedPlatforms as string[] | null) || [];
    const riskItems = (latestScan.riskItems as RiskItem[] | null) || [];
    const hasOrderStatusScripts = scriptTags.some(tag => tag.display_scope === "order_status");
    scanResult = {
      riskScore: latestScan.riskScore,
      scriptTagCount: scriptTags.length,
      platformCount: platforms.length,
      platforms,
      hasOrderStatusScripts,
      riskItems,
    };
    migrationEstimate = estimateMigrationTime(
      scriptTags.length,
      platforms.length,
      latestScan.riskScore,
      riskItems
    );
    const shopTier = (shop.shopTier as ShopTier) || "unknown";
    const migrationUrgency = getMigrationUrgencyStatus(shopTier, scriptTags.length > 0, hasOrderStatusScripts);
    urgency = {
      level: migrationUrgency.urgency,
      label: migrationUrgency.urgency === "critical" ? "紧急" :
             migrationUrgency.urgency === "high" ? "高优先级" :
             migrationUrgency.urgency === "medium" ? "中等" : "低",
      description: migrationUrgency.primaryMessage,
    };
  }
  let typOspEnabled = shop.typOspPagesEnabled;
  let typOspReason = shop.typOspStatusReason;
  if (admin && typOspEnabled === null) {
    try {
      const typOspResult = await refreshTypOspStatus(admin, shop.id);
      typOspEnabled = typOspResult.typOspPagesEnabled;
      if (typOspResult.status === "unknown") {
        typOspReason = typOspResult.unknownReason || "检测失败";
      }
    } catch (error) {
      logger.error("Failed to refresh TYP/OSP status", { error });
      typOspEnabled = false;
      typOspReason = "API错误，请稍后重试";
    }
  }
  const data: OnboardingData = {
    step: latestScan ? 3 : 1,
    isScanning: false,
    scanComplete: !!latestScan,
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      tier: (shop.shopTier as ShopTier) || "unknown",
      typOspEnabled,
      typOspReason,
    },
    scanResult,
    migrationEstimate,
    urgency,
    onboardingComplete: !!latestScan,
  };
  return json(data);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });
  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }
  if (actionType === "run_scan") {
    try {
      const scanResult = await scanShopTracking(admin, shop.id);
      return json({ success: true, actionType: "run_scan", result: scanResult });
    } catch (error) {
      logger.error("Onboarding scan error", { error });
      return json({ error: "扫描失败，请稍后重试" }, { status: 500 });
    }
  }
  if (actionType === "complete_onboarding") {
    return redirect("/app/audit/start");
  }
  return json({ error: "未知操作" }, { status: 400 });
};

function UrgencyBadge({ level }: { level: string }) {
  switch (level) {
    case "critical":
      return <Badge tone="critical">紧急</Badge>;
    case "high":
      return <Badge tone="warning">高优先级</Badge>;
    case "medium":
      return <Badge tone="attention">中等</Badge>;
    case "low":
      return <Badge tone="info">低</Badge>;
    case "resolved":
      return <Badge tone="success">已解决</Badge>;
    default:
      return <Badge>未知</Badge>;
  }
}

function StepIndicator({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <Box padding="400">
      <InlineStack gap="200" align="center">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <InlineStack key={step} gap="100" blockAlign="center">
            <Box
              background={step <= currentStep ? "bg-fill-success" : "bg-surface-secondary"}
              borderRadius="full"
              padding="200"
              minWidth="32px"
            >
              <Text
                as="span"
                variant="bodySm"
                fontWeight="bold"
                alignment="center"
              >
                {step < currentStep ? "✓" : step}
              </Text>
            </Box>
            {step < totalSteps && (
              <Box
                background={step < currentStep ? "bg-fill-success" : "bg-surface-secondary"}
                minWidth="40px"
                minHeight="2px"
              />
            )}
          </InlineStack>
        ))}
      </InlineStack>
    </Box>
  );
}

export default function OnboardingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToastContext();
  const [acknowledged, setAcknowledged] = useState(false);
  const isScanning = navigation.state === "submitting";
  const autoScan = searchParams.get("autoScan") === "true";
  useEffect(() => {
    if (actionData) {
      if ("success" in actionData && actionData.success) {
        if ("actionType" in actionData && actionData.actionType === "run_scan") {
          showSuccess("扫描完成！正在加载结果...");
        } else if ("actionType" in actionData && actionData.actionType === "complete_onboarding") {
          showSuccess("欢迎使用 Tracking Guardian！");
        } else {
          showSuccess("操作成功");
        }
      } else if ("error" in actionData && actionData.error) {
        showError(actionData.error);
      }
    }
  }, [actionData, showSuccess, showError]);
  useEffect(() => {
    if (autoScan && !data.scanComplete && !isScanning) {
      handleStartScan();
    }
  }, [autoScan]);
  const handleStartScan = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "run_scan");
    submit(formData, { method: "post" });
  }, [submit]);
  const handleCompleteOnboarding = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "complete_onboarding");
    submit(formData, { method: "post" });
  }, [submit]);
  const getPlatformName = (platform: string) => {
    const names: Record<string, string> = {
      google: "Google Analytics 4",
      meta: "Meta (Facebook) Pixel",
      tiktok: "TikTok Pixel",
    };
    return names[platform] || platform;
  };
  if (!data.shop) {
    return (
      <Page title="欢迎使用 Tracking Guardian">
        <Card>
          <Banner tone="critical">
            <Text as="p">店铺信息加载失败，请刷新页面重试。</Text>
          </Banner>
        </Card>
      </Page>
    );
  }
  return (
    <Page
      title="🚀 欢迎使用升级迁移交付平台"
      subtitle="升级不丢功能/不丢数据 • 可交付的验收报告 • 上线后有断档告警"
    >
      <BlockStack gap="500">
        <Card>
          <StepIndicator currentStep={data.step} totalSteps={3} />
          <Divider />
          <Box padding="400">
            <InlineStack gap="400" align="space-between">
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">步骤 1</Text>
                <Text as="span" fontWeight={data.step >= 1 ? "bold" : "regular"}>
                  自动体检
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">步骤 2</Text>
                <Text as="span" fontWeight={data.step >= 2 ? "bold" : "regular"}>
                  风险评估
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">步骤 3</Text>
                <Text as="span" fontWeight={data.step >= 3 ? "bold" : "regular"}>
                  开始迁移
                </Text>
              </BlockStack>
            </InlineStack>
          </Box>
        </Card>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                📋 店铺状态概览
              </Text>
              <Badge tone={data.shop.typOspEnabled ? "success" : "warning"}>
                {data.shop.typOspEnabled ? "已升级新页面" : "使用旧页面"}
              </Badge>
            </InlineStack>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">店铺域名</Text>
                    <Text as="p" fontWeight="semibold">{data.shop.domain}</Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">店铺类型</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.tier === "plus" ? "Shopify Plus" :
                       data.shop.tier === "non_plus" ? "标准版" : "待检测"}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Thank you 页面</Text>
                    <Text as="p" fontWeight="semibold">
                      {data.shop.typOspEnabled === null ? "待检测" :
                       data.shop.typOspEnabled ? "新版 (Extensibility)" : "旧版"}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
            {data.shop.typOspReason && !data.shop.typOspEnabled && (
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  检测提示: {data.shop.typOspReason}
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>
        {!data.scanComplete && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🔍 自动体检
                </Text>
              </InlineStack>
              <Text as="p" tone="subdued">
                我们将自动扫描您店铺中的 ScriptTags 和 Web Pixels，Additional Scripts 需要通过手动粘贴识别，
                识别需要迁移的脚本并评估风险等级。
              </Text>
              {isScanning ? (
                <Card>
                  <BlockStack gap="400">
                    <CardSkeleton lines={4} showTitle={true} />
                    <Box paddingBlockStart="200">
                      <ProgressBar progress={60} tone="primary" />
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        这通常需要 10-30 秒，请勿关闭页面
                      </Text>
                    </Box>
                  </BlockStack>
                </Card>
              ) : (
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">扫描内容包括：</Text>
                      <List type="bullet">
                        <List.Item>ScriptTags (第三方追踪脚本)</List.Item>
                        <List.Item>Web Pixels (已安装的像素应用)</List.Item>
                        <List.Item>Checkout 配置状态</List.Item>
                        <List.Item>追踪平台识别 (GA4/Meta/TikTok 等)</List.Item>
                      </List>
                    </BlockStack>
                  </Box>
                  <Checkbox
                    label="我了解扫描不会修改任何店铺设置"
                    checked={acknowledged}
                    onChange={setAcknowledged}
                  />
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={handleStartScan}
                      disabled={!acknowledged}
                      loading={isScanning}
                      size="large"
                    >
                      开始自动体检
                    </Button>
                    <Button url="/app?skip=true" variant="plain">
                      跳过，稍后扫描
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {data.scanComplete && data.scanResult && (
          <>
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">风险评分</Text>
                    <Box
                      background={
                        data.scanResult.riskScore > 60
                          ? "bg-fill-critical"
                          : data.scanResult.riskScore > 30
                            ? "bg-fill-warning"
                            : "bg-fill-success"
                      }
                      padding="600"
                      borderRadius="200"
                    >
                      <BlockStack gap="200" align="center">
                        <Text as="p" variant="heading3xl" fontWeight="bold">
                          {data.scanResult.riskScore}
                        </Text>
                        <Text as="p" variant="bodySm">/100</Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.scanResult.riskScore > 60
                        ? "需要立即处理"
                        : data.scanResult.riskScore > 30
                          ? "建议尽快迁移"
                          : "风险较低"}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">预计迁移时间</Text>
                    <Box background="bg-surface-secondary" padding="600" borderRadius="200">
                      <BlockStack gap="200" align="center">
                        <Icon source={ClockIcon} tone="base" />
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {data.migrationEstimate?.label || "待评估"}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.migrationEstimate?.description || "完成扫描后显示"}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">迁移紧急度</Text>
                    <Box
                      background={
                        data.urgency?.level === "critical"
                          ? "bg-fill-critical-secondary"
                          : data.urgency?.level === "high"
                            ? "bg-fill-warning-secondary"
                            : "bg-surface-secondary"
                      }
                      padding="600"
                      borderRadius="200"
                    >
                      <BlockStack gap="200" align="center">
                        <UrgencyBadge level={data.urgency?.level || "unknown"} />
                        <Text as="p" variant="headingMd" fontWeight="bold">
                          {data.urgency?.label || "待评估"}
                        </Text>
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {data.urgency?.description || ""}
                    </Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">📊 检测结果摘要</Text>
                <Divider />
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text as="span">ScriptTags 数量</Text>
                        <Badge tone={data.scanResult.scriptTagCount > 0 ? "warning" : "success"}>
                          {`${data.scanResult.scriptTagCount} 个`}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">订单状态页脚本</Text>
                        <Badge tone={data.scanResult.hasOrderStatusScripts ? "critical" : "success"}>
                          {data.scanResult.hasOrderStatusScripts ? "有" : "无"}
                        </Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span">识别的平台</Text>
                        <Text as="span" fontWeight="semibold">
                          {data.scanResult.platformCount} 个
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="semibold">检测到的追踪平台：</Text>
                      {data.scanResult.platforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {data.scanResult.platforms.map((platform) => (
                            <Badge key={platform}>{getPlatformName(platform)}</Badge>
                          ))}
                        </InlineStack>
                      ) : (
                        <Text as="p" tone="subdued">未检测到已知追踪平台</Text>
                      )}
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>
            {data.scanResult.riskItems.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">⚠️ 风险项</Text>
                  <Divider />
                  <BlockStack gap="300">
                    {data.scanResult.riskItems.slice(0, 5).map((item, index) => (
                      <Box
                        key={index}
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="100">
                            <InlineStack gap="200">
                              <Icon
                                source={AlertCircleIcon}
                                tone={
                                  item.severity === "high"
                                    ? "critical"
                                    : item.severity === "medium"
                                      ? "warning"
                                      : "info"
                                }
                              />
                              <Text as="span" fontWeight="semibold">{item.name}</Text>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {item.description}
                            </Text>
                          </BlockStack>
                          <Badge
                            tone={
                              item.severity === "high"
                                ? "critical"
                                : item.severity === "medium"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {item.severity === "high" ? "高风险" :
                             item.severity === "medium" ? "中风险" : "低风险"}
                          </Badge>
                        </InlineStack>
                      </Box>
                    ))}
                    {data.scanResult.riskItems.length > 5 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        还有 {data.scanResult.riskItems.length - 5} 个风险项，查看完整报告了解详情
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            )}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">🎯 下一步操作</Text>
                <Divider />
                <BlockStack gap="300">
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="span" fontWeight="semibold">1. 查看完整扫描报告</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          了解每个风险项的详情和迁移建议
                        </Text>
                      </BlockStack>
                      <Button url="/app/audit/report" icon={ArrowRightIcon}>
                        查看报告
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">2. 配置追踪平台凭证</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          设置 GA4、Meta、TikTok 等平台的 API 凭证
                        </Text>
                      </BlockStack>
                      <Button url="/app/settings">
                        前往设置
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">3. 安装 Web Pixel</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          替换旧的 ScriptTag，启用新的追踪方式
                        </Text>
                      </BlockStack>
                      <Button url="/app/migrate">
                        开始迁移
                      </Button>
                    </InlineStack>
                  </Box>
                  <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200">
                          <Text as="span" fontWeight="semibold">4. 验收测试</Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          下测试订单，验证追踪是否正常工作
                        </Text>
                      </BlockStack>
                      <Button url="/app/verification">
                        验收向导
                      </Button>
                    </InlineStack>
                  </Box>
                </BlockStack>
                <Banner tone="critical">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      ⚠️ 重要提示：Order Status 模块需要 Customer Accounts
                    </Text>
                    <Text as="p" variant="bodySm">
                      如果您计划使用 Order Status 页面模块（如 Reorder、Survey 等），需要确保您的店铺已启用 Customer Accounts 功能。Order Status 模块仅支持 Customer Accounts 体系下的订单状态页（customer-account.order-status.block.render target），不支持旧版订单状态页。这是 Shopify 平台的设计限制。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      如何检查并启用 Customer Accounts：
                    </Text>
                    <List type="number">
                      <List.Item>
                        前往 Shopify Admin → 设置 → 客户账户（Settings → Customer accounts）
                      </List.Item>
                      <List.Item>
                        确认 Customer Accounts 功能已启用：如果设置页面显示"客户账户"或"Customer Accounts"选项，说明已启用。如果页面显示"客户账户"相关设置选项（如登录方式、注册方式等），说明 Customer Accounts 已启用
                      </List.Item>
                      <List.Item>
                        如何确认店铺是否支持 Customer Accounts：如果 Shopify Admin → 设置中没有"客户账户"或"Customer Accounts"选项，说明您的店铺当前不支持 Customer Accounts 功能。某些地区、店铺类型或 Shopify 计划可能暂时不支持 Customer Accounts。请以 Shopify Admin 中的实际选项为准
                      </List.Item>
                      <List.Item>
                        如果支持但未启用：请按照 Shopify 官方指引启用 Customer Accounts 功能。启用后，订单状态页将自动切换到 Customer Accounts 体系，旧版订单状态页将不再使用
                      </List.Item>
                      <List.Item>
                        如果店铺不支持 Customer Accounts：Order Status 模块将无法使用。这是 Shopify 平台的设计限制，Order Status 模块只能在 Customer Accounts 体系下工作
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="subdued">
                      更多信息请参考 <Link url="https://shopify.dev/docs/apps/customer-accounts/ui-extensions" external>Customer Accounts UI Extensions 官方文档</Link>。注意：不要参考 checkout-ui-extensions 文档，该文档可能显示此 target 为"Not supported"，这是文档版本差异导致的误导。
                    </Text>
                  </BlockStack>
                </Banner>
                <Divider />
                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleCompleteOnboarding}
                    size="large"
                    icon={ArrowRightIcon}
                  >
                    开始迁移之旅
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </>
        )}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 需要帮助？</Text>
            <Text as="p" tone="subdued">
              如果您在迁移过程中遇到问题，我们提供以下支持：
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="https://shopify.dev/docs/apps/online-store/checkout-extensibility" external>
                Shopify 官方文档
              </Button>
              <Button url="/support">
                联系支持
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
