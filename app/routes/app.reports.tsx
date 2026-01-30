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
  const { shop, canExportReports, latestRun, gateResult, currentPlan } = useLoaderData<typeof loader>();

  const handleExportVerificationCsv = () => {
    if (!latestRun || !canExportReports) return;
    window.location.href = `/api/reports?type=verification&runId=${latestRun.runId}&format=csv`;
  };

  return (
    <Page
      title="报告中心"
      subtitle="查看与导出扫描报告、验收报告"
    >
      <BlockStack gap="500">
        <PageIntroCard
          title="报告中心"
          description="在此可前往扫描页或验收页查看详情，并导出扫描报告、验收报告（CSV 导出需 Growth 及以上套餐）。"
          items={[
            "扫描报告：在「Audit」页完成扫描后，可导出扫描报告 CSV",
            "验收报告：在「验收」页运行验收后，可导出验收报告 CSV",
          ]}
          primaryAction={{ content: "前往验收", url: "/app/verification" }}
          secondaryAction={{ content: "前往扫描", url: "/app/scan" }}
        />
        {!shop ? (
          <Banner tone="warning">
            未找到店铺配置，请确保应用已正确安装。
          </Banner>
        ) : (
          <>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  扫描报告
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  在「Audit」页完成自动或手动扫描后，可在该页导出扫描报告（CSV）。导出需 Growth 及以上套餐。
                </Text>
                <InlineStack gap="200">
                  <Button url="/app/scan" variant="primary">
                    前往扫描页
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  验收报告
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  在「验收」页运行验收后，可在此或验收页导出最近一次验收报告（CSV）。导出需 Growth 及以上套餐。
                </Text>
                {latestRun ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      最近一次验收：{latestRun.runName}，{latestRun.status === "completed" ? "已完成" : latestRun.status}
                      {latestRun.startedAt ? `，${new Date(latestRun.startedAt).toLocaleString()}` : ""}
                    </Text>
                    {canExportReports ? (
                      <InlineStack gap="200">
                        <Button onClick={handleExportVerificationCsv} variant="primary">
                          导出验收报告 CSV
                        </Button>
                        <Button url={`/app/verification/report/${latestRun.runId}`} variant="secondary">
                          查看详情
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
                      前往验收页运行验收
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
