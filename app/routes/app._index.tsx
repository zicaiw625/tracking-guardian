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

const WELCOME_BANNER_DISMISSED_KEY = "tg-welcome-banner-dismissed";

export default function Index() {
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
  const setupSteps = getSetupSteps(data);
  const nextStep = getNextSetupStep(setupSteps);
  const progress = getSetupProgress(setupSteps);
  return (
    <Page
      title="升级迁移交付平台"
      subtitle={`Shopify 官方 deadline：Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")} 开始限制，${formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month")} 起自动升级 • 非 Plus 商家 ${formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")} 截止 • 核心：迁移、验收、断档监控 • 可交付的验收报告 • 上线后有断档告警`}
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
          title="ScriptTag 弃用时间线（产品教育）"
          tone="info"
          action={{ content: "迁移清单", url: "/app/scan" }}
          secondaryAction={{ content: "验收报告", url: "/app/verification" }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              ScriptTag 在 Thank you / Order status 页面的能力与 <strong>2025-08-28</strong>（Plus 商家）的弃用相关（来自 Shopify 2025-01 公告）。建议使用「迁移」页的迁移清单与「验收」页的验证报告完成迁移，确保追踪平稳过渡。
            </Text>
          </BlockStack>
        </Banner>
        <MigrationDeadlineBanner scriptTagsCount={data.scriptTagsCount} />
      </BlockStack>
    </Page>
  );
}
