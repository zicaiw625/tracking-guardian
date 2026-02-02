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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
                <InlineStack gap="200">
                  <Button url="/app/scan" variant="primary">
                    {t("reports.scan.action")}
                  </Button>
                </InlineStack>
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
                        feature="verification"
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
