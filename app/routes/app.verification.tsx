import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect, Suspense, lazy } from "react";
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
  DataTable,
  Tabs,
  List,
  Icon,
  Modal,
  Collapsible,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ClipboardIcon,
  ExportIcon,
  RefreshIcon,
  PlayIcon,
  FileIcon,
} from "~/components/icons";
import { CardSkeleton, useToastContext, EnhancedEmptyState } from "~/components/ui";
import { CheckoutExtensibilityWarning } from "~/components/verification/CheckoutExtensibilityWarning";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import {
  createVerificationRun,
  startVerificationRun,
  analyzeRecentEvents,
  getVerificationHistory,
  generateTestOrderGuide,
  VERIFICATION_TEST_ITEMS,
  type VerificationSummary,
} from "../services/verification.server";
import {
  generateTestChecklist,
  type TestChecklist,
} from "../services/verification-checklist.server";
import {
  generateChecklistMarkdown,
  generateChecklistCSV,
} from "../utils/verification-checklist";
import {
  checkFeatureAccess,
  type FeatureGateResult,
} from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId, planSupportsReportExport } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";

const RealtimeEventMonitor = lazy(() => import("~/components/verification/RealtimeEventMonitor").then(module => ({ default: module.RealtimeEventMonitor })));
const TestOrderGuide = lazy(() => import("~/components/verification/TestOrderGuide").then(module => ({ default: module.TestOrderGuide })));
const ReportShare = lazy(() => import("~/components/verification/ReportShare").then(module => ({ default: module.ReportShare })));
const ReportComparison = lazy(() => import("~/components/verification/ReportComparison").then(module => ({ default: module.ReportComparison })));
const ChannelReconciliationChart = lazy(() => import("~/components/verification/ChannelReconciliationChart").then(module => ({ default: module.ChannelReconciliationChart })));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
      pixelConfigs: {
        where: { isActive: true, serverSideEnabled: true },
        select: { platform: true },
      },
    },
  });

  if (!shop) {
    return json({
      shop: null,
      configuredPlatforms: [],
      history: [],
      latestRun: null,
      testGuide: generateTestOrderGuide("quick"),
      testItems: VERIFICATION_TEST_ITEMS,
      testChecklist: generateTestChecklist("", "quick"),
      canAccessVerification: false,
      canExportReports: false,
      gateResult: undefined,
      currentPlan: "free" as PlanId,
    });
  }

  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "verification");
  const canAccessVerification = gateResult.allowed;
  const canExportReports = planSupportsReportExport(planId);

  const configuredPlatforms = shop.pixelConfigs.map((c) => c.platform);
  const history = await getVerificationHistory(shop.id, 5);

  const latestRun = history?.[0] ?? null;

  const testChecklist = generateTestChecklist(shop.id, "quick");

  return json({
    shop: { id: shop.id, domain: shopDomain },
    configuredPlatforms,
    history,
    latestRun,
    testGuide: generateTestOrderGuide("quick"),
    testItems: VERIFICATION_TEST_ITEMS,
    testChecklist,
    canAccessVerification,
    canExportReports,
    gateResult: gateResult.allowed ? undefined : gateResult,
    currentPlan: planId,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  if (actionType === "create_run") {
    const runType = (formData.get("runType") as "quick" | "full") || "quick";
    const runId = await createVerificationRun(shop.id, { runType });
    return json({ success: true, runId, actionType: "create_run" });
  }

  if (actionType === "run_verification") {
    const runId = formData.get("runId") as string;
    if (!runId) {

      const newRunId = await createVerificationRun(shop.id, { runType: "quick" });
      await startVerificationRun(newRunId);
      const result = await analyzeRecentEvents(shop.id, newRunId);
      return json({ success: true, result, actionType: "run_verification" });
    }

    await startVerificationRun(runId);
    const result = await analyzeRecentEvents(shop.id, runId);
    return json({ success: true, result, actionType: "run_verification" });
  }

  if (actionType === "verifyTestItem") {
    try {
      const itemId = formData.get("itemId") as string;
      const eventType = formData.get("eventType") as string;
      const expectedEventsStr = formData.get("expectedEvents") as string;

      if (!itemId || !eventType || !expectedEventsStr) {
        return json({ success: false, error: "缺少必要参数" }, { status: 400 });
      }

      const expectedEvents = JSON.parse(expectedEventsStr) as string[];

      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

      const eventLogs = await prisma.eventLog.findMany({
        where: {
          shopId: shop.id,
          createdAt: { gte: fiveMinutesAgo },

          OR: [
            { eventName: { in: expectedEvents } },
            { eventName: eventType },
          ],
        },
        include: {
          DeliveryAttempt: {
            where: {
              status: { in: ["ok", "fail"] },
            },
            select: {
              id: true,
              destinationType: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      const foundEvents = new Set<string>();

      for (const eventLog of eventLogs) {

        const eventName = eventLog.eventName;

        const normalizedEvent = eventLog.normalizedEventJson as Record<string, unknown> | null;
        const shopifyEventName = normalizedEvent?.shopifyEventName as string | undefined;

        const hasValidDelivery = eventLog.DeliveryAttempt.length > 0;

        if (hasValidDelivery) {

          for (const expected of expectedEvents) {
            if (eventName.toLowerCase() === expected.toLowerCase() ||
                shopifyEventName?.toLowerCase() === expected.toLowerCase() ||
                eventName.toLowerCase().includes(expected.toLowerCase()) ||
                expected.toLowerCase().includes(eventName.toLowerCase()) ||
                shopifyEventName?.toLowerCase().includes(expected.toLowerCase()) ||
                expected.toLowerCase().includes(shopifyEventName?.toLowerCase() || "")) {
              foundEvents.add(expected);
            }
          }
        }
      }

      const verified = foundEvents.size === expectedEvents.length;
      const missingEvents = expectedEvents.filter((e) => !foundEvents.has(e));

      return json({
        success: true,
        itemId,
        verified,
        eventsFound: foundEvents.size,
        expectedEvents: expectedEvents.length,
        missingEvents,
        errors: verified ? undefined : [
          `未找到以下事件: ${missingEvents.join(", ")}`,
          "请确保已完成测试订单，并等待几秒钟后重试",
        ],
      });
    } catch (error) {
      logger.error("Failed to verify test item", { shopId: shop.id, error });
      return json({
        success: false,
        error: error instanceof Error ? error.message : "验证失败",
      }, { status: 500 });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Badge tone="success">通过</Badge>;
    case "failed":
      return <Badge tone="critical">失败</Badge>;
    case "missing_params":
      return <Badge tone="warning">参数缺失</Badge>;
    case "not_tested":
      return <Badge>未测试</Badge>;
    case "completed":
      return <Badge tone="success">已完成</Badge>;
    case "running":
      return <Badge tone="info">运行中</Badge>;
    case "pending":
      return <Badge>待运行</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function PlatformBadge({ platform }: { platform: string }) {
  const names: Record<string, string> = {
    google: "GA4",
    meta: "Meta",
    tiktok: "TikTok",
    pinterest: "Pinterest",
  };
  return <Badge>{names[platform] || platform}</Badge>;
}

function ScoreCard({
  title,
  score,
  description,
  tone,
}: {
  title: string;
  score: number;
  description: string;
  tone: "success" | "warning" | "critical";
}) {
  return (
    <Box
      background={
        tone === "success"
          ? "bg-fill-success-secondary"
          : tone === "warning"
            ? "bg-fill-warning-secondary"
            : "bg-fill-critical-secondary"
      }
      padding="400"
      borderRadius="200"
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {score}%
        </Text>
        <Text as="p" variant="bodySm">
          {description}
        </Text>
      </BlockStack>
    </Box>
  );
}

export default function VerificationPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { shop, configuredPlatforms, history, latestRun, testGuide, testItems, testChecklist, canAccessVerification, canExportReports, currentPlan } = loaderData;
  const gateResult = ("gateResult" in loaderData && loaderData.gateResult) as FeatureGateResult | undefined;
  const shopDomain = shop?.domain || "";
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { showSuccess, showError } = useToastContext();

  useEffect(() => {
    if (actionData) {
      const data = actionData as { success?: boolean; error?: string; actionType?: string };
      if (data.success) {
        showSuccess("验收运行已启动");
        revalidator.revalidate();
      } else if (data.error) {
        showError(data.error);
      }
    }
  }, [actionData, showSuccess, showError, revalidator]);
  const [selectedTab, setSelectedTab] = useState(0);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [guideExpanded, setGuideExpanded] = useState(true);

  const isRunning = navigation.state === "submitting";

  const handleRunVerification = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "run_verification");
    submit(formData, { method: "post" });
  }, [submit]);

  const copyTestGuide = useCallback(() => {
    const guideText = testGuide.steps
      .map((s) => `${s.step}. ${s.title}\n   ${s.description}`)
      .join("\n\n");
    const tipsText = testGuide.tips.map((t) => `• ${t}`).join("\n");
    const fullText = `# 验收测试指引\n\n预计时间: ${testGuide.estimatedTime}\n\n## 测试步骤\n\n${guideText}\n\n## 提示\n\n${tipsText}`;
    navigator.clipboard.writeText(fullText);
  }, [testGuide]);

  const handleExportPdf = useCallback(() => {
    if (!latestRun) return;

    if (canExportReports) {
      window.location.href = `/api/reports/pdf?type=verification&runId=${latestRun.runId}&format=pdf`;
      return;
    }

    window.location.href = "/app/billing?upgrade=growth";
  }, [latestRun, canExportReports]);

  const handleExportCsv = useCallback(() => {
    if (!latestRun) return;

    if (canExportReports) {
      window.location.href = `/api/reports?type=verification&runId=${latestRun.runId}&format=csv`;
      return;
    }

    window.location.href = "/app/billing?upgrade=growth";
  }, [latestRun, canExportReports]);

  const tabs = [
    { id: "overview", content: "验收概览" },
    { id: "pixel-layer", content: "像素层验收（Web Pixels 标准事件）" },
    { id: "results", content: "详细结果" },
    { id: "realtime", content: "实时监控" },
    { id: "test-guide", content: "测试订单指引" },
    { id: "history", content: "历史记录" },
  ];

  if (!shop) {
    return (
      <Page title="验收向导">
        <EnhancedEmptyState
          icon="⚠️"
          title="未找到店铺配置"
          description="请确保应用已正确安装。"
          primaryAction={{
            content: "返回首页",
            url: "/app",
          }}
        />
      </Page>
    );
  }

  if (!canAccessVerification && gateResult) {
    return (
      <Page title="验收向导">
        <UpgradePrompt
          feature="verification"
          currentPlan={currentPlan || "free"}
          gateResult={gateResult}
        />
      </Page>
    );
  }

  const passRate = latestRun
    ? latestRun.totalTests > 0
      ? Math.round((latestRun.passedTests / latestRun.totalTests) * 100)
      : 0
    : 0;

  return (
    <Page
      title="验收（Verification）+ 断档监控（Monitoring）"
      subtitle="测试清单 + 事件触发记录 + 参数完整率 + 订单金额/币种一致性 • 隐私合规检查（consent/customerPrivacy）• 验收报告导出（PDF/CSV）是核心付费点（给老板/客户看的证据）• Growth 套餐 $79/月 或 Agency 套餐 $199/月"
      primaryAction={{
        content: isRunning ? "运行中..." : "运行验收",
        onAction: handleRunVerification,
        loading: isRunning,
        icon: PlayIcon,
      }}
      secondaryActions={[
        {
          content: "刷新",
          onAction: () => revalidator.revalidate(),
          icon: RefreshIcon,
        },
        ...(latestRun && canExportReports ? [
          {
            content: "导出 PDF",
            onAction: handleExportPdf,
            icon: FileIcon,
          },
          {
            content: "导出 CSV",
            onAction: handleExportCsv,
            icon: ExportIcon,
          },
        ] : []),
      ]}
    >
      <BlockStack gap="500">
        {}
        <Banner
          title="⚠️ v1.0 验收范围说明（重要）"
          tone="warning"
        >
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>v1.0 版本仅支持 checkout/purchase 漏斗事件验收</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>✅ 支持的事件类型：</strong>checkout_started、checkout_completed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted、product_added_to_cart、product_viewed、page_viewed 等 Web Pixels 标准 checkout 漏斗事件
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>❌ 不支持的事件类型：</strong>退款（refund）、订单取消（cancel）、订单编辑（order_edit）、订阅订单（subscription）等事件在 v1.0 中不可验收
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>原因：</strong>Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单 webhooks 实现（严格做 PII 最小化）
                </Text>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>注意：</strong>v1.0 验收范围与 Web Pixel Extension 的能力范围一致，符合隐私最小化原则。
            </Text>
          </BlockStack>
        </Banner>

        {}
        <Banner tone="info" title="重要说明：事件发送与平台归因">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>本应用仅保证事件生成与发送成功，不保证平台侧归因一致。</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们保证：</strong>事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制等。
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>验收报告说明：</strong>本验收报告仅验证事件是否成功发送到平台 API，以及事件参数是否完整。平台侧报表中的归因数据可能因平台算法、数据处理延迟等因素与 Shopify 订单数据存在差异，这是正常现象。
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
        {}
        <CheckoutExtensibilityWarning />

        {configuredPlatforms.length === 0 && (
          <Banner
            title="未配置服务端追踪"
            tone="warning"
            action={{ content: "前往配置", url: "/app/settings" }}
          >
            <p>请先在设置页面配置至少一个平台的 CAPI 凭证，然后再进行验收测试。</p>
          </Banner>
        )}

        {latestRun && !canExportReports && (
          <Banner
            title="📄 生成验收报告（PDF/CSV）- 核心付费点"
            tone="warning"
            action={{
              content: "升级到 Growth 套餐（$79/月）",
              url: "/app/billing?upgrade=growth"
            }}
          >
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                需要 <strong>Growth 成长版</strong> ($79/月) 或 <strong>Agency 版</strong> ($199/月) 套餐。
              </Text>
              <Text as="p" variant="bodySm">
                报告包含：测试清单 + 事件触发记录 + 参数完整率 + 订单金额/币种一致性 + 隐私合规检查（consent/customerPrivacy）
              </Text>
              <Text as="p" variant="bodySm">
                这是项目的核心交付件，适合 Agency 直接报给客户的验收报告。
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                当前套餐：<strong>{currentPlan === "free" ? "免费版" : currentPlan === "starter" ? "Migration 迁移版" : currentPlan}</strong>
              </Text>
            </BlockStack>
          </Banner>
        )}

        {}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              📋 v1.0 验收范围说明
            </Text>
            <Text as="p" variant="bodySm">
              <strong>v1.0 版本验收范围：</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                ✅ <strong>Checkout/Purchase 漏斗事件</strong>：checkout_started, checkout_completed, product_added_to_cart, product_viewed, page_viewed 等
              </List.Item>
              <List.Item>
                ❌ <strong>退款、取消、编辑订单、订阅事件</strong>：这些事件类型将在 v1.1+ 版本中通过订单 webhooks 实现
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>原因：</strong>Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，v1.0 版本仅依赖 Web Pixel Extension，不处理订单相关 webhooks（符合隐私最小化原则）。
            </Text>
          </BlockStack>
        </Banner>

        {}
        {}
        <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />

        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                📋 测试订单指引
              </Text>
              <InlineStack gap="200">
                <Button icon={ClipboardIcon} onClick={copyTestGuide} size="slim">
                  复制指引
                </Button>
                <Button
                  onClick={() => setGuideExpanded(!guideExpanded)}
                  size="slim"
                  variant="plain"
                >
                  {guideExpanded ? "收起" : "展开"}
                </Button>
              </InlineStack>
            </InlineStack>

            <Collapsible open={guideExpanded} id="guide-collapsible">
              <BlockStack gap="300">
                <InlineStack gap="200">
                  <Badge tone="info">{`预计时间: ${testGuide.estimatedTime}`}</Badge>
                  {configuredPlatforms.map((p) => (
                    <PlatformBadge key={p} platform={p} />
                  ))}
                </InlineStack>

                <Divider />

                <BlockStack gap="300">
                  {testGuide.steps.map((step) => (
                    <Box
                      key={step.step}
                      background="bg-surface-secondary"
                      padding="300"
                      borderRadius="100"
                    >
                      <InlineStack gap="300" blockAlign="start">
                        <Box
                          background="bg-fill-info"
                          padding="100"
                          borderRadius="full"
                          minWidth="24px"
                        >
                          <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">
                            {step.step}
                          </Text>
                        </Box>
                        <BlockStack gap="100">
                          <Text as="span" fontWeight="semibold">
                            {step.title}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {step.description}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>

                <Divider />

                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    💡 提示
                  </Text>
                  <List type="bullet">
                    {testGuide.tips.map((tip, i) => (
                      <List.Item key={i}>
                        <Text as="span" variant="bodySm">
                          {tip}
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </BlockStack>
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>

        {}
        {testChecklist && testChecklist.items.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📝 详细测试清单
                </Text>
                <InlineStack gap="200">
                  <Button
                    icon={ClipboardIcon}
                    onClick={() => {
                      const checklist: TestChecklist = {
                        ...testChecklist,
                        generatedAt: new Date(testChecklist.generatedAt),
                      };
                      const markdown = generateChecklistMarkdown(checklist);
                      navigator.clipboard.writeText(markdown);
                      showSuccess("测试清单已复制到剪贴板");
                    }}
                    size="slim"
                  >
                    复制清单
                  </Button>
                  <Button
                    icon={ExportIcon}
                    onClick={() => {
                      const checklist: TestChecklist = {
                        ...testChecklist,
                        generatedAt: new Date(testChecklist.generatedAt),
                      };
                      const csv = generateChecklistCSV(checklist);
                      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `test-checklist-${new Date().toISOString().split("T")[0]}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showSuccess("测试清单已导出");
                    }}
                    size="slim"
                  >
                    导出 CSV
                  </Button>
                </InlineStack>
              </InlineStack>

              <BlockStack gap="200">
                <InlineStack gap="300" wrap>
                  <Badge tone="info">
                    {`${String(testChecklist.requiredItemsCount)} 项必需`}
                  </Badge>
                  <Badge>
                    {`${String(testChecklist.optionalItemsCount)} 项可选`}
                  </Badge>
                  <Badge tone="success">
                    {`预计 ${String(Math.floor(testChecklist.totalEstimatedTime / 60))} 小时 ${String(testChecklist.totalEstimatedTime % 60)} 分钟`}
                  </Badge>
                </InlineStack>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                {testChecklist.items.map((item) => (
                  <Box
                    key={item.id}
                    background={item.required ? "bg-fill-warning-secondary" : "bg-surface-secondary"}
                    padding="400"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" fontWeight="semibold">
                              {item.required ? "✅" : "⚪"} {item.name}
                            </Text>
                            <Badge tone={item.required ? "warning" : "info"}>
                              {item.required ? "必需" : "可选"}
                            </Badge>
                            <Badge>{item.category}</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {item.description}
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              平台: {item.platforms.join(", ")}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              • 预计 {item.estimatedTime} 分钟
                            </Text>
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          操作步骤
                        </Text>
                        <List type="number">
                          {item.steps.map((step, i) => (
                            <List.Item key={i}>
                              <Text as="span" variant="bodySm">
                                {step.replace(/^\d+\.\s*/, "")}
                              </Text>
                            </List.Item>
                          ))}
                        </List>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          预期结果
                        </Text>
                        <List>
                          {item.expectedResults.map((result, i) => (
                            <List.Item key={i}>
                              <Text as="span" variant="bodySm">
                                {result}
                              </Text>
                            </List.Item>
                          ))}
                        </List>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {}
        <Banner tone="info" title="重要说明：事件发送与平台归因">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <strong>本应用仅保证事件生成与发送成功，不保证平台侧归因一致。</strong>
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们保证：</strong>事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、平台数据去重和合并规则等。
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <strong>验证方法：</strong>您可以通过本应用的验收报告查看事件发送状态和请求/响应详情，或使用平台提供的测试工具（如 Meta Events Manager、GA4 DebugView）验证事件接收情况。
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {}
          {selectedTab === 0 && (
            <Box padding="400">
              <BlockStack gap="500">
                {isRunning && (
                  <Card>
                    <BlockStack gap="400">
                      <CardSkeleton lines={3} showTitle={true} />
                      <Box padding="200">
                        <ProgressBar progress={75} tone="primary" />
                      </Box>
                    </BlockStack>
                  </Card>
                )}

                {!isRunning && latestRun && (
                  <>
                    {}
                    <Layout>
                      <Layout.Section variant="oneThird">
                        <ScoreCard
                          title="通过率"
                          score={passRate}
                          description={`${latestRun.passedTests}/${latestRun.totalTests} 项测试通过`}
                          tone={passRate >= 80 ? "success" : passRate >= 50 ? "warning" : "critical"}
                        />
                      </Layout.Section>
                      <Layout.Section variant="oneThird">
                        <ScoreCard
                          title="参数完整率"
                          score={latestRun.parameterCompleteness}
                          description="事件参数完整程度"
                          tone={
                            latestRun.parameterCompleteness >= 80
                              ? "success"
                              : latestRun.parameterCompleteness >= 50
                                ? "warning"
                                : "critical"
                          }
                        />
                      </Layout.Section>
                      <Layout.Section variant="oneThird">
                        <ScoreCard
                          title="金额准确率"
                          score={latestRun.valueAccuracy}
                          description="订单金额与事件一致"
                          tone={
                            latestRun.valueAccuracy >= 95
                              ? "success"
                              : latestRun.valueAccuracy >= 80
                                ? "warning"
                                : "critical"
                          }
                        />
                      </Layout.Section>
                    </Layout>

                    {}
                    <Card>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            验收状态
                          </Text>
                          <StatusBadge status={latestRun.status} />
                        </InlineStack>

                        <Divider />

                        <InlineStack gap="400" align="space-between">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              验收时间
                            </Text>
                            <Text as="p" fontWeight="semibold">
                              {latestRun.completedAt
                                ? new Date(latestRun.completedAt).toLocaleString("zh-CN")
                                : "-"}
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              验收类型
                            </Text>
                            <Text as="p" fontWeight="semibold">
                              {latestRun.runType === "full" ? "完整验收" : "快速验收"}
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              测试平台
                            </Text>
                            <InlineStack gap="100">
                              {latestRun.platforms.map((p) => (
                                <PlatformBadge key={p} platform={p} />
                              ))}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>

                        {}
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                          <InlineStack gap="400" align="space-between">
                            <BlockStack gap="100" align="center">
                              <Icon source={CheckCircleIcon} tone="success" />
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {latestRun.passedTests}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                通过
                              </Text>
                            </BlockStack>
                            <BlockStack gap="100" align="center">
                              <Icon source={AlertCircleIcon} tone="warning" />
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {latestRun.missingParamTests}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                参数缺失
                              </Text>
                            </BlockStack>
                            <BlockStack gap="100" align="center">
                              <Icon source={AlertCircleIcon} tone="critical" />
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {latestRun.failedTests}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                失败
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </Box>

                        {}
                        {latestRun.failedTests > 0 && (
                          <Banner tone="critical" title="存在失败的测试项">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm">
                                请检查以下可能的原因：
                              </Text>
                              <List type="bullet">
                                <List.Item>平台 CAPI 凭证是否正确配置</List.Item>
                                <List.Item>凭证是否已过期</List.Item>
                                <List.Item>平台端是否有 IP 限制或其他安全设置</List.Item>
                              </List>
                            </BlockStack>
                          </Banner>
                        )}

                        {latestRun.missingParamTests > 0 && latestRun.failedTests === 0 && (
                          <Banner tone="warning" title="部分事件参数不完整">
                            <Text as="p" variant="bodySm">
                              某些事件缺少必要参数（如 value 或 currency），可能影响归因效果。
                              请检查订单数据是否完整。
                            </Text>
                          </Banner>
                        )}

                        {passRate >= 80 && (
                          <Banner tone="success" title="验收通过">
                            <Text as="p" variant="bodySm">
                              🎉 您的追踪配置工作正常！建议定期运行验收以确保持续稳定。
                            </Text>
                          </Banner>
                        )}

                        {}
                        {latestRun.reconciliation && (
                          <Box padding="400">
                            <Divider />
                            <BlockStack gap="400">
                              <Text as="h3" variant="headingSm">
                                📊 渠道对账
                              </Text>

                              {}
                              <Suspense fallback={<CardSkeleton lines={3} />}>
                                <ChannelReconciliationChart
                                  pixelVsCapi={latestRun.reconciliation.pixelVsCapi}
                                  consistencyIssues={latestRun.reconciliation.consistencyIssues}
                                  localConsistency={latestRun.reconciliation.localConsistency}
                                />
                              </Suspense>

                              {}
                              <Layout>
                                <Layout.Section variant="oneThird">
                                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                    <BlockStack gap="100" align="center">
                                      <Text as="p" variant="headingLg" fontWeight="bold">
                                        {latestRun.reconciliation.pixelVsCapi.both}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        两者都有
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </Layout.Section>
                                <Layout.Section variant="oneThird">
                                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                    <BlockStack gap="100" align="center">
                                      <Text as="p" variant="headingLg" fontWeight="bold">
                                        {latestRun.reconciliation.pixelVsCapi.pixelOnly}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        仅 Pixel
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </Layout.Section>
                                <Layout.Section variant="oneThird">
                                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                    <BlockStack gap="100" align="center">
                                      <Text as="p" variant="headingLg" fontWeight="bold">
                                        {latestRun.reconciliation.pixelVsCapi.capiOnly}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        仅 CAPI
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </Layout.Section>
                              </Layout>
                              {latestRun.reconciliation.consistencyIssues && latestRun.reconciliation.consistencyIssues.length > 0 && (
                                <Banner tone="warning" title="发现一致性问题">
                                  <List type="bullet">
                                    {latestRun.reconciliation.consistencyIssues.slice(0, 5).map((issue, idx) => (
                                      <List.Item key={idx}>
                                        <Text as="span" variant="bodySm">
                                          <strong>订单 {issue.orderId}:</strong> {issue.issue}
                                        </Text>
                                      </List.Item>
                                    ))}
                                    {latestRun.reconciliation.consistencyIssues.length > 5 && (
                                      <List.Item>
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          还有 {latestRun.reconciliation.consistencyIssues.length - 5} 个问题，详见详细结果
                                        </Text>
                                      </List.Item>
                                    )}
                                  </List>
                                </Banner>
                              )}
                              {latestRun.reconciliation.localConsistency && (
                                <Box padding="300">
                                  <Divider />
                                  <BlockStack gap="300">
                                    <Text as="h3" variant="headingSm">
                                      🔍 本地一致性检查
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      对订单数据进行深度一致性验证，确保 Pixel 和 CAPI 事件的关键参数匹配
                                    </Text>
                                    <Layout>
                                      <Layout.Section variant="oneThird">
                                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                          <BlockStack gap="100" align="center">
                                            <Text as="p" variant="headingLg" fontWeight="bold">
                                              {latestRun.reconciliation.localConsistency.totalChecked}
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                              检查订单数
                                            </Text>
                                          </BlockStack>
                                        </Box>
                                      </Layout.Section>
                                      <Layout.Section variant="oneThird">
                                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                          <BlockStack gap="100" align="center">
                                            <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                                              {latestRun.reconciliation.localConsistency.consistent}
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                              完全一致
                                            </Text>
                                          </BlockStack>
                                        </Box>
                                      </Layout.Section>
                                      <Layout.Section variant="oneThird">
                                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                          <BlockStack gap="100" align="center">
                                            <Text as="p" variant="headingLg" fontWeight="bold">
                                              {latestRun.reconciliation.localConsistency.partial}
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                              部分一致
                                            </Text>
                                          </BlockStack>
                                        </Box>
                                      </Layout.Section>
                                    </Layout>
                                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                      <BlockStack gap="100" align="center">
                                        <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                                          {latestRun.reconciliation.localConsistency.inconsistent}
                                        </Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                          不一致
                                        </Text>
                                      </BlockStack>
                                    </Box>
                                    {latestRun.reconciliation.localConsistency.issues && latestRun.reconciliation.localConsistency.issues.length > 0 && (
                                      <Banner
                                        tone={
                                          latestRun.reconciliation.localConsistency.inconsistent > 0
                                            ? "critical"
                                            : latestRun.reconciliation.localConsistency.partial > 0
                                              ? "warning"
                                              : "success"
                                        }
                                        title={
                                          latestRun.reconciliation.localConsistency.inconsistent > 0
                                            ? "发现不一致订单"
                                            : latestRun.reconciliation.localConsistency.partial > 0
                                              ? "发现部分一致订单"
                                              : "检查完成"
                                        }
                                      >
                                        <BlockStack gap="200">
                                          <Text as="p" variant="bodySm">
                                            {latestRun.reconciliation.localConsistency.inconsistent > 0
                                              ? "以下订单存在关键参数不一致（如金额、币种、事件ID重复等），需要检查配置。"
                                              : latestRun.reconciliation.localConsistency.partial > 0
                                                ? "以下订单存在部分参数不一致，可能影响追踪准确性。"
                                                : "所有检查的订单参数一致。"}
                                          </Text>
                                          {latestRun.reconciliation.localConsistency.issues.length > 0 && (
                                            <BlockStack gap="100">
                                              {latestRun.reconciliation.localConsistency.issues.slice(0, 5).map((issue, idx) => (
                                                <Box
                                                  key={idx}
                                                  background="bg-surface-secondary"
                                                  padding="200"
                                                  borderRadius="100"
                                                >
                                                  <InlineStack gap="200" align="space-between" blockAlign="start">
                                                    <BlockStack gap="050">
                                                      <Text as="p" variant="bodySm" fontWeight="semibold">
                                                        订单 {issue.orderId}
                                                      </Text>
                                                      <Text as="p" variant="bodySm" tone="subdued">
                                                        状态: {issue.status === "consistent" ? "一致" : issue.status === "partial" ? "部分一致" : "不一致"}
                                                      </Text>
                                                    </BlockStack>
                                                    <Badge
                                                      tone={
                                                        issue.status === "consistent"
                                                          ? "success"
                                                          : issue.status === "partial"
                                                            ? "warning"
                                                            : "critical"
                                                      }
                                                    >
                                                      {issue.status === "consistent"
                                                        ? "一致"
                                                        : issue.status === "partial"
                                                          ? "部分一致"
                                                          : "不一致"}
                                                    </Badge>
                                                  </InlineStack>
                                                  {issue.issues && issue.issues.length > 0 && (
                                                    <Box padding="100">
                                                      <List type="bullet">
                                                        {issue.issues.map((i, issueIdx) => (
                                                          <List.Item key={issueIdx}>
                                                            <Text as="span" variant="bodySm">
                                                              {i}
                                                            </Text>
                                                          </List.Item>
                                                        ))}
                                                      </List>
                                                    </Box>
                                                  )}
                                                </Box>
                                              ))}
                                              {latestRun.reconciliation.localConsistency.issues.length > 5 && (
                                                <Text as="p" variant="bodySm" tone="subdued">
                                                  还有 {latestRun.reconciliation.localConsistency.issues.length - 5} 个订单详情，请查看详细结果或导出报告
                                                </Text>
                                              )}
                                            </BlockStack>
                                          )}
                                        </BlockStack>
                                      </Banner>
                                    )}
                                  </BlockStack>
                                </Box>
                              )}
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}

                {}
                <Banner tone="info" title="重要说明：事件发送与平台归因">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      <strong>本应用仅保证事件生成与发送成功，不保证平台侧归因一致。</strong>
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>我们保证：</strong>事件已成功生成并发送到目标平台 API（GA4 Measurement Protocol、Meta Conversions API、TikTok Events API 等）。验收报告显示的是我们系统记录的事件发送状态。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、数据处理延迟等。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>验收报告说明：</strong>本验收功能仅验证事件是否成功发送到平台 API，以及事件数据是否完整。如果验收显示"通过"，表示事件已成功发送；但平台侧报表中的归因数据可能因平台算法等因素与 Shopify 订单数据存在差异，这是正常现象。
                        </Text>
                      </List.Item>
                    </List>
                  </BlockStack>
                </Banner>

                {!isRunning && !latestRun && (
                  <EnhancedEmptyState
                    icon="✅"
                    title="尚未运行验收"
                    description="按照上方的测试指引完成测试订单后，点击「运行验收」分析结果。"
                    helpText="验收会分析过去 24 小时内的事件数据，验证追踪是否正常工作。"
                    primaryAction={{
                      content: "运行验收",
                      onAction: handleRunVerification,
                    }}
                  />
                )}
              </BlockStack>
            </Box>
          )}

          {}
          {selectedTab === 1 && (
            <Box padding="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      事件详细结果
                    </Text>
                    {latestRun && latestRun.results.length > 0 && (
                      <Button
                        icon={ExportIcon}
                        onClick={() => {
                          const data = JSON.stringify(latestRun.results, null, 2);
                          const blob = new Blob([data], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `verification-results-${new Date().toISOString().split("T")[0]}.json`;
                          a.click();
                        }}
                        size="slim"
                      >
                        导出 JSON
                      </Button>
                    )}
                  </InlineStack>

                  {latestRun && latestRun.results.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text"]}
                      headings={["事件类型", "平台", "订单ID", "状态", "金额", "币种", "问题"]}
                      rows={latestRun.results.map((r) => [
                        r.eventType,
                        r.platform,
                        r.orderId || "-",
                        <StatusBadge key={r.orderId} status={r.status} />,
                        r.params?.value?.toFixed(2) || "-",
                        r.params?.currency || "-",
                        r.discrepancies?.join("; ") || r.errors?.join("; ") || "-",
                      ])}
                    />
                  ) : (
                    <Banner tone="info">
                      <Text as="p">暂无验收结果数据。请先运行验收测试。</Text>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            </Box>
          )}

          {}
          {selectedTab === 2 && (
            <Box padding="400">
              <Suspense fallback={<CardSkeleton lines={3} />}>
                <RealtimeEventMonitor
                  shopId={shop.id}
                  platforms={configuredPlatforms}
                  runId={latestRun?.runId}
                  eventTypes={["purchase"]}
                  useVerificationEndpoint={true}
                  autoStart={false}
                />
              </Suspense>
            </Box>
          )}

          {}
          {selectedTab === 3 && (
            <Box padding="400">
              <Suspense fallback={<CardSkeleton lines={5} />}>
                <TestOrderGuide
                  shopDomain={shopDomain}
                  shopId={shop?.id || ""}
                  testItems={testItems.map((item) => ({
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    steps: "steps" in item ? (item.steps as string[]) : [],
                    expectedEvents: "expectedResults" in item ? (item.expectedResults as string[]) : [],
                    eventType: item.eventType,
                    category: "category" in item ? (item.category as string) : "purchase",
                  }))}
                  onTestComplete={(itemId, verified) => {
                    if (verified) {
                      showSuccess(`测试项 "${testItems.find((i) => i.id === itemId)?.name}" 验证通过`);
                    } else {
                      showError(`测试项 "${testItems.find((i) => i.id === itemId)?.name}" 验证失败，请检查事件触发情况`);
                    }
                  }}
                />
              </Suspense>
            </Box>
          )}

          {selectedTab === 6 && (
            <Box padding="400">
              <BlockStack gap="500">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      验收历史
                    </Text>

                    {history.length > 0 ? (
                      <DataTable
                        columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
                        headings={["时间", "类型", "状态", "通过", "失败", "参数缺失"]}
                        rows={history.map((run) => [
                          run.completedAt
                            ? new Date(run.completedAt).toLocaleString("zh-CN")
                            : "-",
                          run.runType === "full" ? "完整" : "快速",
                          <StatusBadge key={run.runId} status={run.status} />,
                          run.passedTests,
                          run.failedTests,
                          run.missingParamTests,
                        ])}
                      />
                    ) : (
                      <EnhancedEmptyState
                        icon="📋"
                        title="暂无验收历史记录"
                        description="运行验收测试后，历史记录将显示在这里。"
                        primaryAction={{
                          content: "运行验收",
                          onAction: handleRunVerification,
                        }}
                      />
                    )}
                  </BlockStack>
                </Card>

                {history.length >= 2 && shop && (
                  <Suspense fallback={<CardSkeleton lines={3} />}>
                    <ReportComparison
                      shopId={shop.id}
                      availableRuns={history.map((run) => ({
                        runId: run.runId,
                        runName: run.runName || `${run.runType === "full" ? "完整" : "快速"}验收`,
                        completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
                      }))}
                    />
                  </Suspense>
                )}
              </BlockStack>
            </Box>
          )}
        </Tabs>

        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                📝 验收测试清单
              </Text>
              {latestRun && (
                <Badge tone={latestRun.status === "completed" ? "success" : latestRun.status === "running" ? "info" : undefined}>
                  {latestRun.status === "completed" ? "已完成" : latestRun.status === "running" ? "运行中" : "待运行"}
                </Badge>
              )}
            </InlineStack>
            <Divider />

            <BlockStack gap="300">
              {testItems.map((item) => {

                const itemResults = latestRun?.results?.filter(
                  (r) => r.testItemId === item.id
                ) || [];
                const itemStatus = itemResults.length > 0
                  ? itemResults.every((r) => r.status === "success")
                    ? "success"
                    : itemResults.some((r) => r.status === "success")
                      ? "partial"
                      : itemResults.some((r) => r.status === "missing_params")
                        ? "missing_params"
                        : "failed"
                  : "not_tested";

                return (
                  <Box
                    key={item.id}
                    background={
                      itemStatus === "success"
                        ? "bg-fill-success-secondary"
                        : itemStatus === "partial"
                          ? "bg-fill-warning-secondary"
                          : itemStatus === "failed" || itemStatus === "missing_params"
                            ? "bg-fill-critical-secondary"
                            : "bg-surface-secondary"
                    }
                    padding="300"
                    borderRadius="100"
                  >
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon
                            source={
                              itemStatus === "success"
                                ? CheckCircleIcon
                                : itemStatus === "partial" || itemStatus === "missing_params"
                                  ? AlertCircleIcon
                                  : ClipboardIcon
                            }
                            tone={
                              itemStatus === "success"
                                ? "success"
                                : itemStatus === "partial" || itemStatus === "missing_params"
                                  ? "warning"
                                  : "subdued"
                            }
                          />
                          <Text as="span" fontWeight="semibold">
                            {item.name}
                          </Text>
                          {item.required && <Badge tone="attention">必测</Badge>}
                          {itemStatus === "success" && (
                            <Badge tone="success">✓ 通过</Badge>
                          )}
                          {itemStatus === "partial" && (
                            <Badge tone="warning">⚠ 部分通过</Badge>
                          )}
                          {itemStatus === "failed" && (
                            <Badge tone="critical">✗ 失败</Badge>
                          )}
                          {itemStatus === "missing_params" && (
                            <Badge tone="warning">⚠ 参数缺失</Badge>
                          )}
                          {itemStatus === "not_tested" && (
                            <Badge>未测试</Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {item.description}
                        </Text>
                        {itemResults.length > 0 && (
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">
                              测试结果: {itemResults.filter((r) => r.status === "success").length} / {itemResults.length} 通过
                            </Text>
                            {itemResults.some((r) => r.discrepancies && r.discrepancies.length > 0) && (
                              <Banner tone="warning">
                                <Text as="p" variant="bodySm">
                                  发现问题: {itemResults
                                    .filter((r) => r.discrepancies && r.discrepancies.length > 0)
                                    .map((r) => r.discrepancies?.join(", "))
                                    .join("; ")}
                                </Text>
                              </Banner>
                            )}
                          </BlockStack>
                        )}
                      </BlockStack>
                      <InlineStack gap="100">
                        {item.platforms.slice(0, 3).map((p) => (
                          <PlatformBadge key={p} platform={p} />
                        ))}
                        {item.platforms.length > 3 && (
                          <Badge>{`+${item.platforms.length - 3}`}</Badge>
                        )}
                      </InlineStack>
                    </InlineStack>
                  </Box>
                );
              })}
            </BlockStack>
          </BlockStack>
        </Card>

        {}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              🔗 相关页面
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/diagnostics">诊断页面</Button>
              <Button url="/app/settings">配置凭证</Button>
              <Button url="/app/migrate">安装 Pixel</Button>
              <Button url="/app/monitor">监控数据</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {}
      <Modal
        open={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title="测试订单指引"
        primaryAction={{
          content: "知道了",
          onAction: () => setShowGuideModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {testGuide.steps.map((step) => (
              <Box key={step.step} background="bg-surface-secondary" padding="300" borderRadius="100">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    {step.step}. {step.title}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {step.description}
                  </Text>
                </BlockStack>
              </Box>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
