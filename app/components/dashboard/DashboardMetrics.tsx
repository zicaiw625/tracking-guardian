import { memo, Suspense, lazy } from "react";
import { Card, BlockStack, Text, Layout, DataTable } from "@shopify/polaris";
import { CardSkeleton } from "~/components/ui";
import { LatestScanCard } from "./LatestScanCard";
import { HealthScoreCard } from "./HealthScoreCard";
import { QuickStatsCard } from "./QuickStatsCard";
import { MigrationChecklistPreviewCard } from "./MigrationChecklistPreviewCard";
import type { DashboardData } from "~/types/dashboard";
import { useTranslation } from "react-i18next";

const DependencyGraphPreview = lazy(() => import("./DependencyGraphPreview").then(module => ({ default: module.DependencyGraphPreview })));

interface DashboardMetricsProps {
  data: DashboardData;
  latestScan: {
    status: string;
    riskScore: number;
    createdAt: Date | string;
    identifiedPlatforms: string[];
  } | null;
}

export const DashboardMetrics = memo(function DashboardMetrics({
  data,
  latestScan,
}: DashboardMetricsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Layout>
        <Layout.Section variant="oneThird">
          <HealthScoreCard score={data.healthScore} status={data.healthStatus} />
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <QuickStatsCard
            configuredPlatforms={data.configuredPlatforms}
            weeklyConversions={data.weeklyConversions}
            plan={data.plan}
            planLabel={data.planLabel}
            planTagline={data.planTagline}
            planFeatures={data.planFeatures}
          />
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <LatestScanCard latestScan={latestScan} />
        </Layout.Section>
      </Layout>
      {data.migrationChecklist && (
        <Layout>
          <Layout.Section>
            <MigrationChecklistPreviewCard
              checklist={data.migrationChecklist}
              estimatedTimeMinutes={data.estimatedMigrationTimeMinutes}
            />
          </Layout.Section>
        </Layout>
      )}
      {(data.dependencyGraph || data.riskDistribution) && (
        <Layout>
          {data.dependencyGraph && (
            <Layout.Section variant="oneHalf">
              <Suspense fallback={<CardSkeleton />}>
                <DependencyGraphPreview dependencyGraph={data.dependencyGraph} />
              </Suspense>
            </Layout.Section>
          )}
          {data.riskDistribution && (
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">{t("dashboard.metrics.riskDistribution.title")}</Text>
                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={[t("dashboard.metrics.riskDistribution.riskLevel"), t("dashboard.metrics.riskDistribution.count")]}
                    rows={Object.entries(data.riskDistribution).map(([level, count]) => [
                      level,
                      String(count),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      )}
    </>
  );
});
