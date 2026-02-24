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
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const columns = t("verificationHistory.columns", { returnObjects: true }) as string[];

  const getRunTypeLabel = (runType: VerificationHistoryRun["runType"]) => {
    if (runType === "full") return t("verificationHistory.type.full");
    if (runType === "quick") return t("verificationHistory.type.quick");
    return runType;
  };

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
                  columns[0] ?? "",
                  columns[1] ?? "",
                  columns[2] ?? "",
                  columns[3] ?? "",
                  columns[4] ?? "",
                  columns[5] ?? "",
                ]}
                rows={history.map((run) => [
                  run.completedAt
                    ? new Date(run.completedAt).toLocaleString(locale)
                    : "-",
                  getRunTypeLabel(run.runType),
                  <StatusBadge key={run.runId} status={run.status} />,
                  run.passedTests,
                  run.failedTests,
                  run.missingParamTests,
                ])}
              />
            ) : (
              <EnhancedEmptyState
                icon="📋"
                title={t("verificationHistory.empty.title")}
                description={t("verificationHistory.empty.description")}
                primaryAction={{
                  content: t("verificationHistory.empty.action"),
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
                runName:
                  run.runName ||
                  t("verificationHistory.runLabel", {
                    type: getRunTypeLabel(run.runType),
                  }),
                completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
              }))}
            />
          </Suspense>
        )}
      </BlockStack>
    </Box>
  );
}
