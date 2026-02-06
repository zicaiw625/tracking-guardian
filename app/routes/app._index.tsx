import type { loader } from "./app._index/loader.server";
export { loader } from "./app._index/loader.server";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { useState, useEffect, useCallback } from "react";
import { Page, BlockStack, Banner, Text } from "@shopify/polaris";
import { DashboardOverview } from "~/components/dashboard/DashboardOverview";
import { DashboardMetrics } from "~/components/dashboard/DashboardMetrics";
import { useToastContext } from "~/components/ui";
import {
  getSetupSteps,
  getNextSetupStep,
  getSetupProgress,
  type DashboardData,
} from "../types/dashboard";
import { DEPRECATION_DATES, formatDeadlineDate } from "../utils/migration-deadlines";
import { ScriptTagMigrationBanner } from "~/components/dashboard/ScriptTagMigrationBanner";
import { MigrationDeadlineBanner } from "~/components/dashboard/MigrationDeadlineBanner";
import { useTranslation, Trans } from "react-i18next";

const WELCOME_BANNER_DISMISSED_KEY = "tg-welcome-banner-dismissed";

export default function Index() {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(true);
  const [showScanProgress, setShowScanProgress] = useState(false);
  const [scanStartedAt] = useState(() => new Date());
  
  const upgradeFetcher = useFetcher();
  const scanFetcher = useFetcher();
  const { showSuccess, showError } = useToastContext();
  const isUpgrading = upgradeFetcher.state === "submitting";

  const handleFixPixel = useCallback(() => {
    if (isUpgrading) return;
    const formData = new FormData();
    upgradeFetcher.submit(formData, {
      method: "post",
      action: "/app/actions/upgrade-web-pixel",
    });
  }, [upgradeFetcher, isUpgrading]);

  useEffect(() => {
    const upgradeResult = upgradeFetcher.data as any;
    if (!upgradeResult || upgradeFetcher.state !== "idle") return;
    
    if (upgradeResult.success) {
      showSuccess(upgradeResult.message || t("scan.success.upgraded"));
      // Revalidate to reflect changes
      revalidator.revalidate();
    } else if (upgradeResult.error) {
       let errorMessage = upgradeResult.error;
       if (upgradeResult.details && upgradeResult.details.message) {
           errorMessage = upgradeResult.details.message;
       }
       showError(errorMessage || t("scan.errors.upgradeFailed"));
    }
  }, [upgradeFetcher.data, upgradeFetcher.state, showSuccess, showError, t, revalidator]);

  // Handle auto-scan for new installs
  useEffect(() => {
    if (scanFetcher.state === "idle" && scanFetcher.data) {
       // Scan completed
       setShowScanProgress(false);
       // Refresh page data
       revalidator.revalidate();
    }
  }, [scanFetcher.state, scanFetcher.data, revalidator]);

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
    // Only trigger if we haven't started scanning yet and we are not currently scanning
    if (isNewInstall && scanFetcher.state === "idle" && !scanFetcher.data) {
      setShowScanProgress(true);
      const formData = new FormData();
      formData.append("_action", "scan");
      scanFetcher.submit(formData, { method: "post", action: "/app/scan" });
    }
  }, [data.showOnboarding, data.latestScan, scanFetcher]);
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
  return (
    <Page
      title={t("dashboard.title")}
      subtitle={t("dashboard.subtitle", {
        date1: formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact"),
        date2: formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month"),
        date3: formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact"),
      })}
      primaryAction={
        !progress.allComplete && nextStep
          ? { content: nextStep.cta, url: nextStep.url }
          : undefined
      }
    >
      <BlockStack gap="500">
        <DashboardOverview
          data={data}
          showWelcomeBanner={showWelcomeBanner}
          showScanProgress={showScanProgress}
          scanStartedAt={scanStartedAt}
          onDismissWelcomeBanner={handleDismissWelcomeBanner}
          onScanComplete={handleScanComplete}
          backendUrlInfo={loaderData.backendUrlInfo}
          onFixPixel={handleFixPixel}
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
          title={t("dashboard.scriptTagBanner.title")}
          tone="info"
          action={{ content: t("dashboard.scriptTagBanner.action"), url: "/app/scan" }}
          secondaryAction={{ content: t("dashboard.scriptTagBanner.secondaryAction"), url: "/app/verification" }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              <Trans
                i18nKey="dashboard.scriptTagBanner.content"
                values={{
                  date: formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")
                }}
                components={{ strong: <strong /> }}
              />
            </Text>
          </BlockStack>
        </Banner>
        <MigrationDeadlineBanner />
      </BlockStack>
    </Page>
  );
}
