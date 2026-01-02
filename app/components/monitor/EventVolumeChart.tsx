

import { useMemo } from "react";
import { Card, Text, BlockStack, Box, Banner } from "@shopify/polaris";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
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
  Title,
  Tooltip,
  Legend
);

export interface EventVolumeHistoryData {
  date: string;
  count: number;
  isDrop?: boolean;
}

interface EventVolumeChartProps {
  historyData: EventVolumeHistoryData[];
  current24h: number;
  previous24h: number;
  changePercent: number;
  isDrop: boolean;
}

export function EventVolumeChart({
  historyData,
  current24h,
  previous24h,
  changePercent,
  isDrop,
}: EventVolumeChartProps) {
  const chartData = useMemo(() => {
    const labels = historyData.map((d) => {
      const date = new Date(d.date);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const data = historyData.map((d) => d.count);

    const movingAverage: number[] = [];
    const windowSize = Math.min(7, historyData.length);
    for (let i = 0; i < historyData.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const end = i + 1;
      const window = data.slice(start, end);
      const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
      movingAverage.push(avg);
    }

    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    const lowerBound = mean - 2 * stdDev;

    return {
      labels,
      datasets: [
        {
          label: "事件量",
          data,
          borderColor: "rgb(99, 102, 241)",
          backgroundColor: "rgba(99, 102, 241, 0.1)",
          tension: 0.4,
          pointRadius: (ctx: { dataIndex: number }) => {
            const index = ctx.dataIndex;
            return historyData[index]?.isDrop ? 6 : 3;
          },
          pointBackgroundColor: (ctx: { dataIndex: number }) => {
            const index = ctx.dataIndex;
            return historyData[index]?.isDrop ? "rgb(239, 68, 68)" : "rgb(99, 102, 241)";
          },
        },
        {
          label: "移动平均（7天）",
          data: movingAverage,
          borderColor: "rgb(234, 179, 8)",
          backgroundColor: "rgba(234, 179, 8, 0.1)",
          borderDash: [5, 5],
          tension: 0.4,
          pointRadius: 0,
        },

        {
          label: `平均值: ${mean.toFixed(0)}`,
          data: Array(historyData.length).fill(mean),
          borderColor: "rgba(34, 197, 94, 0.5)",
          backgroundColor: "transparent",
          borderDash: [5, 5],
          tension: 0,
          pointRadius: 0,
        },

        ...(lowerBound > 0
          ? [
              {
                label: `异常阈值: ${lowerBound.toFixed(0)}`,
                data: Array(historyData.length).fill(lowerBound),
                borderColor: "rgba(239, 68, 68, 0.5)",
                backgroundColor: "transparent",
                borderDash: [5, 5],
                tension: 0,
                pointRadius: 0,
              },
            ]
          : []),
      ],
    };
  }, [historyData]);

  const chartOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "事件量趋势（最近7天）",
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

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            事件量趋势
          </Text>
          {isDrop && (
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                检测到事件量下降 {Math.abs(changePercent).toFixed(2)}%（当前24小时: {current24h}，前24小时: {previous24h}），可能存在追踪断档。
              </Text>
            </Banner>
          )}
        </BlockStack>
        <Box minHeight="300px">
          <Line data={chartData} options={chartOptions} />
        </Box>
      </BlockStack>
    </Card>
  );
}

