import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  Badge,
  Tabs,
  Box,
  EmptyState,
  Modal,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { RefreshIcon, ExportIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import {
  VerificationResultsTable,
} from "~/components/verification/VerificationResultsTable";
import {
  VerificationHistoryPanel,
} from "~/components/verification/VerificationHistoryPanel";
import { TestOrderGuide } from "~/components/verification/TestOrderGuide";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useTranslation } from "react-i18next";
import type { VerificationHistoryRun } from "~/components/verification/VerificationHistoryPanel";

import {
  createVerificationRun,
  startVerificationRun,
  analyzeRecentEvents,
  getVerificationRun,
} from "~/services/verification.server";
import { i18nServer } from "~/i18n.server";
import { checkPlanGate } from "~/middleware/plan-gate";
import { normalizePlanId, type PlanId } from "~/services/billing/plans";
import { UpgradePrompt } from "~/components/ui/UpgradePrompt";

interface VerificationRunSummary {
  passedTests: number;
  failedTests: number;
  missingParamTests: number;
}

import { safeFireAndForget } from "~/utils/helpers.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      pixelConfigs: { where: { isActive: true }, take: 1 },
      webPixelId: true,
    },
  });

  if (!shop) {
    return json({
      shop: null,
      latestRun: null,
      history: [],
      gate: null,
      currentPlan: "free" as PlanId,
    });
  }

  const currentPlan = normalizePlanId(shop.plan || "free") as PlanId;
  const gate = await checkPlanGate(shop.id, "verification");
  if (!gate.allowed) {
    return json({
      shop,
      latestRun: null,
      history: [],
      gate,
      currentPlan,
    });
  }

  const latestRunRaw = await prisma.verificationRun.findFirst({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let latestRun = null;
  if (latestRunRaw) {
    try {
      latestRun = await getVerificationRun(latestRunRaw.id);
    } catch (e) {
      console.error("Failed to get latest verification run:", e);
    }
  }

  const historyRaw = await prisma.verificationRun.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      createdAt: true,
      status: true,
      runType: true,
      completedAt: true,
      runName: true,
      summaryJson: true,
    },
  });

  const history = historyRaw.map(h => {
    let summary: VerificationRunSummary = {} as VerificationRunSummary;
    try {
      summary = (h.summaryJson || {}) as unknown as VerificationRunSummary;
    } catch (e) {
      console.error(`Failed to parse summaryJson for run ${h.id}`, e);
    }
    return {
      runId: h.id,
      runName: h.runName,
      runType: h.runType as "quick" | "full" | "custom",
      status: h.status,
      passedTests: summary?.passedTests || 0,
      failedTests: summary?.failedTests || 0,
      missingParamTests: summary?.missingParamTests || 0,
      completedAt: h.completedAt ? h.completedAt.toISOString() : h.createdAt.toISOString()
    };
  });

  return json({ shop, latestRun, history, gate: null, currentPlan });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const t = await i18nServer.getFixedT(request);
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ success: false, error: t("verification.errors.shopNotFound") }, { status: 404 });
  }

  const gate = await checkPlanGate(shop.id, "verification");
  if (!gate.allowed) {
    return json({ success: false, error: "Plan upgrade required" }, { status: 403 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "verifyTestItem") {
    const itemId = formData.get("itemId") as string;
    // const eventType = formData.get("eventType") as string; // Currently unused in check, we use expectedEvents
    const expectedEventsRaw = formData.get("expectedEvents") as string;
    let expectedEvents: string[] = [];
    try {
      const parsed = expectedEventsRaw ? JSON.parse(expectedEventsRaw) : [];
      if (Array.isArray(parsed)) {
        expectedEvents = parsed;
      }
    } catch (e) {
      console.error("Failed to parse expectedEvents:", e);
      return json({ success: false, error: t("verification.errors.invalidEventData") }, { status: 400 });
    }

    // Check for recent events (last 1 hour)
    const recentEvents = await prisma.pixelEventReceipt.findMany({
      where: {
        shopId: shop.id,
        eventType: { in: expectedEvents },
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      select: { eventType: true },
    });

    const foundEventTypes = new Set(recentEvents.map((e) => e.eventType));
    const missingEvents = expectedEvents.filter((e: string) => !foundEventTypes.has(e));
    const verified = missingEvents.length === 0;

    return json({
      success: true,
      itemId,
      verified,
      eventsFound: foundEventTypes.size,
      expectedEvents: expectedEvents.length,
      missingEvents,
    });
  }

  if (actionType === "runVerification") {
    try {
      // 1. Create a new verification run
      const runId = await createVerificationRun(shop.id, {
        runName: "Manual Verification",
        runType: "quick",
      });

      // 2. Mark as running
      await startVerificationRun(runId);

      // 3. Analyze recent events (look back 24 hours) - Run in background
      safeFireAndForget(
        analyzeRecentEvents(shop.id, runId, {
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        })
      );

      return json({ success: true, message: t("verification.page.actions.runStarted"), runId });
    } catch (error) {
      console.error("Verification failed:", error);
      const errorMessage = error instanceof Error ? error.message : t("verification.errors.verificationFailed");
      return json({ success: false, error: errorMessage }, { status: 500 });
    }
  }

  return json({ success: false, error: t("verification.errors.unknownAction") }, { status: 400 });
};

export default function VerificationPage() {
  const { t } = useTranslation();
  const { shop, latestRun, history, gate, currentPlan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<any>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showSuccess, showError } = useToastContext();
  
  const guideTestItems = [
    {
      id: "purchase_test",
      name: t("verification.testItems.purchase_test.name"),
      description: t("verification.testItems.purchase_test.description"),
      steps: [
        t("verification.testItems.purchase_test.steps.0"),
        t("verification.testItems.purchase_test.steps.1"),
        t("verification.testItems.purchase_test.steps.2")
      ],
      expectedEvents: ["purchase"]
    }
  ];
  
  const tabParam = searchParams.get("tab");
  const selectedTab = tabParam ? Math.max(0, parseInt(tabParam, 10) || 0) : 0;
  const [showGuide, setShowGuide] = useState(false);

  const isRunning = fetcher.state !== "idle" && fetcher.formMethod === "post";

  const handleTabChange = useCallback(
    (selectedTabIndex: number) => {
      setSearchParams((prev) => {
        prev.set("tab", selectedTabIndex.toString());
        return prev;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        showSuccess(t("verification.page.actions.runStarted") || "Verification started");
      } else if (fetcher.data.error) {
        showError(fetcher.data.error);
      }
    }
  }, [fetcher.data, showSuccess, showError, t]);

  const tabs = [
    { id: "overview", content: t("verification.page.tabs.overview") },
    { id: "pixel-layer", content: t("verification.page.tabs.pixelLayer") },
    { id: "results", content: t("verification.page.tabs.results") },
    { id: "test-guide", content: t("verification.page.tabs.guide") },
    { id: "history", content: t("verification.page.tabs.history") },
  ];

  const handleRunVerification = () => {
    fetcher.submit({ _action: "runVerification" }, { method: "post" });
  };

  if (gate && !gate.allowed) {
    return (
      <Page title={t("verification.page.title")}>
        <UpgradePrompt feature="verification" currentPlan={currentPlan} gateResult={gate} />
      </Page>
    );
  }

  if (!shop) {
    return (
      <Page>
        <EmptyState
          heading={t("verification.page.empty.title")}
          action={{ content: t("verification.page.empty.action"), url: "/" }}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>{t("verification.page.empty.desc")}</p>
        </EmptyState>
      </Page>
    );
  }

  const passRate = latestRun && latestRun.totalTests > 0
    ? Math.round(
        (latestRun.passedTests / latestRun.totalTests) * 100
      )
    : 0;
  
  const passRateDisplay = latestRun && latestRun.totalTests > 0 ? `${passRate}%` : "-";
  const completenessDisplay = latestRun && latestRun.totalTests > 0 ? `${latestRun.parameterCompleteness}%` : "-";
  const accuracyDisplay = latestRun && latestRun.totalTests > 0 ? `${latestRun.valueAccuracy}%` : "-";

  return (
    <Page
      title={t("verification.page.title")}
      subtitle={t("verification.page.subtitle")}
      primaryAction={{
        content: isRunning ? t("verification.page.actions.running") : t("verification.page.actions.run"),
        onAction: handleRunVerification,
        loading: isRunning,
      }}
      secondaryActions={[
        {
          content: t("verification.page.actions.refresh"),
          icon: RefreshIcon,
          onAction: () => navigate(".", { replace: true }),
        },
        {
          content: t("verification.page.actions.export"),
          icon: ExportIcon,
          disabled: !latestRun,
          onAction: () => {
            const url = `/api/reports?type=verification&runId=${latestRun?.runId}&format=csv`;
            const link = document.createElement("a");
            link.href = url;
            link.download = "";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          },
        },
      ]}
    >
      <BlockStack gap="500">
        <PageIntroCard
          title={t("verification.page.intro.title")}
          description={t("verification.page.intro.desc")}
          items={[
            t("verification.page.intro.items.0"),
            t("verification.page.intro.items.1"),
          ]}
          primaryAction={{
            content: t("verification.page.intro.action"),
            onAction: () => handleTabChange(2), // Jump to results
          }}
        />

        {latestRun ? (
          <BlockStack gap="400">
            {passRate < 100 && latestRun.totalTests > 0 && (
              <Banner tone="warning" title={t("verification.page.banners.failed.title")}>
                <p>{t("verification.page.banners.failed.reasons")}</p>
                <ul>
                  <li>{t("verification.page.banners.failed.items.0")}</li>
                  <li>{t("verification.page.banners.failed.items.1")}</li>
                  <li>{t("verification.page.banners.failed.items.2")}</li>
                </ul>
              </Banner>
            )}
            {passRate === 100 && latestRun.totalTests > 0 && (
              <Banner tone="success" title={t("verification.page.banners.passed.title")}>
                <p>{t("verification.page.banners.passed.desc")}</p>
              </Banner>
            )}

            <Layout>
              <Layout.Section>
                <Card>
                  <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                    <Box padding="400">
                      {selectedTab === 0 && (
                        <BlockStack gap="400">
                          <InlineStack gap="400" align="space-between">
                            <ScoreCard
                              title={t("verification.page.score.passRate")}
                              score={passRateDisplay}
                              description={t("verification.page.score.passRateDesc", {
                                value: latestRun.totalTests > 0 ? passRate : "-",
                              })}
                              tone={passRate === 100 && latestRun.totalTests > 0 ? "success" : "critical"}
                            />
                            <ScoreCard
                              title={t("verification.page.score.completeness")}
                              score={completenessDisplay}
                              description={t("verification.page.score.completenessDesc")}
                              tone={
                                latestRun.parameterCompleteness === 100 && latestRun.totalTests > 0
                                  ? "success"
                                  : "critical"
                              }
                            />
                            <ScoreCard
                              title={t("verification.page.score.accuracy")}
                              score={accuracyDisplay}
                              description={t("verification.page.score.accuracyDesc")}
                              tone={
                                latestRun.valueAccuracy === 100 && latestRun.totalTests > 0
                                  ? "success"
                                  : "critical"
                              }
                            />
                          </InlineStack>
                          <Banner tone="info" title={t("verification.page.banners.attribution.title")}>
                             <BlockStack gap="200">
                               <Text as="p" variant="bodySm" fontWeight="semibold">{t("verification.page.banners.attribution.subtitle")}</Text>
                               <Text as="p" variant="bodySm">{t("verification.page.banners.attribution.provide")}</Text>
                               <Text as="p" variant="bodySm">{t("verification.page.banners.attribution.noGuarantee")}</Text>
                               <Text as="p" variant="bodySm" tone="subdued">{t("verification.page.banners.attribution.report")}</Text>
                             </BlockStack>
                          </Banner>
                        </BlockStack>
                      )}
                      {selectedTab === 1 && (
                        <BlockStack gap="400">
                          <Text as="h3" variant="headingSm">
                            {t("verification.page.checklist.title")}
                          </Text>
                          {/* Reuse existing component or render list */}
                          <VerificationResultsTable latestRun={latestRun} pixelStrictOrigin={false} />
                        </BlockStack>
                      )}
                      {selectedTab === 2 && (
                         <VerificationResultsTable latestRun={latestRun} pixelStrictOrigin={false} />
                      )}
                      {selectedTab === 3 && (
                        <TestOrderGuide shopDomain={shop.shopDomain} shopId={shop.id} testItems={guideTestItems} />
                      )}
                      {selectedTab === 4 && (
                        <VerificationHistoryPanel history={history as VerificationHistoryRun[]} onRunVerification={handleRunVerification} shop={shop} />
                      )}
                    </Box>
                  </Tabs>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="400">
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingSm">
                        {t("verification.page.status.title")}
                      </Text>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">
                          {t("verification.page.status.time")}
                        </Text>
                        <Text as="span">
                          {latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : "-"}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                         <Text as="span" tone="subdued">
                          {t("verification.page.status.type")}
                        </Text>
                        <Badge>{latestRun.runType === "full" ? t("verification.page.status.full") : t("verification.page.status.quick")}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingSm">
                         {t("verification.page.related.title")}
                      </Text>
                      <Button variant="plain" url="/app/settings">
                        {t("verification.page.related.settings")}
                      </Button>
                      <Button variant="plain" url="/app/pixels/new">
                        {t("verification.page.related.install")}
                      </Button>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        ) : (
          <Card>
            <EmptyState
              heading={t("verification.page.noRun.title")}
              action={{
                content: t("verification.page.noRun.action"),
                onAction: handleRunVerification,
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>{t("verification.page.noRun.desc")}</p>
              <p>{t("verification.page.noRun.help")}</p>
            </EmptyState>
          </Card>
        )}
      </BlockStack>
      <Modal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        title={t("verification.page.guideModal.title")}
        primaryAction={{
          content: t("verification.page.guideModal.action"),
          onAction: () => setShowGuide(false),
        }}
      >
        <Modal.Section>
           <TestOrderGuide shopDomain={shop.shopDomain} shopId={shop.id} testItems={guideTestItems} />
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function ScoreCard({
  title,
  score,
  description,
  tone = "success",
}: {
  title: string;
  score: string;
  description: string;
  tone?: "success" | "critical";
}) {
  return (
    <div style={{ flex: 1 }}>
      <Card>
        <BlockStack gap="200" align="center">
          <Text as="h3" variant="headingSm" tone="subdued">
            {title}
          </Text>
          <Text as="p" variant="heading2xl" tone={tone}>
            {score}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            {description}
          </Text>
        </BlockStack>
      </Card>
    </div>
  );
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  return (
    <Page>
      <Banner tone="critical" title={t("verification.page.error.title")}>
        <p>{t("verification.page.error.description")}</p>
        <Button onClick={() => window.location.reload()}>{t("verification.page.error.reload")}</Button>
      </Banner>
    </Page>
  );
}
