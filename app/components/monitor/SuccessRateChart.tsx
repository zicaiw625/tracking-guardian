
import { useMemo } from "react";
import { Card, Text, BlockStack, Box, Select } from "@shopify/polaris";
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
import { isValidPlatform, PLATFORM_NAMES } from "~/types";
import type { SuccessRateHistory } from "~/services/monitoring/event-success-rate.server";

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

export interface SuccessRateChartProps {
  overall: SuccessRateHistory[];
  byDestination?: Record<string, SuccessRateHistory[]>;
  byEventType?: Record<string, SuccessRateHistory[]>;
  selectedDestination?: string;
  onDestinationChange?: (destination: string) => void;
  selectedEventType?: string;
  onEventTypeChange?: (eventType: string) => void;
}

export function SuccessRateChart({
  overall,
  byDestination = {},
  byEventType = {},
  selectedDestination,
  onDestinationChange,
  selectedEventType,
  onEventTypeChange,
}: SuccessRateChartProps) {
  const destinations = Object.keys(byDestination);
  const eventTypes = Object.keys(byEventType);

  // 总体成功率趋势
  const overallTrendData = useMemo(() => {
    const labels = overall.map((d) => {
      const date = new Date(`${d.date}T${String(d.hour).padStart(2, "0")}:00:00`);
      return `${date.getMonth() + 1}/${date.getDate()} ${d.hour}:00`;
    });

    return {
      labels,
      datasets: [
        {
          label: "成功率",
          data: overall.map((d) => d.successRate),
          borderColor: "rgb(34, 197, 94)",
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          tension: 0.4,
          yAxisID: "y",
        },
        {
          label: "失败率",
          data: overall.map((d) => d.failureRate),
          borderColor: "rgb(239, 68, 68)",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.4,
          yAxisID: "y",
        },
      ],
    };
  }, [overall]);

  // 按平台的成功率对比
  const platformComparisonData = useMemo(() => {
    const platformStats: Record<string, { success: number; total: number }> = {};
    
    Object.entries(byDestination).forEach(([platform, history]) => {
      const total = history.reduce((sum, h) => sum + h.total, 0);
      const success = history.reduce((sum, h) => sum + h.successful, 0);
      if (total > 0) {
        platformStats[platform] = { success, total };
      }
    });

    const platforms = Object.keys(platformStats).sort(
      (a, b) => platformStats[b].total - platformStats[a].total
    );

    return {
      labels: platforms.map((p) => (isValidPlatform(p) ? PLATFORM_NAMES[p] : p)),
      datasets: [
        {
          label: "成功率",
          data: platforms.map((p) => {
            const stats = platformStats[p];
            return stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
          }),
          backgroundColor: platforms.map((p) => {
            const stats = platformStats[p];
            const rate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
            if (rate >= 95) return "rgba(34, 197, 94, 0.8)";
            if (rate >= 90) return "rgba(234, 179, 8, 0.8)";
            return "rgba(239, 68, 68, 0.8)";
          }),
        },
      ],
    };
  }, [byDestination]);

  // 按事件类型的成功率对比
  const eventTypeComparisonData = useMemo(() => {
    const eventTypeStats: Record<string, { success: number; total: number }> = {};
    
    Object.entries(byEventType).forEach(([eventType, history]) => {
      const total = history.reduce((sum, h) => sum + h.total, 0);
      const success = history.reduce((sum, h) => sum + h.successful, 0);
      if (total > 0) {
        eventTypeStats[eventType] = { success, total };
      }
    });

    const eventTypes = Object.keys(eventTypeStats).sort(
      (a, b) => eventTypeStats[b].total - eventTypeStats[a].total
    );

    return {
      labels: eventTypes,
      datasets: [
        {
          label: "成功率",
          data: eventTypes.map((et) => {
            const stats = eventTypeStats[et];
            return stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
          }),
          backgroundColor: eventTypes.map((et) => {
            const stats = eventTypeStats[et];
            const rate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
            if (rate >= 95) return "rgba(34, 197, 94, 0.8)";
            if (rate >= 90) return "rgba(234, 179, 8, 0.8)";
            return "rgba(239, 68, 68, 0.8)";
          }),
        },
      ],
    };
  }, [byEventType]);

  // 选中平台/事件类型的趋势
  const selectedTrendData = useMemo(() => {
    let selectedHistory: SuccessRateHistory[] = [];
    let label = "";

    if (selectedDestination && byDestination[selectedDestination]) {
      selectedHistory = byDestination[selectedDestination];
      label = isValidPlatform(selectedDestination) ? PLATFORM_NAMES[selectedDestination] : selectedDestination;
    } else if (selectedEventType && byEventType[selectedEventType]) {
      selectedHistory = byEventType[selectedEventType];
      label = selectedEventType;
    }

    if (selectedHistory.length === 0) return null;

    const labels = selectedHistory.map((d) => {
      const date = new Date(`${d.date}T${String(d.hour).padStart(2, "0")}:00:00`);
      return `${date.getMonth() + 1}/${date.getDate()} ${d.hour}:00`;
    });

    return {
      labels,
      datasets: [
        {
          label: `${label} - 成功率`,
          data: selectedHistory.map((d) => d.successRate),
          borderColor: "rgb(99, 102, 241)",
          backgroundColor: "rgba(99, 102, 241, 0.1)",
          tension: 0.4,
        },
        {
          label: `${label} - 失败率`,
          data: selectedHistory.map((d) => d.failureRate),
          borderColor: "rgb(239, 68, 68)",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.4,
        },
      ],
    };
  }, [selectedDestination, selectedEventType, byDestination, byEventType]);

  const trendOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "成功率/失败率趋势（最近24小时）",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        ticks: {
          callback: (value) => `${value}%`,
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
        text: "成功率对比",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `成功率: ${context.parsed.y.toFixed(2)}%`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        ticks: {
          callback: (value) => `${value}%`,
        },
      },
    },
  };

  return (
    <BlockStack gap="400">
      {/* 总体趋势 */}
      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            成功率/失败率趋势
          </Text>
          <Box minHeight="300px">
            <Line data={overallTrendData} options={trendOptions} />
          </Box>
        </BlockStack>
      </Card>

      {/* 按平台对比 */}
      {destinations.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                按平台成功率对比
              </Text>
              {onDestinationChange && (
                <Select
                  label="选择平台查看详细趋势"
                  options={[
                    { label: "所有平台", value: "all" },
                    ...destinations.map((p) => ({
                      label: isValidPlatform(p) ? PLATFORM_NAMES[p] : p,
                      value: p,
                    })),
                  ]}
                  value={selectedDestination || "all"}
                  onChange={onDestinationChange}
                />
              )}
            </BlockStack>
            <Box minHeight="300px">
              <Bar data={platformComparisonData} options={barOptions} />
            </Box>
          </BlockStack>
        </Card>
      )}

      {/* 按事件类型对比 */}
      {eventTypes.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                按事件类型成功率对比
              </Text>
              {onEventTypeChange && (
                <Select
                  label="选择事件类型查看详细趋势"
                  options={[
                    { label: "所有事件类型", value: "all" },
                    ...eventTypes.map((et) => ({
                      label: et,
                      value: et,
                    })),
                  ]}
                  value={selectedEventType || "all"}
                  onChange={onEventTypeChange}
                />
              )}
            </BlockStack>
            <Box minHeight="300px">
              <Bar data={eventTypeComparisonData} options={barOptions} />
            </Box>
          </BlockStack>
        </Card>
      )}

      {/* 选中项的趋势 */}
      {selectedTrendData && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              详细趋势
            </Text>
            <Box minHeight="300px">
              <Line data={selectedTrendData} options={trendOptions} />
            </Box>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

