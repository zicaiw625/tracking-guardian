import { Suspense, lazy } from "react";
import { Box, BlockStack, Card, DataTable, Text } from "@shopify/polaris";
import { StatusBadge } from "./VerificationBadges";
import { EnhancedEmptyState, CardSkeleton } from "~/components/ui";
import { useLocale, useT } from "~/context/LocaleContext";

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
  const { locale } = useLocale();
  const t = useT();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  const runTypeLabel = (runType: VerificationHistoryRun["runType"]) => {
    if (runType === "full") return t("verification.runTypeFull");
    if (runType === "custom") return t("verification.runTypeCustom");
    return t("verification.runTypeQuick");
  };
  return (
    <Box padding="400">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("verification.historyTitle")}
            </Text>
            {history.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
                headings={[t("verification.historyTime"), t("verification.historyType"), t("verification.historyStatus"), t("verification.historyPassed"), t("verification.historyFailed"), t("verification.historyMissingParams")]}
                rows={history.map((run) => [
                  run.completedAt
                    ? new Date(run.completedAt).toLocaleString(dateLocale)
                    : "-",
                  runTypeLabel(run.runType),
                  <StatusBadge key={run.runId} status={run.status} />,
                  run.passedTests,
                  run.failedTests,
                  run.missingParamTests,
                ])}
              />
            ) : (
              <EnhancedEmptyState
                icon="📋"
                title={t("verification.historyEmptyTitle")}
                description={t("verification.historyEmptyDesc")}
                primaryAction={{
                  content: t("verification.runVerification"),
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
                runName: run.runName || `${runTypeLabel(run.runType)}`,
                completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
              }))}
            />
          </Suspense>
        )}
      </BlockStack>
    </Box>
  );
}
