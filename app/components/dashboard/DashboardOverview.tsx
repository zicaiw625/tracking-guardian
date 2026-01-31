import { BlockStack, Card, Text, InlineStack, Button, Icon, Layout, Banner, List, Badge } from "@shopify/polaris";
import { ArrowRightIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { DataConnectionBanner } from "./DataConnectionBanner";
import { UpgradeHealthCheck } from "~/components/onboarding/UpgradeHealthCheck";
import { PostInstallScanProgress } from "~/components/onboarding/PostInstallScanProgress";
import { isPlanAtLeast } from "~/utils/plans";
import type { DashboardData } from "~/types/dashboard";
import { useLocale } from "~/context/LocaleContext";

interface DashboardOverviewProps {
  data: DashboardData;
  shopDomain: string;
  showWelcomeBanner: boolean;
  showScanProgress: boolean;
  scanStartedAt: Date;
  onDismissWelcomeBanner: () => void;
  onScanComplete: () => void;
  backendUrlInfo?: { placeholderDetected?: boolean };
}

export function DashboardOverview({
  data,
  shopDomain,
  showWelcomeBanner,
  showScanProgress,
  scanStartedAt,
  onDismissWelcomeBanner,
  onScanComplete,
  backendUrlInfo,
}: DashboardOverviewProps) {
  const { t, tArray } = useLocale();
  const introConfig = {
    title: t("dashboard.overview.title"),
    description: t("dashboard.overview.description"),
    items: tArray("dashboard.overview.items"),
    primaryAction: data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
      ? { content: t("dashboard.overview.startFreeScan"), url: "/app/scan" }
      : { content: t("dashboard.overview.viewFullReport"), url: "/app/scan?tab=2" },
    secondaryAction: { content: t("dashboard.overview.viewReportCenter"), url: "/app/reports" },
  };

  return (
    <BlockStack gap="500">
      {data.dataConnection && (
        <DataConnectionBanner
          hasIngestionSecret={data.dataConnection.hasIngestionSecret}
          hasWebPixel={data.dataConnection.hasWebPixel}
          webPixelHasIngestionKey={data.dataConnection.webPixelHasIngestionKey}
          shopDomain={shopDomain}
        />
      )}
      {backendUrlInfo?.placeholderDetected && (
        <Banner tone="critical" title={`⚠️ ${t("dashboard.backendUrl.errorTitle")}`}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>{t("dashboard.backendUrl.detected")}</strong>
            </Text>
            <Text as="p" variant="bodySm">
              {t("dashboard.backendUrl.description")}
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("dashboard.backendUrl.fixSteps")}
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.backendUrl.step1")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.backendUrl.step2")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.backendUrl.step3")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.backendUrl.step4")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.backendUrl.step5")}
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      )}
      {showWelcomeBanner && (
        <Banner
          title={t("dashboard.welcomeBanner")}
          onDismiss={onDismissWelcomeBanner}
        >
          <Text as="p" variant="bodySm">
            {t("dashboard.welcomeBannerDesc")}
          </Text>
        </Banner>
      )}
      {showScanProgress && (
        <PostInstallScanProgress
          shopId={data.shopDomain}
          scanStartedAt={scanStartedAt}
          onComplete={onScanComplete}
        />
      )}
      {data.showOnboarding && data.latestScan && (
        <UpgradeHealthCheck
          typOspPagesEnabled={data.typOspPagesEnabled || false}
          riskScore={data.riskScore || 0}
          estimatedMigrationTimeMinutes={data.estimatedMigrationTimeMinutes || 0}
          scriptTagsCount={data.scriptTagsCount || 0}
          identifiedPlatforms={data.latestScan.identifiedPlatforms || []}
          onStartAudit={() => window.location.href = "/app/scan"}
          onViewDashboard={() => window.location.href = "/app"}
        />
      )}
      <PageIntroCard
        title={introConfig.title}
        description={introConfig.description}
        items={introConfig.items}
        primaryAction={introConfig.primaryAction}
        secondaryAction={introConfig.secondaryAction}
      />
      {data.latestScan && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("dashboard.quickStart")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.quickStartDesc")}
                </Text>
              </BlockStack>
              <Button
                url={
                  data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                    ? "/app/scan"
                    : "/app/scan?tab=2"
                }
                variant="primary"
                size="large"
                icon={ArrowRightIcon}
              >
                {data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
                  ? t("dashboard.overview.startFreeScan")
                  : t("dashboard.overview.viewFullReport")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
      {data.latestScan && (
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      🎯 {t("dashboard.pixelMigrationTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.pixelMigrationDesc")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>{t("dashboard.pixelMigrationTech")}</strong>
                    </Text>
                    <Badge tone="info">Migration $49/mo</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? t("dashboard.startMigration") : t("dashboard.upgradeToMigration")}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      📦 {t("dashboard.thankYouOrderTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.thankYouOrderDesc")}
                    </Text>
                    <Badge tone="info">Migration $49/mo</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? t("dashboard.configureModules") : t("dashboard.upgradeToMigration")}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      📄 {t("dashboard.verificationReportTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.verificationReportDesc")}
                    </Text>
                    <Badge tone="warning">Growth $79/mo or Agency $199/mo</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "growth") ? "/app/verification" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "growth") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "growth") ? t("dashboard.generateReport") : t("dashboard.upgradeToGoLive")}
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      )}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("dashboard.reportCenter")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.reportCenterDesc")}
              </Text>
            </BlockStack>
            <Button url="/app/reports" size="slim" variant="primary">
              {t("dashboard.enterReportCenter")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
