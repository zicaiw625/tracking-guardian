
import { Card, BlockStack, Text, Box } from "@shopify/polaris";
import { useMemo } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
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
      .slice(0, 8); // 只显示前 8 个平台

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
          label: (context: any) => `${context.parsed.y || context.parsed} 个资产`,
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
          label: (context: any) => {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
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
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          风险分布分析
        </Text>

        {totalAssets === 0 ? (
          <Box padding="400">
            <Text as="p" tone="subdued" alignment="center">
              暂无资产数据
            </Text>
          </Box>
        ) : (
          <BlockStack gap="500">
            {/* 风险等级分布 */}
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                按风险等级
              </Text>
              <Box minHeight="200px">
                <Doughnut data={riskLevelData} options={doughnutOptions} />
              </Box>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  总计: {totalAssets} 个资产
                </Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">
                    <strong>高风险:</strong> {distribution.byRiskLevel.high} 个
                    ({totalAssets > 0 ? ((distribution.byRiskLevel.high / totalAssets) * 100).toFixed(1) : 0}%)
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>中风险:</strong> {distribution.byRiskLevel.medium} 个
                    ({totalAssets > 0 ? ((distribution.byRiskLevel.medium / totalAssets) * 100).toFixed(1) : 0}%)
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>低风险:</strong> {distribution.byRiskLevel.low} 个
                    ({totalAssets > 0 ? ((distribution.byRiskLevel.low / totalAssets) * 100).toFixed(1) : 0}%)
                  </Text>
                </BlockStack>
              </BlockStack>
            </BlockStack>

            {/* 类别分布 */}
            {Object.values(distribution.byCategory).some(count => count > 0) && (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  按资产类别
                </Text>
                <Box minHeight="200px">
                  <Bar data={categoryData} options={chartOptions} />
                </Box>
              </BlockStack>
            )}

            {/* 平台分布 */}
            {platformData && (
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  按平台分布
                </Text>
                <Box minHeight="200px">
                  <Bar data={platformData} options={chartOptions} />
                </Box>
              </BlockStack>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

