import { BlockStack, Card, Text, InlineStack, Button, Icon, Layout, Banner, List, Badge } from "@shopify/polaris";
import { ArrowRightIcon, LockIcon } from "~/components/icons";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { DataConnectionBanner } from "./DataConnectionBanner";
import { UpgradeHealthCheck } from "~/components/onboarding/UpgradeHealthCheck";
import { PostInstallScanProgress } from "~/components/onboarding/PostInstallScanProgress";
import { isPlanAtLeast } from "~/utils/plans";
import type { DashboardData } from "~/types/dashboard";
import { useTranslation, Trans } from "react-i18next";
import { useNavigate } from "@remix-run/react";

interface DashboardOverviewProps {
  data: DashboardData;
  showWelcomeBanner: boolean;
  showScanProgress: boolean;
  scanStartedAt: Date;
  onDismissWelcomeBanner: () => void;
  onScanComplete: () => void;
  backendUrlInfo?: { placeholderDetected?: boolean };
}

export function DashboardOverview({
  data,
  showWelcomeBanner,
  showScanProgress,
  scanStartedAt,
  onDismissWelcomeBanner,
  onScanComplete,
  backendUrlInfo,
}: DashboardOverviewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const introConfig = {
    title: t("dashboard.title"),
    description: t("dashboard.intro.description"),
    items: [
      t("dashboard.intro.items.0"),
      t("dashboard.intro.items.1"),
      t("dashboard.intro.items.2"),
      t("dashboard.intro.items.3"),
    ],
    primaryAction: data.migrationProgress?.currentStage === "audit" || !data.migrationProgress || !data.latestScan
      ? { content: t("dashboard.intro.startScan"), url: "/app/scan" }
      : { content: t("dashboard.intro.viewReport"), url: "/app/scan?tab=2" },
    secondaryAction: { content: t("dashboard.intro.reportCenter"), url: "/app/reports" },
  };

  const connectionIssues = [];
  if (data.dataConnection) {
    if (!data.dataConnection.hasIngestionSecret) connectionIssues.push("Ingestion Key Not Configured");
    if (!data.dataConnection.hasWebPixel) connectionIssues.push("Web Pixel Not Installed");
    if (!data.dataConnection.webPixelHasIngestionKey) connectionIssues.push("Web Pixel Missing ingestion_key");
  }

  return (
    <BlockStack gap="500">
      {data.dataConnection && (
        <DataConnectionBanner
          issues={connectionIssues}
        />
      )}
      {backendUrlInfo?.placeholderDetected && (
        <Banner tone="critical" title={t("dashboard.errors.backendUrlMissing.title")}>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              <strong>{t("dashboard.errors.backendUrlMissing.subtitle")}</strong>
            </Text>
            <Text as="p" variant="bodySm">
              {t("dashboard.errors.backendUrlMissing.description")}
            </Text>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {t("dashboard.errors.backendUrlMissing.fixStepsTitle")}
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  <Trans i18nKey="dashboard.errors.backendUrlMissing.step1" components={{ code: <code /> }} />
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <Trans i18nKey="dashboard.errors.backendUrlMissing.step2" components={{ code: <code /> }} />
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.errors.backendUrlMissing.step3")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  {t("dashboard.errors.backendUrlMissing.step4")}
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  <Trans i18nKey="dashboard.errors.backendUrlMissing.step5" components={{ code: <code /> }} />
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      )}
      {showWelcomeBanner && (
        <Banner
          title={t("dashboard.welcomeBanner.title")}
          onDismiss={onDismissWelcomeBanner}
        >
          <Text as="p" variant="bodySm">
            {t("dashboard.welcomeBanner.content")}
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
          onStartAudit={() => navigate("/app/scan")}
          onViewDashboard={() => navigate("/app")}
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
                  {t("dashboard.quickStart.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.quickStart.description")}
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
                  ? t("dashboard.quickStart.startScan")
                  : t("dashboard.quickStart.viewReport")}
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
                      {t("dashboard.cards.migration.title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.cards.migration.description")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>{t("dashboard.cards.migration.technicalNoteTitle")}</strong>
                      {t("dashboard.cards.migration.technicalNoteContent")}
                    </Text>
                    <Badge tone="info">{t("dashboard.cards.migration.badge")}</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? t("dashboard.cards.migration.cta.start") : t("dashboard.cards.migration.cta.upgrade")}
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
                      {t("dashboard.cards.selfCheck.title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.cards.selfCheck.description")}
                    </Text>
                    <Badge tone="info">{t("dashboard.cards.migration.badge")}</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "starter") ? "/app/migrate" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "starter") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "starter") ? t("dashboard.cards.selfCheck.cta.configure") : t("dashboard.cards.migration.cta.upgrade")}
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
                      {t("dashboard.cards.report.title")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("dashboard.cards.report.description")}
                    </Text>
                    <Badge tone="warning">{t("dashboard.cards.report.badge")}</Badge>
                  </BlockStack>
                  <Icon source={LockIcon} />
                </InlineStack>
                <Button
                  url={isPlanAtLeast(data.planId || "free", "growth") ? "/app/verification" : "/app/billing"}
                  variant={isPlanAtLeast(data.planId || "free", "growth") ? "primary" : "secondary"}
                  fullWidth
                >
                  {isPlanAtLeast(data.planId || "free", "growth") ? t("dashboard.cards.report.cta.generate") : t("dashboard.cards.report.cta.upgrade")}
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
                {t("dashboard.reportCenter.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.reportCenter.description")}
              </Text>
            </BlockStack>
            <Button url="/app/reports" size="slim" variant="primary">
              {t("dashboard.reportCenter.cta")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
