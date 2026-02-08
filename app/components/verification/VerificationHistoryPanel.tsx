import { Suspense, lazy } from "react";
import { Box, BlockStack, Card, DataTable, Text } from "@shopify/polaris";
import { StatusBadge } from "./VerificationBadges";
import { EnhancedEmptyState, CardSkeleton } from "~/components/ui";

const ReportComparison = lazy(() => import("./ReportComparison").then((m) => ({ default: m.ReportComparison })));

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

export function VerificationHistoryPanel({ history, onRunVerification, shop }: VerificationHistoryPanelProps) {
  return (
    <Box padding="400">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              验收历史
            </Text>
            {history.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric"]}
                headings={["时间", "类型", "状态", "通过", "失败", "参数缺失"]}
                rows={history.map((run) => [
                  run.completedAt ? new Date(run.completedAt).toLocaleString("zh-CN") : "-",
                  run.runType === "full" ? "完整" : "快速",
                  <StatusBadge key={run.runId} status={run.status} />,
                  run.passedTests,
                  run.failedTests,
                  run.missingParamTests,
                ])}
              />
            ) : (
              <EnhancedEmptyState
                icon="📋"
                title="暂无验收历史记录"
                description="运行验收测试后，历史记录将显示在这里。"
                primaryAction={{
                  content: "运行验收",
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
                runName: run.runName || `${run.runType === "full" ? "完整" : "快速"}验收`,
                completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
              }))}
            />
          </Suspense>
        )}
      </BlockStack>
    </Box>
  );
}
