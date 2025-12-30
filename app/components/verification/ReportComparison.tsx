
import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Badge,
  Box,
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

export function ReportComparison({ shopId, availableRuns }: ReportComparisonProps) {
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
          throw new Error("加载报告失败");
        }
        const data = await response.json();
        setReport(data);
      } catch (error) {
        showError("加载报告失败：" + (error instanceof Error ? error.message : "未知错误"));
      }
    },
    [showError]
  );

  const handleCompare = useCallback(async () => {
    if (!run1Id || !run2Id) {
      showError("请选择两个报告进行对比");
      return;
    }
    if (run1Id === run2Id) {
      showError("请选择两个不同的报告进行对比");
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
  }, [run1Id, run2Id, handleLoadReport, showError]);

  const comparisonData = report1 && report2 ? generateComparisonData(report1, report2) : null;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          报告对比
        </Text>

        <BlockStack gap="300">
          <Select
            label="报告 1"
            options={[
              { label: "选择报告...", value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString("zh-CN") : "未完成"})`,
                value: run.runId,
              })),
            ]}
            value={run1Id}
            onChange={setRun1Id}
          />
          <Select
            label="报告 2"
            options={[
              { label: "选择报告...", value: "" },
              ...availableRuns.map((run) => ({
                label: `${run.runName} (${run.completedAt ? new Date(run.completedAt).toLocaleDateString("zh-CN") : "未完成"})`,
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
            开始对比
          </Button>
        </BlockStack>

        {comparisonData && (
          <>
            <Divider />
            <BlockStack gap="400">
              <Text as="h4" variant="headingMd">
                对比结果
              </Text>

              {/* 关键指标对比 */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h5" variant="headingSm">
                    关键指标对比
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["指标", "报告 1", "报告 2", "变化"]}
                    rows={comparisonData.metrics.map((m) => [
                      m.label,
                      m.value1,
                      m.value2,
                      <Badge
                        tone={
                          m.change > 0
                            ? "success"
                            : m.change < 0
                            ? "critical"
                            : "subdued"
                        }
                      >
                        {m.change > 0 ? "+" : ""}
                        {m.change.toFixed(1)}%
                      </Badge>,
                    ])}
                  />
                </BlockStack>
              </Card>

              {/* 平台对比 */}
              {comparisonData.platforms.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h5" variant="headingSm">
                      平台对比
                    </Text>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["平台", "报告 1 通过率", "报告 2 通过率", "变化"]}
                      rows={comparisonData.platforms.map((p) => [
                        p.platform,
                        `${p.passRate1}%`,
                        `${p.passRate2}%`,
                        <Badge
                          tone={
                            p.change > 0
                              ? "success"
                              : p.change < 0
                              ? "critical"
                              : "subdued"
                          }
                        >
                          {p.change > 0 ? "+" : ""}
                          {p.change.toFixed(1)}%
                        </Badge>,
                      ])}
                    />
                  </BlockStack>
                </Card>
              )}

              {/* 改进建议 */}
              {comparisonData.improvements.length > 0 && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      改进建议
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
  report2: VerificationReportData
): ComparisonData {
  const metrics: ComparisonData["metrics"] = [
    {
      label: "通过率",
      value1: `${report1.passRate}%`,
      value2: `${report2.passRate}%`,
      change: report2.passRate - report1.passRate,
    },
    {
      label: "参数完整率",
      value1: `${report1.parameterCompleteness}%`,
      value2: `${report2.parameterCompleteness}%`,
      change: report2.parameterCompleteness - report1.parameterCompleteness,
    },
    {
      label: "金额准确率",
      value1: `${report1.valueAccuracy}%`,
      value2: `${report2.valueAccuracy}%`,
      change: report2.valueAccuracy - report1.valueAccuracy,
    },
    {
      label: "总测试数",
      value1: report1.totalTests.toString(),
      value2: report2.totalTests.toString(),
      change: ((report2.totalTests - report1.totalTests) / report1.totalTests) * 100,
    },
  ];

  // 计算平台级别的通过率
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

  // 生成改进建议
  const improvements: string[] = [];
  if (report2.passRate < report1.passRate) {
    improvements.push("通过率有所下降，建议检查最近的配置更改");
  }
  if (report2.parameterCompleteness < report1.parameterCompleteness) {
    improvements.push("参数完整率下降，建议检查事件映射配置");
  }
  if (report2.valueAccuracy < report1.valueAccuracy) {
    improvements.push("金额准确率下降，建议检查订单数据处理逻辑");
  }
  if (report2.failedTests > report1.failedTests) {
    improvements.push(`失败测试数从 ${report1.failedTests} 增加到 ${report2.failedTests}，需要关注错误日志`);
  }

  return { metrics, platforms, improvements };
}

function calculatePlatformStats(report: VerificationReportData): Record<
  string,
  { passed: number; total: number }
> {
  const stats: Record<string, { passed: number; total: number }> = {};

  for (const result of report.results) {
    if (!stats[result.platform]) {
      stats[result.platform] = { passed: 0, total: 0 };
    }
    stats[result.platform].total++;
    if (result.status === "success") {
      stats[result.platform].passed++;
    }
  }

  return stats;
}

