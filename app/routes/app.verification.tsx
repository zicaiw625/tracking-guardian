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
import { useLocale } from "~/context/LocaleContext";

const TestOrderGuide = lazy(() => import("~/components/verification/TestOrderGuide").then(module => ({ default: module.TestOrderGuide })));

export default function VerificationPage() {
  const { t, locale } = useLocale();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
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
        showSuccess(t("verification.runStarted"));
        revalidator.revalidate();
      } else if (data.error) {
        showError(data.error);
      }
    }
  }, [actionData, showSuccess, showError, revalidator, t]);
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
    const fullText = `# ${t("verification.guideCopyTitle")}\n\n${t("verification.guideCopyEstimated")}: ${testGuide.estimatedTime}\n\n## ${t("verification.guideCopySteps")}\n\n${guideText}\n\n## ${t("verification.guideCopyTips")}\n\n${tipsText}`;
    navigator.clipboard.writeText(fullText);
  }, [testGuide, t]);
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
    { id: "overview", content: t("verification.tabOverview") },
    { id: "pixel-layer", content: t("verification.tabPixelLayer") },
    { id: "results", content: t("verification.tabResults") },
    { id: "test-guide", content: t("verification.tabTestGuide") },
    { id: "history", content: t("verification.tabHistory") },
  ];
  if (!shop) {
    return (
      <Page title={t("verification.noShopTitle")}>
        <EnhancedEmptyState
          icon="⚠️"
          title={t("verification.noShopDesc")}
          description={t("verification.noShopHint")}
          primaryAction={{
            content: t("verification.backToHome"),
            url: "/app",
          }}
        />
      </Page>
    );
  }
  if (!canAccessVerification && gateResult) {
    return (
      <Page title={t("verification.noShopTitle")}>
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
      title={t("verification.pageTitle")}
      subtitle={t("verification.pageSubtitle")}
      primaryAction={{
        content: isRunning ? t("verification.running") : t("verification.runVerification"),
        onAction: handleRunVerification,
        loading: isRunning,
        icon: PlayIcon,
      }}
      secondaryActions={[
        {
          content: t("verification.refresh"),
          onAction: () => revalidator.revalidate(),
          icon: RefreshIcon,
        },
        ...(latestRun && canExportReports ? [
          {
            content: t("verification.exportCsv"),
            onAction: handleExportCsv,
            icon: ExportIcon,
          },
        ] : []),
      ]}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("verification.introTitle")}
          description={t("verification.introDesc")}
          items={[t("verification.introItems.0"), t("verification.introItems.1")]}
          primaryAction={{ content: t("verification.viewReport"), url: "/app/reports" }}
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
                          title={t("verification.passRate")}
                          score={passRate}
                          description={t("verification.passRateDesc", { passed: latestRun.passedTests, total: latestRun.totalTests })}
                          tone={passRate >= 80 ? "success" : passRate >= 50 ? "warning" : "critical"}
                        />
                      </Layout.Section>
                      <Layout.Section variant="oneThird">
                        <ScoreCard
                          title={t("verification.paramCompleteness")}
                          score={latestRun.parameterCompleteness}
                          description={t("verification.paramCompletenessDesc")}
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
                          title={t("verification.valueAccuracy")}
                          score={latestRun.valueAccuracy}
                          description={t("verification.valueAccuracyDesc")}
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
                            {t("verification.statusLabel")}
                          </Text>
                          <StatusBadge status={latestRun.status} />
                        </InlineStack>
                        <Divider />
                        <InlineStack gap="400" align="space-between">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("verification.completedAtLabel")}
                            </Text>
                            <Text as="p" fontWeight="semibold">
                              {latestRun.completedAt
                                ? new Date(latestRun.completedAt).toLocaleString(dateLocale)
                                : "-"}
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("verification.runTypeLabel")}
                            </Text>
                            <Text as="p" fontWeight="semibold">
                              {latestRun.runType === "full" ? t("verification.runTypeFull") : t("verification.runTypeQuick")}
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("verification.platformsLabel")}
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
                                {t("verification.passed")}
                              </Text>
                            </BlockStack>
                            <BlockStack gap="100" align="center">
                              <Icon source={AlertCircleIcon} tone="warning" />
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {latestRun.missingParamTests}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {t("verification.missingParams")}
                              </Text>
                            </BlockStack>
                            <BlockStack gap="100" align="center">
                              <Icon source={AlertCircleIcon} tone="critical" />
                              <Text as="p" variant="headingLg" fontWeight="bold">
                                {latestRun.failedTests}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {t("verification.failed")}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                        </Box>
                        {latestRun.failedTests > 0 && (
                          <Banner tone="critical" title={t("verification.bannerFailedTitle")}>
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm">
                                {t("verification.bannerFailedReasons")}
                              </Text>
                              <List type="bullet">
                                <List.Item>{t("verification.bannerFailedItem1")}</List.Item>
                                <List.Item>{t("verification.bannerFailedItem2")}</List.Item>
                                <List.Item>{t("verification.bannerFailedItem3")}</List.Item>
                              </List>
                            </BlockStack>
                          </Banner>
                        )}
                        {latestRun.missingParamTests > 0 && latestRun.failedTests === 0 && (
                          <Banner tone="warning" title={t("verification.bannerPartialTitle")}>
                            <Text as="p" variant="bodySm">
                              {t("verification.bannerPartialDesc")}
                            </Text>
                          </Banner>
                        )}
                        {passRate >= 80 && (
                          <Banner tone="success" title={t("verification.bannerSuccessTitle")}>
                            <Text as="p" variant="bodySm">
                              🎉 {t("verification.bannerSuccessDesc")}
                            </Text>
                          </Banner>
                        )}
                        {trackingApiEnabled && latestRun.reconciliation && (
                          <Box padding="400">
                            <Divider />
                            <BlockStack gap="400">
                              <Text as="h3" variant="headingSm">
                                📊 {t("verification.reconciliationTitle")}
                              </Text>
                              <Card>
                                <BlockStack gap="300">
                                  {latestRun.reconciliation.pixelVsCapi && (
                                    <DataTable
                                      columnContentTypes={["text", "numeric", "numeric"]}
                                      headings={[t("verification.tableMetric"), t("verification.tablePixel"), t("verification.tableCapi")]}
                                      rows={[
                                        [t("verification.rowPixelOnly"), String(latestRun.reconciliation.pixelVsCapi.pixelOnly || 0), "0"],
                                        [t("verification.rowCapiOnly"), "0", String(latestRun.reconciliation.pixelVsCapi.capiOnly || 0)],
                                        [t("verification.rowBoth"), String(latestRun.reconciliation.pixelVsCapi.both || 0), String(latestRun.reconciliation.pixelVsCapi.both || 0)],
                                        [t("verification.rowConsentBlocked"), String(latestRun.reconciliation.pixelVsCapi.consentBlocked || 0), String(latestRun.reconciliation.pixelVsCapi.consentBlocked || 0)],
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
                                        {t("verification.bothLabel")}
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
                                        {t("verification.pixelOnlyLabel")}
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
                                        {t("verification.capiOnlyLabel")}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </Layout.Section>
                              </Layout>
                              {latestRun.reconciliation.consistencyIssues && latestRun.reconciliation.consistencyIssues.length > 0 && (
                                <Banner tone="warning" title={t("verification.consistencyBannerTitle")}>
                                  <List type="bullet">
                                    {latestRun.reconciliation.consistencyIssues.slice(0, 5).map((issue, idx) => (
                                      <List.Item key={idx}>
                                        <Text as="span" variant="bodySm">
                                          <strong>{t("verification.orderIssue", { orderId: issue.orderId, issue: issue.issue })}</strong>
                                        </Text>
                                      </List.Item>
                                    ))}
                                    {latestRun.reconciliation.consistencyIssues.length > 5 && (
                                      <List.Item>
                                        <Text as="span" variant="bodySm" tone="subdued">
                                          {t("verification.moreIssues", { count: latestRun.reconciliation.consistencyIssues.length - 5 })}
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
                                      🔍 {t("verification.localConsistencyTitle")}
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {t("verification.localConsistencyDesc")}
                                    </Text>
                                    <Layout>
                                      <Layout.Section variant="oneThird">
                                        <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                          <BlockStack gap="100" align="center">
                                            <Text as="p" variant="headingLg" fontWeight="bold">
                                              {latestRun.reconciliation.localConsistency.totalChecked}
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                              {t("verification.checkedCount")}
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
                                              {t("verification.consistent")}
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
                                              {t("verification.partial")}
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
                                          {t("verification.inconsistent")}
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
                                            ? t("verification.localBannerInconsistent")
                                            : latestRun.reconciliation.localConsistency.partial > 0
                                              ? t("verification.localBannerPartial")
                                              : t("verification.localBannerDone")
                                        }
                                      >
                                        <BlockStack gap="200">
                                          <Text as="p" variant="bodySm">
                                            {latestRun.reconciliation.localConsistency.inconsistent > 0
                                              ? t("verification.localBannerInconsistentDesc")
                                              : latestRun.reconciliation.localConsistency.partial > 0
                                                ? t("verification.localBannerPartialDesc")
                                                : t("verification.localBannerDoneDesc")}
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
                                                        {t("verification.orderLabel", { orderId: issue.orderId })}
                                                      </Text>
                                                      <Text as="p" variant="bodySm" tone="subdued">
                                                        {t("verification.statusLine", {
                                                          status: issue.status === "consistent" ? t("verification.statusConsistent") : issue.status === "partial" ? t("verification.statusPartial") : t("verification.statusInconsistent"),
                                                        })}
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
                                                        ? t("verification.consistent")
                                                        : issue.status === "partial"
                                                          ? t("verification.partial")
                                                          : t("verification.inconsistent")}
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
                                                  {t("verification.moreOrders", { count: latestRun.reconciliation.localConsistency.issues.length - 5 })}
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
                <Banner tone="info" title={t("verification.scopeBannerTitle")}>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      <strong>{t("verification.scopeBannerP1")}</strong>
                    </Text>
                    <List type="bullet">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>{t("verification.weProvide")}</strong>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>{t("verification.weDontGuarantee")}</strong>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          <strong>{t("verification.reportNote")}</strong>
                        </Text>
                      </List.Item>
                    </List>
                  </BlockStack>
                </Banner>
                {!isRunning && !latestRun && (
                  <EnhancedEmptyState
                    icon="✅"
                    title={t("verification.emptyTitle")}
                    description={t("verification.emptyDesc")}
                    helpText={t("verification.emptyHelp")}
                    primaryAction={{
                      content: t("verification.runVerification"),
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
                    const name = testItems.find((i) => i.id === itemId)?.name ?? "";
                    if (verified) {
                      showSuccess(t("verification.itemPassed", { name }));
                    } else {
                      showError(t("verification.itemFailed", { name }));
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
                📝 {t("verification.checklistTitle")}
              </Text>
              {latestRun && (
                <Badge tone={latestRun.status === "completed" ? "success" : latestRun.status === "running" ? "info" : undefined}>
                  {latestRun.status === "completed" ? t("verification.statusCompleted") : latestRun.status === "running" ? t("verification.statusRunning") : t("verification.statusPending")}
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
                          {item.required && <Badge tone="attention">{t("verification.badgeRequired")}</Badge>}
                          {itemStatus === "success" && (
                            <Badge tone="success">{t("verification.badgePass")}</Badge>
                          )}
                          {itemStatus === "partial" && (
                            <Badge tone="warning">{t("verification.badgePartial")}</Badge>
                          )}
                          {itemStatus === "failed" && (
                            <Badge tone="critical">{t("verification.badgeFail")}</Badge>
                          )}
                          {itemStatus === "missing_params" && (
                            <Badge tone="warning">{t("verification.badgeMissingParams")}</Badge>
                          )}
                          {itemStatus === "not_tested" && (
                            <Badge>{t("verification.badgeNotTested")}</Badge>
                          )}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {item.description}
                        </Text>
                        {itemResults.length > 0 && (
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {t("verification.testResultLine", { passed: itemResults.filter((r) => r.status === "success").length, total: itemResults.length })}
                            </Text>
                            {itemResults.some((r) => r.discrepancies && r.discrepancies.length > 0) && (
                              <Banner tone="warning">
                                <Text as="p" variant="bodySm">
                                  {t("verification.issuesFound", {
                                    details: itemResults
                                      .filter((r) => r.discrepancies && r.discrepancies.length > 0)
                                      .map((r) => r.discrepancies?.join(", "))
                                      .join("; "),
                                  })}
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
              🔗 {t("verification.relatedPages")}
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/settings">{t("verification.viewSettings")}</Button>
              <Button url="/app/migrate">{t("verification.installPixel")}</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
      <Modal
        open={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title={t("verification.modalTestOrderTitle")}
        primaryAction={{
          content: t("verification.gotIt"),
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
