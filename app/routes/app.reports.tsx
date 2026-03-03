import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Button, Banner } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVerificationHistory } from "../services/verification.server";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { createScanReportShareLink, getLatestScanReportShareMeta, revokeScanReportShareLinks } from "~/services/report-share.server";
import { getPublicAppDomain } from "~/utils/config.server";
import { useToastContext } from "~/components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({
      shop: null,
      canExportReports: false,
      latestRun: null,
      latestCompletedScan: null,
      scanShareMeta: null,
      gateResult: null,
      currentPlan: "free" as PlanId,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "report_export");
  const canExportReports = gateResult.allowed;
  const history = await getVerificationHistory(shop.id, 1);
  const latestRun = history?.[0] ?? null;
  const latestCompletedScan = await prisma.scanReport.findFirst({
    where: {
      shopId: shop.id,
      completedAt: { not: null },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, completedAt: true, createdAt: true, status: true, riskScore: true },
  });
  const scanShareMeta = latestCompletedScan
    ? await getLatestScanReportShareMeta(shop.id, latestCompletedScan.id)
    : null;
  return json({
    shop: { id: shop.id, domain: shopDomain },
    canExportReports,
    latestRun,
    latestCompletedScan,
    scanShareMeta,
    gateResult: gateResult.allowed ? null : gateResult,
    currentPlan: planId,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });
  if (!shop) {
    return json({ success: false, error: "shop_not_found" }, { status: 404 });
  }
  const latestCompletedScan = await prisma.scanReport.findFirst({
    where: {
      shopId: shop.id,
      completedAt: { not: null },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!latestCompletedScan) {
    return json({ success: false, error: "scan_report_not_found" }, { status: 404 });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "report_export");
  if (!gateResult.allowed) {
    return json({ success: false, error: "upgrade_required" }, { status: 403 });
  }
  const formData = await request.formData();
  const actionType = formData.get("_action");
  if (actionType === "create_scan_share_link") {
    const expiresInDaysRaw = Number(formData.get("expiresInDays") || 3);
    const maxAccessCountRaw = Number(formData.get("maxAccessCount") || 20);
    const created = await createScanReportShareLink({
      shopId: shop.id,
      reportId: latestCompletedScan.id,
      createdBy: session.id,
      expiresInDays: Number.isFinite(expiresInDaysRaw) ? expiresInDaysRaw : 3,
      maxAccessCount: Number.isFinite(maxAccessCountRaw) ? maxAccessCountRaw : 20,
    });
    const baseUrl = getPublicAppDomain().replace(/\/+$/, "");
    const shareUrl = `${baseUrl}/s/${created.token}`;
    return json({
      success: true,
      action: "create_scan_share_link",
      shareUrl,
      expiresAt: created.expiresAt.toISOString(),
      maxAccessCount: created.maxAccessCount,
    });
  }
  if (actionType === "revoke_scan_share_link") {
    const revokedCount = await revokeScanReportShareLinks(shop.id, latestCompletedScan.id);
    return json({
      success: true,
      action: "revoke_scan_share_link",
      revokedCount,
    });
  }
  return json({ success: false, error: "unknown_action" }, { status: 400 });
};

export default function ReportsPage() {
  const { t } = useTranslation();
  const { showError, showSuccess } = useToastContext();
  const shareFetcher = useFetcher<{ success: boolean; action?: string; error?: string; shareUrl?: string }>();
  const {
    shop,
    canExportReports,
    latestRun,
    latestCompletedScan,
    scanShareMeta,
    gateResult,
    currentPlan
  } = useLoaderData<typeof loader>();
  const [latestScanShareUrl, setLatestScanShareUrl] = useState<string | null>(null);
  const shareSubmitting = shareFetcher.state !== "idle";

  const handleExportVerificationCsv = () => {
    if (!latestRun || !canExportReports) return;
    const url = `/api/reports?type=verification&runId=${latestRun.runId}&format=csv`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `verification-${latestRun.runId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const handleExportScanCsv = () => {
    if (!latestCompletedScan || !canExportReports) return;
    const url = `/api/reports?type=scan&reportId=${latestCompletedScan.id}&format=csv`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `scan-${latestCompletedScan.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const handleCreateScanShareLink = () => {
    if (!latestCompletedScan || shareSubmitting) return;
    shareFetcher.submit(
      { _action: "create_scan_share_link", expiresInDays: "3", maxAccessCount: "20" },
      { method: "post" }
    );
  };
  const handleRevokeScanShareLink = () => {
    if (!latestCompletedScan || shareSubmitting) return;
    shareFetcher.submit({ _action: "revoke_scan_share_link" }, { method: "post" });
  };
  const handleCopyScanShareUrl = async () => {
    if (!latestScanShareUrl) {
      showError(t("reports.scan.share.createFirst"));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      showError(t("reports.scan.share.copyNotSupported"));
      return;
    }
    try {
      await navigator.clipboard.writeText(latestScanShareUrl);
      showSuccess(t("reports.scan.share.copied"));
    } catch {
      showError(t("reports.scan.share.copyFailed"));
    }
  };
  const handleOpenScanSharePreview = () => {
    if (!latestScanShareUrl) {
      showError(t("reports.scan.share.createFirst"));
      return;
    }
    window.open(latestScanShareUrl, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const result = shareFetcher.data;
    if (!result) return;
    if (!result.success) {
      showError(t("reports.scan.share.failed"));
      return;
    }
    if (result.action === "create_scan_share_link" && result.shareUrl) {
      setLatestScanShareUrl(result.shareUrl);
      showSuccess(t("reports.scan.share.created"));
    }
    if (result.action === "revoke_scan_share_link") {
      setLatestScanShareUrl(null);
      showSuccess(t("reports.scan.share.revoked"));
    }
  }, [shareFetcher.data, showError, showSuccess, t]);

  return (
    <Page
      title={t("reports.title")}
      subtitle={t("reports.subtitle")}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("reports.intro.title")}
          description={t("reports.intro.desc")}
          items={t("reports.intro.items", { returnObjects: true }) as string[]}
          primaryAction={{ content: t("reports.intro.actions.verify"), url: "/app/verification" }}
          secondaryAction={{ content: t("reports.intro.actions.scan"), url: "/app/scan" }}
        />
        {!shop ? (
          <Banner tone="warning">
            {t("reports.empty")}
          </Banner>
        ) : (
          <>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("reports.scan.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("reports.scan.desc")}
                </Text>
                {latestCompletedScan ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("reports.scan.lastRun", {
                        reportId: latestCompletedScan.id,
                        status: latestCompletedScan.status,
                        score: latestCompletedScan.riskScore,
                        time: latestCompletedScan.completedAt
                          ? new Date(latestCompletedScan.completedAt).toLocaleString()
                          : new Date(latestCompletedScan.createdAt).toLocaleString(),
                      })}
                    </Text>
                    {canExportReports ? (
                      <>
                        <InlineStack gap="200">
                          <Button onClick={handleExportScanCsv} variant="primary">
                            {t("reports.scan.export")}
                          </Button>
                          <Button url="/app/scan" variant="secondary">
                            {t("reports.scan.action")}
                          </Button>
                        </InlineStack>
                        <InlineStack gap="200">
                          <Button onClick={handleCreateScanShareLink} loading={shareSubmitting} disabled={shareSubmitting}>
                            {t("reports.scan.share.create")}
                          </Button>
                          <Button onClick={handleCopyScanShareUrl} disabled={!latestScanShareUrl || shareSubmitting}>
                            {t("reports.scan.share.copy")}
                          </Button>
                          <Button onClick={handleOpenScanSharePreview} disabled={!latestScanShareUrl || shareSubmitting}>
                            {t("reports.scan.share.preview")}
                          </Button>
                          <Button tone="critical" onClick={handleRevokeScanShareLink} loading={shareSubmitting} disabled={shareSubmitting || (!scanShareMeta && !latestScanShareUrl)}>
                            {t("reports.scan.share.revoke")}
                          </Button>
                        </InlineStack>
                        {scanShareMeta && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("reports.scan.share.activeMeta", {
                              prefix: scanShareMeta.tokenPrefix,
                              expiresAt: new Date(scanShareMeta.expiresAt).toLocaleString(),
                            })}{" "}
                            {scanShareMeta.remainingAccessCount !== null
                              ? `(remaining: ${scanShareMeta.remainingAccessCount})`
                              : ""}
                          </Text>
                        )}
                        {latestScanShareUrl && (
                          <Text as="p" variant="bodySm" tone="success">
                            {t("reports.scan.share.newLink", { url: latestScanShareUrl })}
                          </Text>
                        )}
                      </>
                    ) : (
                      <UpgradePrompt
                        feature="report_export"
                        currentPlan={currentPlan}
                        gateResult={gateResult ?? undefined}
                      />
                    )}
                  </BlockStack>
                ) : (
                  <InlineStack gap="200">
                    <Button url="/app/scan" variant="primary">
                      {t("reports.scan.empty")}
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("reports.verification.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("reports.verification.desc")}
                </Text>
                {latestRun ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("reports.verification.lastRun", {
                        name: latestRun.runName,
                        status: latestRun.status === "completed" ? t("common.success") : latestRun.status,
                        time: latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : ""
                      })}
                    </Text>
                    {canExportReports ? (
                      <InlineStack gap="200">
                        <Button onClick={handleExportVerificationCsv} variant="primary">
                          {t("reports.verification.export")}
                        </Button>
                        <Button url={`/app/verification/report/${latestRun.runId}`} variant="secondary">
                          {t("reports.verification.view")}
                        </Button>
                      </InlineStack>
                    ) : (
                      <UpgradePrompt
                        feature="report_export"
                        currentPlan={currentPlan}
                        gateResult={gateResult ?? undefined}
                      />
                    )}
                  </BlockStack>
                ) : (
                  <InlineStack gap="200">
                    <Button url="/app/verification" variant="primary">
                      {t("reports.verification.empty")}
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
