import { Suspense, lazy } from "react";
import { Box, BlockStack, Card, DataTable, Text } from "@shopify/polaris";
import { StatusBadge } from "./VerificationBadges";
import { EnhancedEmptyState, CardSkeleton } from "~/components/ui";
import { useTranslation } from "react-i18next";

const ReportComparison = lazy(() =>
  import("./ReportComparison").then((m) => ({ default: m.ReportComparison }))
);

export interface VerificationHistoryRun {
  runId: string;
  runName?: string;
  runType: "quick" | "full" | "custom";
  status: string;
  passedTests: number;
  failedTests: number;
  missingParamTests: number;
  completedAt?: string | null;
}

export interface VerificationHistoryPanelProps {
  history: VerificationHistoryRun[];
  onRunVerification: () => void;
  shop: { id: string } | null;
}

export function VerificationHistoryPanel({
  history,
  onRunVerification,
  shop,
}: VerificationHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  return (
    <Box padding="400">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("verificationHistory.title")}
            </Text>
            {history.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
                headings={[
                  t("verificationHistory.colTime"),
                  t("verificationHistory.colType"),
                  t("verificationHistory.colStatus"),
                  t("verificationHistory.colPassed"),
                  t("verificationHistory.colFailed"),
                  t("verificationHistory.colMissingParams"),
                ]}
                rows={history.map((run) => [
                  run.completedAt
                    ? new Date(run.completedAt).toLocaleString(i18n.language === "zh" ? "zh-CN" : "en-US")
                    : "-",
                  run.runType === "full" ? t("verificationHistory.typeFull") : t("verificationHistory.typeQuick"),
                  <StatusBadge key={run.runId} status={run.status} />,
                  run.passedTests,
                  run.failedTests,
                  run.missingParamTests,
                ])}
              />
            ) : (
              <EnhancedEmptyState
                icon="📋"
                title={t("verificationHistory.emptyTitle")}
                description={t("verificationHistory.emptyDescription")}
                primaryAction={{
                  content: t("verificationHistory.runAction"),
                  onAction: onRunVerification,
                }}
              />
            )}
          </BlockStack>
        </Card>
        {history.length >= 2 && shop && (
          <Suspense fallback={<CardSkeleton lines={3} />}>
            <ReportComparison
              shopId={shop.id}
              availableRuns={history.map((run) => ({
                runId: run.runId,
                runName: run.runName || t(run.runType === "full" ? "verificationHistory.runNameFull" : "verificationHistory.runNameQuick"),
                completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
              }))}
            />
          </Suspense>
        )}
      </BlockStack>
    </Box>
  );
}
