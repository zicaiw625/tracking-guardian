import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData } from "@remix-run/react";
import { useState } from "react";
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
  if (!gateResult.allowed) {
    const pixelStrictOrigin = ["true", "1", "yes"].includes(
      (process.env.PIXEL_STRICT_ORIGIN ?? "").toLowerCase().trim()
    );
    return json({
      shop: { id: shop.id, domain: shopDomain },
      run: null,
      reportData: null,
      canExportReports: false,
      gateResult,
      currentPlan: planId,
      pixelStrictOrigin,
    });
  }
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
    return json({ success: false, error: "Missing runId" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const canExportReports = planSupportsReportExport(planId);
  if (actionType === "export_csv") {
    if (!canExportReports) {
      return json({ success: false, error: "Growth or Agency plan is required to export reports" }, { status: 403 });
    }
    const reportData = await generateVerificationReportData(shop.id, runId);
    if (!reportData) {
      return json({ success: false, error: "Report data not found" }, { status: 404 });
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
  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

import { useTranslation } from "react-i18next";

// ... existing imports ...

export function ErrorBoundary() {
  const { t } = useTranslation();
  return (
    <Page>
      <Banner tone="critical" title={t("verification.report.error.title")}>
        <p>{t("verification.report.error.description")}</p>
        <Button onClick={() => window.location.reload()}>{t("verification.report.error.reload")}</Button>
      </Banner>
    </Page>
  );
}

export default function VerificationReportPage() {
  const { shop, run, reportData, canExportReports, gateResult, currentPlan, pixelStrictOrigin } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  useActionData<typeof action>();
  useToastContext();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const [isExporting, setIsExporting] = useState(false);

  if (!shop) {
    return (
      <Page title={t("verification.report.pageTitle", { runName: "" })}>
        <Banner tone="warning">
          <Text as="p">{t("verification.report.shopNotFound")}</Text>
        </Banner>
      </Page>
    );
  }

  if (gateResult && !gateResult.allowed) {
    return (
      <Page title={t("verification.report.pageTitle", { runName: "" })}>
        <UpgradePrompt feature="verification" currentPlan={currentPlan} gateResult={gateResult} />
      </Page>
    );
  }

  if (!run || !reportData) {
    return (
      <Page title={t("verification.report.pageTitle", { runName: "" })}>
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
    if (date == null) return t("verification.report.info.notStarted");
    return new Date(date).toLocaleString(locale);
  };

  return (
    <Page
      title={t("verification.report.pageTitle", { runName: reportData.runName })}
      subtitle={t("verification.report.subtitle")}
      backAction={{ content: t("verification.report.actions.back"), url: "/app/verification" }}
      primaryAction={
        canExportReports
          ? {
              content: t("verification.report.actions.export"),
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
          items={t("verification.report.intro.items", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("verification.report.actions.back"), url: "/app/verification" }}
          secondaryAction={{ content: t("verification.report.actions.reportCenter"), url: "/app/reports" }}
        />
        {reportData.limitReached && (
            <Banner tone="warning" title={t("verification.report.limitReached.title")}>
                <Text as="p" variant="bodySm">
                    {t("verification.report.limitReached.description")}
                </Text>
            </Banner>
        )}
        {reportData.reconciliationError && (
            <Banner tone="critical" title={t("verification.report.reconciliationError.title")}>
                <Text as="p" variant="bodySm">
                    {t("verification.report.reconciliationError.description")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                    {reportData.reconciliationError}
                </Text>
            </Banner>
        )}
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
                    {reportData.runType === "quick" 
                      ? t("verification.report.info.types.quick") 
                      : reportData.runType === "full" 
                        ? t("verification.report.info.types.full") 
                        : t("verification.report.info.types.custom")}
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
                {t("verification.report.platformStats.title")}
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                headings={[
                    t("verification.report.platformStats.platform"),
                    t("verification.report.platformStats.sent"),
                    t("verification.report.platformStats.failed"),
                    t("verification.report.platformStats.successRate")
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
              
              <SandboxLimitationsInfo />

              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text", "numeric", "text", "text", "text"]}
                headings={[
                    t("verification.report.events.table.testItem"),
                    t("verification.report.events.table.eventType"),
                    t("verification.report.events.table.platform"),
                    t("verification.report.events.table.orderId"),
                    t("verification.report.events.table.status"),
                    t("verification.report.events.table.amount"),
                    t("verification.report.events.table.currency"),
                    t("verification.report.events.table.issues"),
                    t("verification.report.events.table.limitations")
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
                  {t("verification.report.events.more")}
                </Text>
              )}
            </BlockStack>
          </Card>
        )}
        {!pixelStrictOrigin && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("verification.report.originWarning.title")}
              </Text>
              <Text as="p" variant="bodySm">
                <span dangerouslySetInnerHTML={{ __html: t("verification.report.originWarning.desc") }} />
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
                    {t("verification.report.sandbox.banner.title")}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {t("verification.report.sandbox.banner.desc")}
                  </Text>
                  <List type="bullet">
                    {(t("verification.report.sandbox.limitations", { returnObjects: true }) as string[]).map((limit, idx) => (
                        <List.Item key={idx}><Text as="span" variant="bodySm">{limit}</Text></List.Item>
                    ))}
                  </List>
                </BlockStack>
              </Banner>
              {reportData.sandboxLimitations.missingFields.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.sandbox.missingFields.title")}
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      {t("verification.report.sandbox.missingFields.desc")}
                    </Text>
                  </Banner>
                  {reportData.sandboxLimitations.missingFields.map((item, index) => (
                    <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {t("verification.report.sandbox.missingFields.eventType")} {item.eventType}
                        </Text>
                        <Text as="p" variant="bodySm">
                          {t("verification.report.sandbox.missingFields.fields")} {item.fields.join(", ")}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("verification.report.sandbox.missingFields.reason")} {item.reason}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
              {reportData.sandboxLimitations.unavailableEvents.length > 0 && (
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    {t("verification.report.sandbox.unavailableEvents.title")}
                  </Text>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      {t("verification.report.sandbox.unavailableEvents.desc")}
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
                    {t("verification.report.sandbox.autoLabel.title")}
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
                            {t("verification.report.reconciliation.local.total")}
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
                {t("verification.report.upgrade.desc")}
              </Text>
              <Button url="/app/billing?upgrade=growth" variant="primary">
                {t("verification.report.upgrade.action")}
              </Button>
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}

function SandboxLimitationsInfo() {
    const { t } = useTranslation();
    // This component renders the detailed sandbox limitations info 
    // Uses translations to avoid hardcoded text
    return (
        <Banner tone="info">
            <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                    <span dangerouslySetInnerHTML={{__html: t("verification.report.sandbox.infoBanner.p1")}} />
                </Text>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                    <span dangerouslySetInnerHTML={{__html: t("verification.report.sandbox.infoBanner.p2")}} />
                </Text>
                <Text as="p" variant="bodySm">
                    <span dangerouslySetInnerHTML={{__html: t("verification.report.sandbox.infoBanner.p3")}} />
                </Text>
                <Text as="p" variant="bodySm">
                    <span dangerouslySetInnerHTML={{__html: t("verification.report.sandbox.infoBanner.p4")}} />
                </Text>
                <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.report.sandbox.infoBanner.knownLimits")}
                </Text>
                <List type="bullet">
                    {(t("verification.report.sandbox.infoBanner.limitsList", { returnObjects: true }) as string[]).map((item, i) => (
                        <List.Item key={i}>
                             <Text as="span" variant="bodySm">
                                <span dangerouslySetInnerHTML={{__html: item}} />
                             </Text>
                        </List.Item>
                    ))}
                </List>
                 <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("verification.report.sandbox.infoBanner.unavailableEventsTitle")}
                </Text>
                 <Text as="p" variant="bodySm">
                    {t("verification.report.sandbox.infoBanner.unavailableEventsDesc")}
                </Text>
                 <Text as="p" variant="bodySm" tone="subdued">
                    <span dangerouslySetInnerHTML={{__html: t("verification.report.sandbox.infoBanner.autoLabelDesc")}} />
                 </Text>
            </BlockStack>
        </Banner>
    );
}
