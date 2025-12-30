
import { useMemo } from "react";
import { Card, Text, BlockStack, InlineStack, Badge, Box, Select } from "@shopify/polaris";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface AlertHistoryItem {
  id: string;
  alertType: string;
  severity: string;
  message: string;
  createdAt: Date | string;
  acknowledged: boolean;
}

interface AlertHistoryChartProps {
  alerts: AlertHistoryItem[];
  timeRange?: "7d" | "30d" | "90d";
  onTimeRangeChange?: (range: "7d" | "30d" | "90d") => void;
}

export function AlertHistoryChart({
  alerts,
  timeRange = "30d",
  onTimeRangeChange,
}: AlertHistoryChartProps) {
  const { trendData, statsData, severityDistribution } = useMemo(() => {
    const now = new Date();
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);

    const filteredAlerts = alerts.filter((alert) => {
      const alertDate = new Date(alert.createdAt);
      return alertDate >= startDate;
    });

    // 按日期分组
    const dailyCounts = new Map<string, {
      total: number;
      byType: Record<string, number>;
      bySeverity: Record<string, number>;
    }>();

    filteredAlerts.forEach((alert) => {
      const date = new Date(alert.createdAt).toISOString().split("T")[0];
      const existing = dailyCounts.get(date) || {
        total: 0,
        byType: {},
        bySeverity: {},
      };

      existing.total++;
      existing.byType[alert.alertType] = (existing.byType[alert.alertType] || 0) + 1;
      existing.bySeverity[alert.severity] = (existing.bySeverity[alert.severity] || 0) + 1;

      dailyCounts.set(date, existing);
    });

    // 生成日期序列
    const dateLabels: string[] = [];
    const totalCounts: number[] = [];
    const typeCounts: Record<string, number[]> = {};

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      dateLabels.push(`${date.getMonth() + 1}/${date.getDate()}`);

      const dayData = dailyCounts.get(dateStr) || { total: 0, byType: {}, bySeverity: {} };
      totalCounts.push(dayData.total);

      Object.keys(dayData.byType).forEach((type) => {
        if (!typeCounts[type]) {
          typeCounts[type] = [];
        }
        typeCounts[type].push(dayData.byType[type]);
      });
    }

    // 趋势数据
    const datasets = [
      {
        label: "总告警数",
        data: totalCounts,
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        tension: 0.4,
      },
    ];

    Object.entries(typeCounts).forEach(([type, counts], index) => {
      const colors = [
        "rgb(99, 102, 241)",
        "rgb(34, 197, 94)",
        "rgb(251, 146, 60)",
        "rgb(168, 85, 247)",
      ];
      datasets.push({
        label: getAlertTypeLabel(type),
        data: counts,
        borderColor: colors[index % colors.length],
        backgroundColor: `${colors[index % colors.length]}33`,
        tension: 0.4,
      });
    });

    const trendData = {
      labels: dateLabels,
      datasets,
    };

    // 统计数据
    const totalAlerts = filteredAlerts.length;
    const acknowledgedCount = filteredAlerts.filter((a) => a.acknowledged).length;
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    filteredAlerts.forEach((alert) => {
      byType[alert.alertType] = (byType[alert.alertType] || 0) + 1;
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
    });

    const statsData = {
      total: totalAlerts,
      acknowledged: acknowledgedCount,
      unacknowledged: totalAlerts - acknowledgedCount,
      byType,
      bySeverity,
    };

    // 严重程度分布
    const severityDistribution = {
      labels: Object.keys(bySeverity).map(getSeverityLabel),
      datasets: [
        {
          label: "告警数量",
          data: Object.values(bySeverity),
          backgroundColor: [
            "rgba(239, 68, 68, 0.8)",
            "rgba(251, 146, 60, 0.8)",
            "rgba(99, 102, 241, 0.8)",
            "rgba(34, 197, 94, 0.8)",
          ],
        },
      ],
    };

    return { trendData, statsData, severityDistribution };
  }, [alerts, timeRange]);

  const trendOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: `告警趋势（最近${timeRange === "7d" ? "7" : timeRange === "30d" ? "30" : "90"}天）`,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `${context.dataset.label}: ${context.parsed.y} 次`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
      },
    },
  };

  const barOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: "告警严重程度分布",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `数量: ${context.parsed.y} 次`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
      },
    },
  };

  if (alerts.length === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            告警历史统计
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            暂无告警记录
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">
              告警趋势
            </Text>
            {onTimeRangeChange && (
              <Select
                label=""
                labelHidden
                options={[
                  { label: "最近7天", value: "7d" },
                  { label: "最近30天", value: "30d" },
                  { label: "最近90天", value: "90d" },
                ]}
                value={timeRange}
                onChange={(value) => onTimeRangeChange(value as "7d" | "30d" | "90d")}
              />
            )}
          </InlineStack>
          <Box minHeight="300px">
            <Line data={trendData} options={trendOptions} />
          </Box>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            告警统计
          </Text>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                总告警数
              </Text>
              <Text as="span" fontWeight="semibold">
                {statsData.total}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                已确认
              </Text>
              <Text as="span" fontWeight="semibold">
                {statsData.acknowledged}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                未确认
              </Text>
              <Text as="span" fontWeight="semibold">
                {statsData.unacknowledged}
              </Text>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            严重程度分布
          </Text>
          <Box minHeight="250px">
            <Bar data={severityDistribution} options={barOptions} />
          </Box>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function getAlertTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    failure_rate: "失败率",
    missing_params: "缺参率",
    volume_drop: "量降",
    dedup_conflict: "去重冲突",
    pixel_heartbeat: "心跳丢失",
    reconciliation: "对账差异",
  };
  return labels[type] || type;
}

function getSeverityLabel(severity: string): string {
  const labels: Record<string, string> = {
    critical: "严重",
    high: "高",
    medium: "中",
    low: "低",
  };
  return labels[severity] || severity;
}

