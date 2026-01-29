import type { loader } from "./app.verification/loader.server";
import type { action } from "./app.verification/action.server";
export { loader } from "./app.verification/loader.server";
export { action } from "./app.verification/action.server";
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
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ClipboardIcon,
  ExportIcon,
  RefreshIcon,
  PlayIcon,
} from "~/components/icons";
import { CardSkeleton, useToastContext, EnhancedEmptyState } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { StatusBadge, PlatformBadge, ScoreCard } from "~/components/verification/VerificationBadges";
import { VerificationResultsTable } from "~/components/verification/VerificationResultsTable";
import { VerificationHistoryPanel } from "~/components/verification/VerificationHistoryPanel";
import { VerificationIntroSection } from "./app.verification/_components/VerificationIntroSection";
import type { FeatureGateResult } from "../services/billing/feature-gates.server";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";

const TestOrderGuide = lazy(() => import("~/components/verification/TestOrderGuide").then(module => ({ default: module.TestOrderGuide })));

export default function VerificationPage() {
  const loaderData = useLoaderData<typeof loader>();
  const trackingApiEnabled =
    loaderData && typeof loaderData === "object" && "trackingApiEnabled" in loaderData
      ? Boolean((loaderData as { trackingApiEnabled?: boolean }).trackingApiEnabled)
      : false;
  const { shop, configuredPlatforms, history, latestRun, testGuide, testItems, testChecklist, canAccessVerification, canExportReports, currentPlan, pixelStrictOrigin } = loaderData;
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
  const handleExportCsv = useCallback(() => {
    if (!latestRun) return;
    if (canExportReports) {
      window.location.href = `/api/reports?type=verification&runId=${latestRun.runId}&format=csv`;
      return;
    }
    /* eslint-disable @typescript-eslint/no-require-imports -- dynamic .server import to avoid client bundle */
    const { trackEvent } = require("../services/analytics.server");
    const { safeFireAndForget } = require("../utils/helpers.server");
    /* eslint-enable @typescript-eslint/no-require-imports */
    safeFireAndForget(
      trackEvent({
        shopId: shop?.id || "",
        shopDomain: shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "verification_report",
          plan: currentPlan || "free",
          reportType: "csv",
          runId: latestRun.runId,
        },
      })
    );
    window.location.href = "/app/billing?upgrade=growth";
  }, [latestRun, canExportReports, shop, shopDomain, currentPlan]);
    const tabs = [
    { id: "overview", content: "验收概览" },
    { id: "pixel-layer", content: "像素层验收（Web Pixels 标准事件）" },
    { id: "results", content: "详细结果" },
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
      subtitle="测试清单 + 事件触发记录 + 参数完整率 + 订单金额/币种一致性 • 隐私合规检查（consent/customerPrivacy）• 验收报告导出（CSV）是核心付费点（给老板/客户看的证据）• Growth 套餐 $79/月 或 Agency 套餐 $199/月"
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
            content: "导出 CSV",
            onAction: handleExportCsv,
            icon: ExportIcon,
          },
        ] : []),
      ]}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="验收流程概览"
          description="通过测试清单验证事件触发与参数完整率，输出可交付的验收报告。"
          items={[
            "像素层验收覆盖标准事件",
            "报告支持 CSV 导出",
          ]}
          primaryAction={{ content: "查看验收报告", url: "/app/reports" }}
        />
        <VerificationIntroSection
          testGuide={testGuide}
          configuredPlatforms={configuredPlatforms}
          copyTestGuide={copyTestGuide}
          guideExpanded={guideExpanded}
          onGuideExpandedChange={setGuideExpanded}
          testChecklist={testChecklist}
          showSuccess={showSuccess}
          latestRun={latestRun}
          canExportReports={canExportReports}
          currentPlan={currentPlan}
        />
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
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
                        {latestRun.failedTests > 0 && (
                          <Banner tone="critical" title="存在失败的测试项">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm">
                                请检查以下可能的原因：
                              </Text>
                              <List type="bullet">
                                <List.Item>Web Pixel 是否已正确安装并启用</List.Item>
                                <List.Item>事件是否在结账漏斗中实际触发</List.Item>
                                <List.Item>是否有广告拦截器或浏览器策略影响请求发送</List.Item>
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
                        {trackingApiEnabled && latestRun.reconciliation && (
                          <Box padding="400">
                            <Divider />
                            <BlockStack gap="400">
                              <Text as="h3" variant="headingSm">
                                📊 渠道对账
                              </Text>
                              <Card>
                                <BlockStack gap="300">
                                  {latestRun.reconciliation.pixelVsCapi && (
                                    <DataTable
                                      columnContentTypes={["text", "numeric", "numeric"]}
                                      headings={["指标", "Pixel", "服务端(规划)"]}
                                      rows={[
                                        ["仅 Pixel", String(latestRun.reconciliation.pixelVsCapi.pixelOnly || 0), "0"],
                                        ["仅 服务端(规划)", "0", String(latestRun.reconciliation.pixelVsCapi.capiOnly || 0)],
                                        ["两者都有", String(latestRun.reconciliation.pixelVsCapi.both || 0), String(latestRun.reconciliation.pixelVsCapi.both || 0)],
                                        ["被 Consent 阻止", String(latestRun.reconciliation.pixelVsCapi.consentBlocked || 0), String(latestRun.reconciliation.pixelVsCapi.consentBlocked || 0)],
                                      ]}
                                    />
                                  )}
                                </BlockStack>
                              </Card>
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
                                        仅 服务端(规划)
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
                                      对订单数据进行深度一致性验证，确保 Pixel 与对账结果一致
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
                <Banner tone="info" title="重要说明：验收范围与平台归因">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      <strong>本应用验收侧重于事件触发与数据质量，不保证平台侧归因一致。</strong>
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>我们提供：</strong>像素事件触发记录、参数完整率、订单金额/币种一致性等验收证据。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>我们不保证：</strong>平台侧报表中的归因数据与 Shopify 订单数据完全一致。平台侧归因受多种因素影响，包括平台算法、用户隐私设置、跨设备追踪限制、数据处理延迟等。
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>验收报告说明：</strong>如果验收显示“通过”，表示像素事件在本应用的接收与校验链路中表现正常；平台侧归因可能仍存在差异，这是正常现象。
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
          {selectedTab === 1 && (
            <VerificationResultsTable latestRun={latestRun} pixelStrictOrigin={pixelStrictOrigin} />
          )}
          {selectedTab === 2 && (
            <Box padding="400">
              <BlockStack gap="500">
              </BlockStack>
            </Box>
          )}
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
          {selectedTab === 4 && (
            <VerificationHistoryPanel
              history={history}
              onRunVerification={handleRunVerification}
              shop={shop}
            />
          )}
        </Tabs>
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
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              🔗 相关页面
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/settings">查看设置</Button>
              <Button url="/app/migrate">安装 Pixel</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
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
