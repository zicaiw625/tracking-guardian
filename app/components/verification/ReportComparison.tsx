import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  Button,
  Select,
  Divider,
  DataTable,
  Banner,
} from "@shopify/polaris";
import { RefreshIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { useLocale } from "~/context/LocaleContext";
import type { VerificationReportData } from "~/services/verification-report.server";

interface ReportComparisonProps {
  shopId: string;
  availableRuns: Array<{ runId: string; runName: string; completedAt?: Date }>;
}

export function ReportComparison({ shopId: _shopId, availableRuns }: ReportComparisonProps) {
  const { locale, t } = useLocale();
  const { showError } = useToastContext();
  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  const [run1Id, setRun1Id] = useState<string>("");
  const [run2Id, setRun2Id] = useState<string>("");
  const [report1, setReport1] = useState<VerificationReportData | null>(null);
  const [report2, setReport2] = useState<VerificationReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const handleLoadReport = useCallback(
    async (runId: string, setReport: (report: VerificationReportData) => void) => {
      try {
        const response = await fetch(`/api/reports?type=verification&runId=${runId}&format=json`);
        if (!response.ok) {
          throw new Error(t("verification.reportComparisonLoadFailed"));
        }
        const data = await response.json();
        setReport(data);
      } catch (error) {
        showError(
          `${t("verification.reportComparisonLoadFailed")}: ${
            error instanceof Error ? error.message : t("verification.reportComparisonUnknownError")
          }`
        );
      }
    },
    [showError, t]
  );
  const handleCompare = useCallback(async () => {
    if (!run1Id || !run2Id) {
      showError(t("verification.reportComparisonSelectTwo"));
      return;
    }
    if (run1Id === run2Id) {
      showError(t("verification.reportComparisonSelectDifferent"));
      return;
    }
    setIsLoading(true);
    try {
      await Promise.all([
        handleLoadReport(run1Id, setReport1),
        handleLoadReport(run2Id, setReport2),
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [run1Id, run2Id, handleLoadReport, showError, t]);
  const comparisonData = report1 && report2 ? generateComparisonData(report1, report2, t) : null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("verification.reportComparisonTitle")}
        </Text>
        <BlockStack gap="300">
          <Select
            label={t("verification.reportComparisonReport1")}
            options={[
              { label: t("verification.reportComparisonSelectPlaceholder"), value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString(dateLocale) : t("verification.reportComparisonNotCompleted")})`,
                value: run.runId,
              })),
            ]}
            value={run1Id}
            onChange={setRun1Id}
          />
          <Select
            label={t("verification.reportComparisonReport2")}
            options={[
              { label: t("verification.reportComparisonSelectPlaceholder"), value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString(dateLocale) : t("verification.reportComparisonNotCompleted")})`,
                value: run.runId,
              })),
            ]}
            value={run2Id}
            onChange={setRun2Id}
          />
          <Button
            icon={RefreshIcon}
            onClick={handleCompare}
            loading={isLoading}
            disabled={!run1Id || !run2Id || run1Id === run2Id}
          >
            {t("verification.reportComparisonStart")}
          </Button>
        </BlockStack>
        {comparisonData && (
          <>
            <Divider />
            <BlockStack gap="400">
              <Text as="h4" variant="headingMd">
                {t("verification.reportComparisonResults")}
              </Text>
              <Card>
                <BlockStack gap="300">
                  <Text as="h5" variant="headingSm">
                    {t("verification.reportComparisonKeyMetrics")}
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={[
                      t("verification.reportComparisonMetric"),
                      t("verification.reportComparisonReport1"),
                      t("verification.reportComparisonReport2"),
                      t("verification.reportComparisonChange"),
                    ]}
                    rows={comparisonData.metrics.map((m) => [
                      m.label,
                      m.value1,
                      m.value2,
                      `${m.change > 0 ? "+" : ""}${m.change.toFixed(1)}%`,
                    ])}
                  />
                </BlockStack>
              </Card>
              {comparisonData.platforms.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h5" variant="headingSm">
                      {t("verification.reportComparisonPlatforms")}
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={[
                        t("verification.reportComparisonPlatform"),
                        t("verification.reportComparisonReport1PassRate"),
                        t("verification.reportComparisonReport2PassRate"),
                        t("verification.reportComparisonChange"),
                      ]}
                      rows={comparisonData.platforms.map((p) => [
                        p.platform,
                        `${p.passRate1}%`,
                        `${p.passRate2}%`,
                        `${p.change > 0 ? "+" : ""}${p.change.toFixed(1)}%`,
                      ])}
                    />
                  </BlockStack>
                </Card>
              )}
              {comparisonData.improvements.length > 0 && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {t("verification.reportComparisonSuggestions")}
                    </Text>
                    <ul>
                      {comparisonData.improvements.map((suggestion, i) => (
                        <li key={i}>
                          <Text as="span" variant="bodySm">
                            {suggestion}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </BlockStack>
                </Banner>
              )}
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}

interface ComparisonData {
  metrics: Array<{
    label: string;
    value1: string;
    value2: string;
    change: number;
  }>;
  platforms: Array<{
    platform: string;
    passRate1: number;
    passRate2: number;
    change: number;
  }>;
  improvements: string[];
}

function generateComparisonData(
  report1: VerificationReportData,
  report2: VerificationReportData,
  t: (key: string, params?: Record<string, string | number>) => string
): ComparisonData {
  const successRate1 = report1.summary.totalTests > 0 ? (report1.summary.passedTests / report1.summary.totalTests) * 100 : 0;
  const successRate2 = report2.summary.totalTests > 0 ? (report2.summary.passedTests / report2.summary.totalTests) * 100 : 0;
  const metrics: ComparisonData["metrics"] = [
    {
      label: t("verification.reportComparisonMetricPassRate"),
      value1: `${Math.round(successRate1)}%`,
      value2: `${Math.round(successRate2)}%`,
      change: successRate2 - successRate1,
    },
    {
      label: t("verification.reportComparisonMetricParamCompleteness"),
      value1: t("verification.reportComparisonMetricUnavailable"),
      value2: t("verification.reportComparisonMetricUnavailable"),
      change: 0,
    },
    {
      label: t("verification.reportComparisonMetricValueAccuracy"),
      value1: `${report1.summary.valueAccuracy}%`,
      value2: `${report2.summary.valueAccuracy}%`,
      change: report2.summary.valueAccuracy - report1.summary.valueAccuracy,
    },
    {
      label: t("verification.reportComparisonMetricTotalEvents"),
      value1: report1.summary.totalTests.toString(),
      value2: report2.summary.totalTests.toString(),
      change: report1.summary.totalTests > 0 ? ((report2.summary.totalTests - report1.summary.totalTests) / report1.summary.totalTests) * 100 : 0,
    },
  ];
  const platformStats1 = calculatePlatformStats(report1);
  const platformStats2 = calculatePlatformStats(report2);
  const allPlatforms = new Set([
    ...Object.keys(platformStats1),
    ...Object.keys(platformStats2),
  ]);
  const platforms: ComparisonData["platforms"] = Array.from(allPlatforms).map((platform) => {
    const stats1 = platformStats1[platform] || { passed: 0, total: 0 };
    const stats2 = platformStats2[platform] || { passed: 0, total: 0 };
    const passRate1 = stats1.total > 0 ? (stats1.passed / stats1.total) * 100 : 0;
    const passRate2 = stats2.total > 0 ? (stats2.passed / stats2.total) * 100 : 0;
    return {
      platform,
      passRate1: Math.round(passRate1),
      passRate2: Math.round(passRate2),
      change: passRate2 - passRate1,
    };
  });
  const improvements: string[] = [];
  const passRate1 = successRate1;
  const passRate2 = successRate2;
  if (passRate2 < passRate1) {
    improvements.push(t("verification.reportComparisonSuggestionPassRateDrop"));
  }
  if (report2.summary.valueAccuracy < report1.summary.valueAccuracy) {
    improvements.push(t("verification.reportComparisonSuggestionValueAccuracyDrop"));
  }
  if (report2.summary.failedTests > report1.summary.failedTests) {
    improvements.push(
      t("verification.reportComparisonSuggestionFailedTests", {
        from: report1.summary.failedTests,
        to: report2.summary.failedTests,
      })
    );
  }
  return { metrics, platforms, improvements };
}

function calculatePlatformStats(report: VerificationReportData): Record<
  string,
  { passed: number; total: number }
> {
  const stats: Record<string, { passed: number; total: number }> = {};
  for (const [platform, result] of Object.entries(report.platformResults)) {
    if (!stats[platform]) {
      stats[platform] = { passed: 0, total: 0 };
    }
    stats[platform].total += result.sent + result.failed;
    stats[platform].passed += result.sent;
  }
  return stats;
}
