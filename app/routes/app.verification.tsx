

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect, Suspense } from "react";
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
import { lazy, Suspense } from "react";

const RealtimeEventMonitor = lazy(() => import("~/components/verification/RealtimeEventMonitor").then(module => ({ default: module.RealtimeEventMonitor })));
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createVerificationRun,
  startVerificationRun,
  analyzeRecentEvents,
  getVerificationHistory,
  generateTestOrderGuide,
  VERIFICATION_TEST_ITEMS,
  type VerificationSummary,
} from "../services/verification.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
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
    });
  }

  const configuredPlatforms = shop.pixelConfigs.map((c) => c.platform);
  const history = await getVerificationHistory(shop.id, 5);

  const latestRun = history?.[0] ?? null;

  return json({
    shop: { id: shop.id },
    configuredPlatforms,
    history,
    latestRun,
    testGuide: generateTestOrderGuide("quick"),
    testItems: VERIFICATION_TEST_ITEMS,
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
  const { shop, configuredPlatforms, history, latestRun, testGuide, testItems } =
    useLoaderData<typeof loader>();
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
    window.open(`/api/reports/pdf?type=verification&runId=${latestRun.runId}`, "_blank");
  }, [latestRun]);

  const handleExportCsv = useCallback(() => {
    if (!latestRun) return;

    const lines: string[] = [];

    lines.push('验收报告');
    lines.push(`验收时间,${latestRun.completedAt ? new Date(latestRun.completedAt).toLocaleString("zh-CN") : '-'}`);
    lines.push(`验收类型,${latestRun.runType === 'full' ? '完整验收' : '快速验收'}`);
    lines.push(`验收名称,${latestRun.runName || '-'}`);
    lines.push(`测试平台,${latestRun.platforms.join('; ')}`);
    lines.push('');

    lines.push('评分摘要');
    lines.push('指标,数值');
    const passRate = latestRun.totalTests > 0 ? Math.round((latestRun.passedTests / latestRun.totalTests) * 100) : 0;
    lines.push(`通过率,${passRate}%`);
    lines.push(`参数完整率,${latestRun.parameterCompleteness}%`);
    lines.push(`金额准确率,${latestRun.valueAccuracy}%`);
    lines.push('');

    lines.push('测试统计');
    lines.push('类型,数量');
    lines.push(`通过,${latestRun.passedTests}`);
    lines.push(`失败,${latestRun.failedTests}`);
    lines.push(`参数缺失,${latestRun.missingParamTests}`);
    lines.push(`总计,${latestRun.totalTests}`);
    lines.push('');

    if (latestRun.reconciliation) {
      lines.push('渠道对账');
      lines.push('指标,数值');
      lines.push(`Pixel 和 CAPI 都有,${latestRun.reconciliation.pixelVsCapi.both}`);
      lines.push(`仅 Pixel,${latestRun.reconciliation.pixelVsCapi.pixelOnly}`);
      lines.push(`仅 CAPI,${latestRun.reconciliation.pixelVsCapi.capiOnly}`);
      lines.push(`因同意阻止,${latestRun.reconciliation.pixelVsCapi.consentBlocked}`);
      lines.push('');

      if (latestRun.reconciliation.consistencyIssues && latestRun.reconciliation.consistencyIssues.length > 0) {
        lines.push('一致性问题');
        lines.push('订单ID,问题类型,问题描述');
        latestRun.reconciliation.consistencyIssues.forEach((issue: {
          orderId: string;
          issue: string;
          type: string;
        }) => {
          lines.push(`${issue.orderId},${issue.type},${issue.issue.replace(/,/g, '；')}`);
        });
        lines.push('');
      }
    }

    if (latestRun.results && latestRun.results.length > 0) {
      lines.push('事件详细记录');
      lines.push('事件类型,平台,订单ID,订单号,金额,币种,状态,问题');
      latestRun.results.forEach((r: {
        eventType: string;
        platform: string;
        orderId?: string;
        orderNumber?: string;
        params?: { value?: number; currency?: string };
        status: string;
        discrepancies?: string[];
        errors?: string[];
      }) => {
        const escapedErrors = [...(r.discrepancies || []), ...(r.errors || [])].join('; ').replace(/,/g, '；');
        lines.push(`${r.eventType},${r.platform},${r.orderId || '-'},${r.orderNumber || '-'},${r.params?.value?.toFixed(2) || '-'},${r.params?.currency || '-'},${
          r.status === 'success' ? '成功' :
          r.status === 'missing_params' ? '参数缺失' : '失败'
        },${escapedErrors || '-'}`);
      });
    }

    const csvContent = lines.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verification-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [latestRun]);

  const tabs = [
    { id: "overview", content: "验收概览" },
    { id: "results", content: "详细结果" },
    { id: "realtime", content: "实时监控" },
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

  const passRate = latestRun
    ? latestRun.totalTests > 0
      ? Math.round((latestRun.passedTests / latestRun.totalTests) * 100)
      : 0
    : 0;

  return (
    <Page
      title="验收向导"
      subtitle="验证追踪配置是否正常工作"
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
        ...(latestRun ? [
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
        {configuredPlatforms.length === 0 && (
          <Banner
            title="未配置服务端追踪"
            tone="warning"
            action={{ content: "前往配置", url: "/app/settings" }}
          >
            <p>请先在设置页面配置至少一个平台的 CAPI 凭证，然后再进行验收测试。</p>
          </Banner>
        )}

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

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {}
          {selectedTab === 0 && (
            <Box paddingBlockStart="400">
              <BlockStack gap="500">
                {isRunning && (
                  <Card>
                    <BlockStack gap="400">
                      <CardSkeleton lines={3} showTitle={true} />
                      <Box paddingBlockStart="200">
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
                          <Box paddingBlockStart="400">
                            <Divider />
                            <BlockStack gap="300" paddingBlockStart="400">
                              <Text as="h3" variant="headingSm">
                                📊 渠道对账
                              </Text>
                              <Layout>
                                <Layout.Section variant="oneQuarter">
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
                                <Layout.Section variant="oneQuarter">
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
                                <Layout.Section variant="oneQuarter">
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
                                <Layout.Section variant="oneQuarter">
                                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                    <BlockStack gap="100" align="center">
                                      <Text as="p" variant="headingLg" fontWeight="bold">
                                        {latestRun.reconciliation.pixelVsCapi.consentBlocked}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        因同意阻止
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
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    </Card>
                  </>
                )}

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
            <Box paddingBlockStart="400">
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
            <Box paddingBlockStart="400">
              <Suspense fallback={<CardSkeleton lines={3} />}>
                <RealtimeEventMonitor shopId={shop.id} />
              </Suspense>
            </Box>
          )}

          {}
          {selectedTab === 3 && (
            <Box paddingBlockStart="400">
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
            </Box>
          )}
        </Tabs>

        {}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              📝 验收测试项说明
            </Text>
            <Divider />

            <BlockStack gap="300">
              {testItems.map((item) => (
                <Box
                  key={item.id}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="100"
                >
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Text as="span" fontWeight="semibold">
                          {item.name}
                        </Text>
                        {item.required && <Badge tone="attention">必测</Badge>}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {item.description}
                      </Text>
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
              ))}
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

