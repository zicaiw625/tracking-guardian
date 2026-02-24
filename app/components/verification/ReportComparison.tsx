import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import type { VerificationReportData } from "~/services/verification-report.server";

interface ReportComparisonProps {
  shopId: string;
  availableRuns: Array<{ runId: string; runName: string; completedAt?: Date }>;
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

export function ReportComparison({ shopId: _shopId, availableRuns }: ReportComparisonProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const { showError } = useToastContext();
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
          throw new Error(t("components.reportComparison.loadFailed"));
        }
        const data = await response.json();
        setReport(data);
      } catch (error) {
        showError(t("components.reportComparison.loadFailed") + (error instanceof Error ? error.message : t("components.reportComparison.unknownError")));
      }
    },
    [showError, t]
  );
  const handleCompare = useCallback(async () => {
    if (!run1Id || !run2Id) {
      showError(t("components.reportComparison.selectTwo"));
      return;
    }
    if (run1Id === run2Id) {
      showError(t("components.reportComparison.selectDifferent"));
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

  const generateComparisonData = (
    report1: VerificationReportData,
    report2: VerificationReportData
  ): ComparisonData => {
    const successRate1 = report1.summary.totalTests > 0 ? (report1.summary.passedTests / report1.summary.totalTests) * 100 : 0;
    const successRate2 = report2.summary.totalTests > 0 ? (report2.summary.passedTests / report2.summary.totalTests) * 100 : 0;
    const metrics: ComparisonData["metrics"] = [
      {
        label: t("components.reportComparison.passRate"),
        value1: `${Math.round(successRate1)}%`,
        value2: `${Math.round(successRate2)}%`,
        change: successRate2 - successRate1,
      },
      {
        label: t("components.reportComparison.completeness"),
        value1: "N/A",
        value2: "N/A",
        change: 0,
      },
      {
        label: t("components.reportComparison.accuracy"),
        value1: `${report1.summary.valueAccuracy}%`,
        value2: `${report2.summary.valueAccuracy}%`,
        change: report2.summary.valueAccuracy - report1.summary.valueAccuracy,
      },
      {
        label: t("components.reportComparison.totalEvents"),
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
      improvements.push(t("components.reportComparison.passRateDrop"));
    }
    if (report2.summary.valueAccuracy < report1.summary.valueAccuracy) {
      improvements.push(t("components.reportComparison.accuracyDrop"));
    }
    if (report2.summary.failedTests > report1.summary.failedTests) {
      improvements.push(t("components.reportComparison.failedIncrease", { v1: report1.summary.failedTests, v2: report2.summary.failedTests }));
    }
    return { metrics, platforms, improvements };
  }

  const comparisonData = report1 && report2 ? generateComparisonData(report1, report2) : null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("components.reportComparison.title")}
        </Text>
        <BlockStack gap="300">
          <Select
            label={t("components.reportComparison.report1")}
            options={[
              { label: t("components.reportComparison.selectReport"), value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString(locale) : t("components.reportComparison.incomplete")})`,
                value: run.runId,
              })),
            ]}
            value={run1Id}
            onChange={setRun1Id}
          />
          <Select
            label={t("components.reportComparison.report2")}
            options={[
              { label: t("components.reportComparison.selectReport"), value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString(locale) : t("components.reportComparison.incomplete")})`,
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
            {t("components.reportComparison.startCompare")}
          </Button>
        </BlockStack>
        {comparisonData && (
          <>
            <Divider />
            <BlockStack gap="400">
              <Text as="h4" variant="headingMd">
                {t("components.reportComparison.resultTitle")}
              </Text>
              <Card>
                <BlockStack gap="300">
                  <Text as="h5" variant="headingSm">
                    {t("components.reportComparison.metricsTitle")}
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={[
                      t("components.reportComparison.metric"), 
                      t("components.reportComparison.report1Val"), 
                      t("components.reportComparison.report2Val"), 
                      t("components.reportComparison.change")
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
                      {t("components.reportComparison.platformTitle")}
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={[
                        t("components.reportComparison.platform"), 
                        t("components.reportComparison.passRate1"), 
                        t("components.reportComparison.passRate2"), 
                        t("components.reportComparison.change")
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
                      {t("components.reportComparison.improvements")}
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
