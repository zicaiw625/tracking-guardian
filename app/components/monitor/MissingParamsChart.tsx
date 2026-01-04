

import { useMemo } from "react";
import { Card, Text, BlockStack, InlineStack, Select, Box } from "@shopify/polaris";
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
import type { MissingParamsHistoryData } from "~/services/monitoring.server";
import { PLATFORM_NAMES, isValidPlatform } from "~/types";

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

interface MissingParamsChartProps {
  historyData: MissingParamsHistoryData[];
  selectedPlatform?: string;
  onPlatformChange?: (platform: string) => void;
}

export function MissingParamsChart({
  historyData,
  selectedPlatform,
  onPlatformChange,
}: MissingParamsChartProps) {

  const platforms = useMemo(() => {
    const platformSet = new Set<string>();
    historyData.forEach((day) => {
      Object.keys(day.byPlatform).forEach((platform) => {
        platformSet.add(platform);
      });
    });
    return Array.from(platformSet);
  }, [historyData]);

  const trendData = useMemo(() => {
    const labels = historyData.map((d) => {
      const date = new Date(d.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const overallRate = historyData.map((d) => d.missingRate);

    if (selectedPlatform && selectedPlatform !== "all") {
      const platformRate = historyData.map((d) => {
        const platformData = d.byPlatform[selectedPlatform];
        return platformData ? platformData.rate : 0;
      });

      return {
        labels,
        datasets: [
          {
            label: "总体缺参率",
            data: overallRate,
            borderColor: "rgb(99, 102, 241)",
            backgroundColor: "rgba(99, 102, 241, 0.1)",
            tension: 0.4,
          },
          {
            label: `${isValidPlatform(selectedPlatform) ? PLATFORM_NAMES[selectedPlatform] : selectedPlatform} 缺参率`,
            data: platformRate,
            borderColor: "rgb(239, 68, 68)",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            tension: 0.4,
          },
        ],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: "总体缺参率",
          data: overallRate,
          borderColor: "rgb(99, 102, 241)",
          backgroundColor: "rgba(99, 102, 241, 0.1)",
          tension: 0.4,
        },
      ],
    };
  }, [historyData, selectedPlatform]);

  const platformComparisonData = useMemo(() => {
    const platformRates: Record<string, number> = {};

    historyData.forEach((day) => {
      Object.entries(day.byPlatform).forEach(([platform, data]) => {
        if (!platformRates[platform]) {
          platformRates[platform] = 0;
        }
        platformRates[platform] += data.rate;
      });
    });

    Object.keys(platformRates).forEach((platform) => {
      platformRates[platform] = platformRates[platform] / historyData.length;
    });

    const labels = Object.keys(platformRates).map((p) =>
      isValidPlatform(p) ? PLATFORM_NAMES[p] : p
    );
    const data = Object.values(platformRates);

    return {
      labels,
      datasets: [
        {
          label: "平均缺参率 (%)",
          data,
          backgroundColor: data.map((rate) => {
            if (rate < 5) return "rgba(34, 197, 94, 0.8)";
            if (rate < 10) return "rgba(234, 179, 8, 0.8)";
            return "rgba(239, 68, 68, 0.8)";
          }),
          borderColor: data.map((rate) => {
            if (rate < 5) return "rgb(34, 197, 94)";
            if (rate < 10) return "rgb(234, 179, 8)";
            return "rgb(239, 68, 68)";
          }),
          borderWidth: 1,
        },
      ],
    };
  }, [historyData]);

  const trendOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "缺参率趋势",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const y = context.parsed.y;
            if (y === null || y === undefined) return `${context.dataset.label}: N/A`;
            return `${context.dataset.label}: ${y.toFixed(2)}%`;
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
        text: "平台缺参率对比",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const y = context.parsed.y;
            if (y === null || y === undefined) return `平均缺参率: N/A`;
            return `平均缺参率: ${y.toFixed(2)}%`;
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
      {onPlatformChange && platforms.length > 0 && (
        <Select
          label="选择平台"
          options={[
            { label: "所有平台", value: "all" },
            ...platforms.map((p) => ({
              label: isValidPlatform(p) ? PLATFORM_NAMES[p] : p,
              value: p,
            })),
          ]}
          value={selectedPlatform || "all"}
          onChange={onPlatformChange}
        />
      )}

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            缺参率趋势
          </Text>
          <Box minHeight="300px">
            <Line data={trendData} options={trendOptions} />
          </Box>
        </BlockStack>
      </Card>

      {platforms.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              平台缺参率对比
            </Text>
            <Box minHeight="300px">
              <Bar data={platformComparisonData} options={barOptions} />
            </Box>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

