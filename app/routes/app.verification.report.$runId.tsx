import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  ProgressBar,
  DataTable,
  List,
  Box,
} from "@shopify/polaris";
import { useTranslation, Trans } from "react-i18next";
import { FileIcon } from "~/components/icons";
import { useToastContext, EnhancedEmptyState } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVerificationRun } from "../services/verification.server";
import {
  generateVerificationReportData,
  generateVerificationReportCSV,
} from "../services/verification-report.server";
import {
  checkFeatureAccess,
  type FeatureGateResult,
} from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId, planSupportsReportExport } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { trackEvent } from "../services/analytics.server";
import { safeFireAndForget } from "../utils/helpers.server";
import { sanitizeFilename } from "../utils/responses";
import { withSecurityHeaders } from "../utils/security-headers";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const runId = params.runId;
  if (!runId) {
    throw new Response("Missing runId", { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
    },
  });
  if (!shop) {
    const pixelStrictOrigin = ["true", "1", "yes"].includes(
      (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
    );
    return json({
      shop: null,
      run: null,
      reportData: null,
      canExportReports: false,
      gateResult: null as FeatureGateResult | null,
      currentPlan: "free" as PlanId,
      pixelStrictOrigin,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "verification");
  const canExportReports = planSupportsReportExport(planId);
  const run = await getVerificationRun(runId);
  if (!run || run.shopId !== shop.id) {
    const pixelStrictOrigin = ["true", "1", "yes"].includes(
      (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
    );
    return json({
      shop: { id: shop.id, domain: shopDomain },
      run: null,
      reportData: null,
      canExportReports,
      gateResult: gateResult.allowed ? null : gateResult,
      currentPlan: planId,
      pixelStrictOrigin,
    });
  }
  const reportData = await generateVerificationReportData(shop.id, runId);
    if (!canExportReports && reportData) {
    safeFireAndForget(
      trackEvent({
        shopId: shop.id,
        shopDomain,
        event: "app_paywall_viewed",
        metadata: {
          triggerPage: "verification_report",
          plan: shop.plan ?? "free",
          runId,
        },
      })
    );
  }
  const pixelStrictOrigin = ["true", "1", "yes"].includes(
    (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
  );
  return json({
    shop: { id: shop.id, domain: shopDomain },
    run,
    reportData,
    canExportReports,
    gateResult: gateResult.allowed ? undefined : gateResult,
    currentPlan: planId,
    pixelStrictOrigin,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const runId = params.runId;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (!runId) {
    return json({ success: false, error: "MISSING_RUN_ID" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "SHOP_NOT_FOUND" }, { status: 404 });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const canExportReports = planSupportsReportExport(planId);
  if (actionType === "export_csv") {
    if (!canExportReports) {
      return json({ success: false, error: "EXPORT_RESTRICTED" }, { status: 403 });
    }
    const reportData = await generateVerificationReportData(shop.id, runId);
    if (!reportData) {
      return json({ success: false, error: "REPORT_NOT_FOUND" }, { status: 404 });
    }
    const csv = generateVerificationReportCSV(reportData);
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `verification-report-${shopDomain.replace(/\./g, "_")}-${timestamp}.csv`;
    return new Response("\uFEFF" + csv, {
      headers: withSecurityHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
      }),
    });
  }
  return json({ success: false, error: "UNKNOWN_ACTION" }, { status: 400 });
};

export default function VerificationReportPage() {
  const { t, i18n } = useTranslation();
  const { shop, run, reportData, canExportReports, gateResult, currentPlan, pixelStrictOrigin } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const actionData = useActionData<typeof action>() as { success: boolean; error?: string } | undefined;
  const { showError } = useToastContext();

  useEffect(() => {
    if (actionData?.error) {
      let message = actionData.error;
      if (message === "EXPORT_RESTRICTED") {
        message = t("verification.report.errors.exportNeedPlan");
      } else if (message === "REPORT_NOT_FOUND") {
        message = t("verification.report.errors.reportDataNotFound");
      } else if (message === "UNKNOWN_ACTION") {
        message = t("verification.report.errors.unknownAction");
      } else if (message === "MISSING_RUN_ID") {
        message = t("verification.report.errors.missingRunId");
      } else if (message === "SHOP_NOT_FOUND") {
        message = t("verification.report.errors.shopNotFound");
      }
      showError(message);
    }
  }, [actionData, t, showError]);

  const [isExporting, setIsExporting] = useState(false);
  if (!shop) {
    return (
      <Page title={t("verification.report.title")}>
        <Banner tone="warning">
          <Text as="p">{t("verification.report.errors.shopNotFound")}</Text>
        </Banner>
      </Page>
    );
  }
  if (!run || !reportData) {
    return (
      <Page title={t("verification.report.title")}>
        <EnhancedEmptyState
          icon="⚠️"
          title={t("verification.report.notFound.title")}
          description={t("verification.report.notFound.description")}
          primaryAction={{ content: t("verification.report.notFound.action"), url: "/app/verification" }}
        />
      </Page>
    );
  }
  const handleExportCSV = () => {
    setIsExporting(true);
    const formData = new FormData();
    formData.append("_action", "export_csv");
    submit(formData, { method: "post" });
    setTimeout(() => setIsExporting(false), 2000);
  };
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge tone="success">{t("verification.report.status.completed")}</Badge>;
      case "running":
        return <Badge tone="info">{t("verification.report.status.running")}</Badge>;
      case "failed":
        return <Badge tone="critical">{t("verification.report.status.failed")}</Badge>;
      default:
        return <Badge>{t("verification.report.status.pending")}</Badge>;
    }
  };
  const formatDate = (date?: Date | string) => {
    if (date == null) return t("verification.report.status.pending");
    return new Date(date).toLocaleString(
      (i18n.resolvedLanguage ?? i18n.language)?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"
    );
  };
  return (
    <Page
      title={`${t("verification.report.title")} - ${reportData.runName}`}
      subtitle={t("verification.report.subtitle")}
      backAction={{ content: t("verification.report.intro.primaryAction"), url: "/app/verification" }}
      primaryAction={
        canExportReports
          ? {
              content: t("verification.report.exportCSV"),
              icon: FileIcon,
              onAction: handleExportCSV,
              loading: isExporting,
            }
          : undefined
      }
      secondaryActions={[]}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("verification.report.intro.title")}
          description={t("verification.report.intro.description")}
          items={[
            t("verification.report.intro.item1"),
            t("verification.report.intro.item2"),
          ]}
          primaryAction={{ content: t("verification.report.intro.primaryAction"), url: "/app/verification" }}
          secondaryAction={{ content: t("verification.report.intro.secondaryAction"), url: "/app/reports" }}
        />
        {!canExportReports && (
          <UpgradePrompt
            feature="verification"
            currentPlan={currentPlan}
            gateResult={gateResult ?? undefined}
          />
        )}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {t("verification.report.info.title")}
              </Text>
              {getStatusBadge(reportData.status)}
            </InlineStack>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("verification.report.info.name")}
                  </Text>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {reportData.runName}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("verification.report.info.type")}
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {reportData.runType === "quick" ? t("verification.report.type.quick") : reportData.runType === "full" ? t("verification.report.type.full") : t("verification.report.type.custom")}
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("verification.report.info.completedAt")}
                  </Text>
                  <Text as="span" variant="bodyMd">
                    {formatDate(reportData.completedAt)}
                  </Text>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("verification.report.summary.title")}
            </Text>
            <Layout>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      {reportData.summary.totalTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("verification.report.summary.totalTests")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="success">
                      {reportData.summary.passedTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("verification.report.summary.passed")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200" align="center">
                    <Text as="p" variant="heading2xl" fontWeight="bold" tone="critical">
                      {reportData.summary.failedTests}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("verification.report.summary.failed")}
                    </Text>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
            <Divider />
            <BlockStack gap="300">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {t("verification.report.summary.completeness")}
                  </Text>
                  <Text as="span" variant="headingMd" tone={reportData.summary.parameterCompleteness >= 90 ? "success" : reportData.summary.parameterCompleteness >= 70 ? "caution" : "critical"}>
                    {reportData.summary.parameterCompleteness.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={reportData.summary.parameterCompleteness}
                  tone={reportData.summary.parameterCompleteness >= 90 ? "success" : reportData.summary.parameterCompleteness >= 70 ? "highlight" : "critical"}
                />
              </BlockStack>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {t("verification.report.summary.accuracy")}
                  </Text>
                  <Text as="span" variant="headingMd" tone={reportData.summary.valueAccuracy >= 95 ? "success" : reportData.summary.valueAccuracy >= 80 ? "caution" : "critical"}>
                    {reportData.summary.valueAccuracy.toFixed(1)}%
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={reportData.summary.valueAccuracy}
                  tone={reportData.summary.valueAccuracy >= 95 ? "success" : reportData.summary.valueAccuracy >= 80 ? "highlight" : "critical"}
                />
              </BlockStack>
            </BlockStack>
          </BlockStack>
        </Card>
        {Object.keys(reportData.platformResults).length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("verification.report.platform.title")}
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={[
                  t("verification.report.platform.headings.platform"),
                  t("verification.report.platform.headings.sent"),
                  t("verification.report.platform.headings.failed"),
                  t("verification.report.platform.headings.rate"),
                ]}
                rows={Object.entries(reportData.platformResults).map(([platform, stats]) => {
                  const total = stats.sent + stats.failed;
                  const successRate = total > 0 ? Math.round((stats.sent / total) * 100) : 0;
                  return [
                    platform,
                    String(stats.sent),
                    String(stats.failed),
                    `${successRate}%`,
                  ];
                })}
              />
            </BlockStack>
          </Card>
        )}
        {reportData.events.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("verification.report.events.title")}
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="verification.report.events.notice" components={{ strong: <strong /> }} />
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    <Trans i18nKey="verification.report.events.checkoutCompletedNote" components={{ strong: <strong /> }} />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="verification.report.events.checkoutCompletedDesc" components={{ strong: <strong /> }} />
                  </Text>
                  <Text as="p" variant="bodySm">
                    <Trans i18nKey="verification.report.events.sandboxNote" components={{ strong: <strong /> }} />
                  </Text>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.report.events.limitFields")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <Trans i18nKey="verification.report.events.limit1" components={{ strong: <strong /> }} />
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <Trans i18nKey="verification.report.events.limit2" components={{ strong: <strong /> }} />
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <Trans i18nKey="verification.report.events.limit3" components={{ strong: <strong /> }} />
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <Trans i18nKey="verification.report.events.limit4" components={{ strong: <strong /> }} />
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.report.events.unavailableEvents")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("verification.report.events.unavailableEventsList")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <Trans i18nKey="verification.report.events.autoMarkNote" components={{ strong: <strong /> }} />
                  </Text>
                </BlockStack>
              </Banner>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={[
                  t("verification.report.events.headings.testItem"),
                  t("verification.report.events.headings.eventType"),
                  t("verification.report.events.headings.platform"),
                  t("verification.report.events.headings.orderId"),
                  t("verification.report.events.headings.status"),
                  t("verification.report.events.headings.amount"),
                  t("verification.report.events.headings.currency"),
                  t("verification.report.events.headings.issue"),
                  t("verification.report.events.headings.limit"),
                ]}
                rows={reportData.events.slice(0, 50).map((event) => [
                  event.testItemId,
                  event.eventType,
                  event.platform,
                  event.orderId || "",
                  event.status,
                  event.params?.value?.toFixed(2) || "",
                  event.params?.currency || "",
                  event.discrepancies?.join("; ") || event.errors?.join("; ") || "",
                  event.sandboxLimitations?.join("; ") || "",
                ])}
              />
              {reportData.events.length > 50 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("verification.report.events.limitMore")}
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {!pixelStrictOrigin && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("verification.report.origin.warning")}
              </Text>
              <Text as="p" variant="bodySm">
                <Trans i18nKey="verification.report.origin.desc" components={{ code: <code /> }} />
              </Text>
            </BlockStack>
          </Banner>
        )}
        {reportData.sandboxLimitations && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("verification.report.sandbox.title")}
              </Text>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.report.sandbox.bannerTitle")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("verification.report.sandbox.bannerDesc")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("verification.report.sandbox.limit1")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("verification.report.sandbox.limit2")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("verification.report.sandbox.limit3")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("verification.report.sandbox.limit4")}
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        {t("verification.report.sandbox.limit5")}
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
              {reportData.sandboxLimitations.missingFields.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.sandbox.missingFields")}
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      {t("verification.report.sandbox.missingFieldsBanner")}
                    </Text>
                  </Banner>
                  {reportData.sandboxLimitations.missingFields.map((item, index) => (
                    <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {t("verification.report.sandbox.item.eventType")} {item.eventType}
                        </Text>
                        <Text as="p" variant="bodySm">
                          {t("verification.report.sandbox.item.missingFields")} {item.fields.join(", ")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("verification.report.sandbox.item.reason")} {item.reason}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
              {reportData.sandboxLimitations.unavailableEvents.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.sandbox.unavailableEvents")}
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      {t("verification.report.sandbox.unavailableEventsBanner")}
                    </Text>
                  </Banner>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="bodySm">
                      {reportData.sandboxLimitations.unavailableEvents.join(", ")}
                    </Text>
                  </Box>
                </BlockStack>
              )}
              {reportData.sandboxLimitations.notes.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.sandbox.autoMarkTitle")}
                  </Text>
                  <Banner tone="info">
                    <BlockStack gap="200">
                      {reportData.sandboxLimitations.notes.map((note, index) => (
                        <Text key={index} as="p" variant="bodySm">
                          {note}
                        </Text>
                      ))}
                    </BlockStack>
                  </Banner>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {reportData.reconciliation && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("verification.report.reconciliation.title")}
              </Text>
              {reportData.reconciliation.localConsistency && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.reconciliation.local.title")}
                  </Text>
                  <Layout>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            {reportData.reconciliation.localConsistency.totalChecked}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("verification.report.reconciliation.local.checked")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                            {reportData.reconciliation.localConsistency.consistent}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("verification.report.reconciliation.local.consistent")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100" align="center">
                          <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                            {reportData.reconciliation.localConsistency.inconsistent}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("verification.report.reconciliation.local.inconsistent")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Layout.Section>
                  </Layout>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}
        {!canExportReports && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                <Trans i18nKey="verification.report.upgrade.desc" components={{ strong: <strong /> }} />
              </Text>
              <Button url="/app/billing?upgrade=growth" variant="primary">
                {t("verification.report.upgrade.button")}
              </Button>
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
