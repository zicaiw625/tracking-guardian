import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, BlockStack, Card, Text, InlineStack, Button, Banner } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVerificationHistory } from "../services/verification.server";
import { checkFeatureAccess } from "../services/billing/feature-gates.server";
import { normalizePlanId, type PlanId } from "../services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";
import { useLocale } from "~/context/LocaleContext";

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
      gateResult: null,
      currentPlan: "free" as PlanId,
    });
  }
  const planId = normalizePlanId(shop.plan || "free") as PlanId;
  const gateResult = checkFeatureAccess(planId, "report_export");
  const canExportReports = gateResult.allowed;
  const history = await getVerificationHistory(shop.id, 1);
  const latestRun = history?.[0] ?? null;
  return json({
    shop: { id: shop.id, domain: shopDomain },
    canExportReports,
    latestRun,
    gateResult: gateResult.allowed ? null : gateResult,
    currentPlan: planId,
  });
};

export default function ReportsPage() {
  const { t, tArray } = useLocale();
  const { shop, canExportReports, latestRun, gateResult, currentPlan } = useLoaderData<typeof loader>();

  const handleExportVerificationCsv = () => {
    if (!latestRun || !canExportReports) return;
    window.location.href = `/api/reports?type=verification&runId=${latestRun.runId}&format=csv`;
  };

  return (
    <Page
      title={t("reports.title")}
      subtitle={t("reports.subtitle")}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("reports.title")}
          description={t("reports.description")}
          items={tArray("reports.items")}
          primaryAction={{ content: t("reports.goToVerification"), url: "/app/verification" }}
          secondaryAction={{ content: t("reports.goToScan"), url: "/app/scan" }}
        />
        {!shop ? (
          <Banner tone="warning">
            {t("reports.shopNotFound")}
          </Banner>
        ) : (
          <>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("reports.scanReport")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("reports.scanReportDesc")}
                </Text>
                <InlineStack gap="200">
                  <Button url="/app/scan" variant="primary">
                    {t("reports.goToScanPage")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("reports.verificationReport")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("reports.verificationReportDesc")}
                </Text>
                {latestRun ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("reports.latestRun")}: {latestRun.runName}, {latestRun.status === "completed" ? t("reports.completed") : latestRun.status}
                      {latestRun.startedAt ? `, ${new Date(latestRun.startedAt).toLocaleString()}` : ""}
                    </Text>
                    {canExportReports ? (
                      <InlineStack gap="200">
                        <Button onClick={handleExportVerificationCsv} variant="primary">
                          {t("reports.exportVerificationCsv")}
                        </Button>
                        <Button url={`/app/verification/report/${latestRun.runId}`} variant="secondary">
                          {t("reports.viewDetails")}
                        </Button>
                      </InlineStack>
                    ) : (
                      <UpgradePrompt
                        feature="verification"
                        currentPlan={currentPlan}
                        gateResult={gateResult ?? undefined}
                      />
                    )}
                  </BlockStack>
                ) : (
                  <InlineStack gap="200">
                    <Button url="/app/verification" variant="primary">
                      {t("reports.goToVerificationPage")}
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
