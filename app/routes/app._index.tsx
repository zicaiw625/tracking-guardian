import type { loader } from "./app._index/loader.server";
export { loader } from "./app._index/loader.server";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useEffect } from "react";
import { Page, BlockStack } from "@shopify/polaris";
import { DashboardOverview } from "~/components/dashboard/DashboardOverview";
import { DashboardMetrics } from "~/components/dashboard/DashboardMetrics";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
  type SetupStep,
} from "../types/dashboard";
import { DEPRECATION_DATES, formatDeadlineDate } from "../utils/migration-deadlines";
import { ScriptTagMigrationBanner } from "~/components/dashboard/ScriptTagMigrationBanner";
import { MigrationDeadlineBanner } from "~/components/dashboard/MigrationDeadlineBanner";

const WELCOME_BANNER_DISMISSED_KEY = "tg-welcome-banner-dismissed";

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
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
  const customerAccountsEnabled = loaderData.customerAccountsEnabled ?? false;
  const shopDomain = loaderData.shopDomain ?? "";
  useEffect(() => {
    const dismissed = localStorage.getItem(WELCOME_BANNER_DISMISSED_KEY);
    if (dismissed === "true") {
      setShowWelcomeBanner(false);
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
    localStorage.setItem(WELCOME_BANNER_DISMISSED_KEY, "true");
    setShowWelcomeBanner(false);
  };
  const handleScanComplete = () => {
    setShowScanProgress(false);
  };
  const setupSteps = getSetupSteps(data);
  const nextStep = getNextSetupStep(setupSteps);
  const progress = getSetupProgress(setupSteps);
  const handleStartAudit = () => {
    navigate("/app/scan");
  };
  const handleViewDashboard = () => {
  };
  return (
    <Page
      title="升级迁移交付平台"
      subtitle={`Shopify 官方 deadline：Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} 开始限制，${formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month")} 起自动升级 • 非 Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 截止 • 升级不丢功能/不丢数据 • 可交付的验收报告 • 上线后有断档告警`}
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
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
