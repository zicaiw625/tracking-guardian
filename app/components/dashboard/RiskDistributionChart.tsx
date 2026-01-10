import { Card, BlockStack, Text, Box, InlineStack, Badge } from "@shopify/polaris";
import { useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface RiskDistributionChartProps {
  distribution: {
    byRiskLevel: {
      high: number;
      medium: number;
      low: number;
    };
    byCategory: Record<string, number>;
    byPlatform: Record<string, number>;
  };
}

export function RiskDistributionChart({ distribution }: RiskDistributionChartProps) {
  const [viewMode] = useState<"risk" | "category" | "platform">("risk");
  const riskLevelData = useMemo(() => {
    return {
      labels: ["高风险", "中风险", "低风险"],
      datasets: [
        {
          label: "资产数量",
          data: [
            distribution.byRiskLevel.high,
            distribution.byRiskLevel.medium,
            distribution.byRiskLevel.low,
          ],
          backgroundColor: [
            "rgba(239, 68, 68, 0.8)",
            "rgba(251, 146, 60, 0.8)",
            "rgba(34, 197, 94, 0.8)",
          ],
          borderColor: [
            "rgb(239, 68, 68)",
            "rgb(251, 146, 60)",
            "rgb(34, 197, 94)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }, [distribution.byRiskLevel]);
  const categoryData = useMemo(() => {
    const categoryLabels: Record<string, string> = {
      pixel: "像素追踪",
      affiliate: "联盟营销",
      survey: "问卷调研",
      support: "客服支持",
      analytics: "分析工具",
      other: "其他",
    };
    const categories = Object.entries(distribution.byCategory)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a);
    return {
      labels: categories.map(([cat]) => categoryLabels[cat] || cat),
      datasets: [
        {
          label: "资产数量",
          data: categories.map(([_, count]) => count),
          backgroundColor: [
            "rgba(99, 102, 241, 0.8)",
            "rgba(34, 197, 94, 0.8)",
            "rgba(251, 146, 60, 0.8)",
            "rgba(168, 85, 247, 0.8)",
            "rgba(236, 72, 153, 0.8)",
            "rgba(107, 114, 128, 0.8)",
          ],
          borderColor: [
            "rgb(99, 102, 241)",
            "rgb(34, 197, 94)",
            "rgb(251, 146, 60)",
            "rgb(168, 85, 247)",
            "rgb(236, 72, 153)",
            "rgb(107, 114, 128)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }, [distribution.byCategory]);
  const platformData = useMemo(() => {
    const platforms = Object.entries(distribution.byPlatform)
      .filter(([_, count]) => count > 0)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 8);
    if (platforms.length === 0) {
      return null;
    }
    return {
      labels: platforms.map(([platform]) => platform),
      datasets: [
        {
          label: "资产数量",
          data: platforms.map(([_, count]) => count),
          backgroundColor: "rgba(99, 102, 241, 0.6)",
          borderColor: "rgb(99, 102, 241)",
          borderWidth: 1,
        },
      ],
    };
  }, [distribution.byPlatform]);
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"bar">) => `${context.parsed.y || context.parsed} 个资产`,
        },
      },
    },
  };
  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          boxWidth: 12,
          padding: 8,
          font: {
            size: 11,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: TooltipItem<"doughnut">) => {
            const total = (context.dataset.data as number[]).reduce((a: number, b: number) => a + b, 0);
            const percentage = ((context.parsed / total) * 100).toFixed(1);
            return `${context.label}: ${context.parsed} 个 (${percentage}%)`;
          },
        },
      },
    },
  };
  const totalAssets = distribution.byRiskLevel.high +
    distribution.byRiskLevel.medium +
    distribution.byRiskLevel.low;
  return (
    <Card>
      {totalAssets === 0 ? (
          <Box padding="400">
            <Text as="p" tone="subdued" alignment="center">
              暂无资产数据
            </Text>
          </Box>
        ) : (
          <BlockStack gap="400">
            {viewMode === "risk" && (
              <BlockStack gap="300">
                <Box minHeight="250px">
                  <Doughnut data={riskLevelData} options={doughnutOptions} />
                </Box>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodySm" tone="subdued">
                      总计: {totalAssets} 个资产
                    </Text>
                    <Badge tone="info">{`${String(totalAssets)} 项`}</Badge>
                  </InlineStack>
                  <BlockStack gap="100">
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">
                        <strong>高风险:</strong>
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone="critical">
                          {`${String(distribution.byRiskLevel.high)} 个`}
                        </Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ({totalAssets > 0 ? ((distribution.byRiskLevel.high / totalAssets) * 100).toFixed(1) : 0}%)
                        </Text>
                      </InlineStack>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">
                        <strong>中风险:</strong>
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone="warning">
                          {`${String(distribution.byRiskLevel.medium)} 个`}
                        </Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ({totalAssets > 0 ? ((distribution.byRiskLevel.medium / totalAssets) * 100).toFixed(1) : 0}%)
                        </Text>
                      </InlineStack>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">
                        <strong>低风险:</strong>
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone="success">
                          {`${String(distribution.byRiskLevel.low)} 个`}
                        </Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ({totalAssets > 0 ? ((distribution.byRiskLevel.low / totalAssets) * 100).toFixed(1) : 0}%)
                        </Text>
                      </InlineStack>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </BlockStack>
            )}
            {viewMode === "category" && Object.values(distribution.byCategory).some(count => count > 0) && (
              <BlockStack gap="300">
                <Box minHeight="250px">
                  <Bar data={categoryData} options={chartOptions} />
                </Box>
                <BlockStack gap="200">
                  {Object.entries(distribution.byCategory)
                    .filter(([_, count]) => count > 0)
                    .sort(([_, a], [__, b]) => b - a)
                    .map(([category, count]) => {
                      const categoryLabels: Record<string, string> = {
                        pixel: "像素追踪",
                        affiliate: "联盟营销",
                        survey: "问卷调研",
                        support: "客服支持",
                        analytics: "分析工具",
                        other: "其他",
                      };
                      return (
                        <InlineStack key={category} align="space-between">
                          <Text as="p" variant="bodySm">
                            {categoryLabels[category] || category}:
                          </Text>
                          <Badge>{`${String(count)} 个`}</Badge>
                        </InlineStack>
                      );
                    })}
                </BlockStack>
              </BlockStack>
            )}
            {viewMode === "platform" && platformData && (
              <BlockStack gap="300">
                <Box minHeight="250px">
                  <Bar data={platformData} options={chartOptions} />
                </Box>
                <BlockStack gap="200">
                  {Object.entries(distribution.byPlatform)
                    .filter(([_, count]) => count > 0)
                    .sort(([_, a], [__, b]) => b - a)
                    .slice(0, 8)
                    .map(([platform, count]) => (
                      <InlineStack key={platform} align="space-between">
                        <Text as="p" variant="bodySm">
                          {platform}:
                        </Text>
                        <Badge>{`${String(count)} 个`}</Badge>
                      </InlineStack>
                    ))}
                </BlockStack>
              </BlockStack>
            )}
          </BlockStack>
        )}
    </Card>
  );
}
