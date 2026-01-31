import type { loader } from "./app._index/loader.server";
export { loader } from "./app._index/loader.server";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Page, BlockStack, Banner, Text } from "@shopify/polaris";
import { DashboardOverview } from "~/components/dashboard/DashboardOverview";
import { DashboardMetrics } from "~/components/dashboard/DashboardMetrics";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
} from "../types/dashboard";
import { DEPRECATION_DATES, formatDeadlineDate } from "../utils/migration-deadlines";
import { ScriptTagMigrationBanner } from "~/components/dashboard/ScriptTagMigrationBanner";
import { MigrationDeadlineBanner } from "~/components/dashboard/MigrationDeadlineBanner";
import { useT } from "~/context/LocaleContext";

const WELCOME_BANNER_DISMISSED_KEY = "tg-welcome-banner-dismissed";

export default function Index() {
  const t = useT();
  const loaderData = useLoaderData<typeof loader>();
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [showScanProgress, setShowScanProgress] = useState(false);
  const [scanStartedAt] = useState(() => new Date());
  const data = {
    ...loaderData,
    latestScan: loaderData.latestScan
      ? {
          ...loaderData.latestScan,
          createdAt: new Date(loaderData.latestScan.createdAt as string),
        }
      : null,
    migrationProgress: loaderData.migrationProgress
      ? {
          ...loaderData.migrationProgress,
          verificationLatest: loaderData.migrationProgress.verificationLatest
            ? {
                ...loaderData.migrationProgress.verificationLatest,
                completedAt:
                  loaderData.migrationProgress.verificationLatest.completedAt != null
                    ? new Date(loaderData.migrationProgress.verificationLatest.completedAt as string)
                    : null,
              }
            : undefined,
        }
      : undefined,
  } as DashboardData;
  const shopDomain = loaderData.shopDomain ?? "";
  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(WELCOME_BANNER_DISMISSED_KEY);
      if (dismissed === "true") {
        setShowWelcomeBanner(false);
      }
    } catch {
      setShowWelcomeBanner(true);
    }
    const isNewInstall = data.showOnboarding && !data.latestScan;
    if (isNewInstall) {
      setShowScanProgress(true);
      const timer = setTimeout(() => {
        setShowScanProgress(false);
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [data.showOnboarding, data.latestScan]);
  const handleDismissWelcomeBanner = () => {
    try {
      localStorage.setItem(WELCOME_BANNER_DISMISSED_KEY, "true");
    } catch {
      void 0;
    }
    setShowWelcomeBanner(false);
  };
  const handleScanComplete = () => {
    setShowScanProgress(false);
  };
  const setupSteps = getSetupSteps(data, t);
  const nextStep = getNextSetupStep(setupSteps);
  const progress = getSetupProgress(setupSteps);
  const plusStart = formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
  const plusMonth = formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
  const nonPlusEnd = formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
  return (
    <Page
      title={t("dashboard.title")}
      subtitle={t("dashboard.subtitle", { plusStart, plusMonth, nonPlusEnd })}
      primaryAction={
        !progress.allComplete && nextStep
          ? { content: nextStep.cta, url: nextStep.url }
          : undefined
      }
    >
      <BlockStack gap="500">
        <DashboardOverview
          data={data}
          shopDomain={shopDomain}
          showWelcomeBanner={showWelcomeBanner}
          showScanProgress={showScanProgress}
          scanStartedAt={scanStartedAt}
          onDismissWelcomeBanner={handleDismissWelcomeBanner}
          onScanComplete={handleScanComplete}
          backendUrlInfo={loaderData.backendUrlInfo}
        />
        <DashboardMetrics
          data={data}
          latestScan={loaderData.latestScan}
        />
        <ScriptTagMigrationBanner
          scriptTagsCount={data.scriptTagsCount}
          hasOrderStatusScripts={data.hasOrderStatusScripts}
        />
        <Banner
          title={t("dashboard.scriptTagTimeline")}
          tone="info"
          action={{ content: t("common.migrationChecklist"), url: "/app/scan" }}
          secondaryAction={{ content: t("common.verificationReport"), url: "/app/verification" }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              {t("dashboard.scriptTagNotice", { date: "2025-08-28" })}
            </Text>
          </BlockStack>
        </Banner>
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
