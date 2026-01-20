import { useMemo } from "react";
import { Card, Text, BlockStack, InlineStack, Badge, Box } from "@shopify/polaris";
import { Pie, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
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

interface PixelVsCapiData {
  both: number;
  pixelOnly: number;
  capiOnly: number;
  consentBlocked: number;
}

interface ConsistencyIssue {
  orderId: string;
  issue: string;
  type: "value_mismatch" | "currency_mismatch" | "missing" | "duplicate" | "error" | "warning";
}

interface LocalConsistency {
  totalChecked: number;
  consistent: number;
  partial: number;
  inconsistent: number;
  issues: Array<{
    orderId: string;
    status: "consistent" | "partial" | "inconsistent";
    issues: string[];
  }>;
}

interface ChannelReconciliationChartProps {
  pixelVsCapi: PixelVsCapiData;
  consistencyIssues?: ConsistencyIssue[];
  localConsistency?: LocalConsistency;
}

export function ChannelReconciliationChart({
  pixelVsCapi,
  consistencyIssues = [],
  localConsistency,
}: ChannelReconciliationChartProps) {
  const pieData = useMemo(() => {
    return {
      labels: ["两者都有", "仅 Pixel", "仅 CAPI", "因同意阻止"],
      datasets: [
        {
          data: [
            pixelVsCapi.both,
            pixelVsCapi.pixelOnly,
            pixelVsCapi.capiOnly,
            pixelVsCapi.consentBlocked,
          ],
          backgroundColor: [
            "rgba(34, 197, 94, 0.8)",
            "rgba(99, 102, 241, 0.8)",
            "rgba(251, 146, 60, 0.8)",
            "rgba(239, 68, 68, 0.8)",
          ],
          borderColor: [
            "rgb(34, 197, 94)",
            "rgb(99, 102, 241)",
            "rgb(251, 146, 60)",
            "rgb(239, 68, 68)",
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [pixelVsCapi]);
  const consistencyBarData = useMemo(() => {
    if (!localConsistency) return null;
    return {
      labels: ["一致", "部分一致", "不一致"],
      datasets: [
        {
          label: "订单数量",
          data: [
            localConsistency.consistent,
            localConsistency.partial,
            localConsistency.inconsistent,
          ],
          backgroundColor: [
            "rgba(34, 197, 94, 0.8)",
            "rgba(251, 146, 60, 0.8)",
            "rgba(239, 68, 68, 0.8)",
          ],
          borderColor: [
            "rgb(34, 197, 94)",
            "rgb(251, 146, 60)",
            "rgb(239, 68, 68)",
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [localConsistency]);
  const issuesByType = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    consistencyIssues.forEach((issue) => {
      const type = issue.type === "value_mismatch"
        ? "金额不匹配"
        : issue.type === "currency_mismatch"
          ? "币种不匹配"
          : issue.type === "missing"
            ? "缺失"
            : issue.type === "duplicate"
              ? "重复"
              : issue.type === "error"
                ? "错误"
                : "警告";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    return {
      labels: Object.keys(typeCounts),
      datasets: [
        {
          label: "问题数量",
          data: Object.values(typeCounts),
          backgroundColor: "rgba(239, 68, 68, 0.8)",
          borderColor: "rgb(239, 68, 68)",
          borderWidth: 2,
        },
      ],
    };
  }, [consistencyIssues]);
  const pieOptions: ChartOptions<"pie"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "right" as const,
      },
      title: {
        display: true,
        text: "Pixel vs CAPI 事件分布",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const value = context.parsed as number;
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
            return `${context.label}: ${value} (${percentage}%)`;
          },
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
        text: "本地一致性检查结果",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `数量: ${context.parsed.y} 个订单`;
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
  const issuesBarOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: "一致性问题类型分布",
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `数量: ${context.parsed.y} 个问题`;
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
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingSm">
            Pixel vs CAPI 事件分布
          </Text>
          <Box minHeight="300px">
            <Pie data={pieData} options={pieOptions} />
          </Box>
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                两者都有
              </Text>
              <Text as="span" fontWeight="semibold">
                {pixelVsCapi.both}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                仅 Pixel
              </Text>
              <Text as="span" fontWeight="semibold">
                {pixelVsCapi.pixelOnly}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="span" variant="bodySm" tone="subdued">
                仅 CAPI
              </Text>
              <Text as="span" fontWeight="semibold">
                {pixelVsCapi.capiOnly}
              </Text>
            </InlineStack>
            {pixelVsCapi.consentBlocked > 0 && (
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  因同意阻止
                </Text>
                <Text as="span" fontWeight="semibold">
                  {pixelVsCapi.consentBlocked}
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </BlockStack>
      </Card>
      {localConsistency && consistencyBarData && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              本地一致性检查结果
            </Text>
            <Box minHeight="250px">
              <Bar data={consistencyBarData} options={barOptions} />
            </Box>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  总计检查
                </Text>
                <Text as="span" fontWeight="semibold">
                  {localConsistency.totalChecked} 个订单
                </Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  一致
                </Text>
                <Badge tone="success">{String(localConsistency.consistent)}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  部分一致
                </Text>
                <Badge>{String(localConsistency.partial)}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  不一致
                </Text>
                <Badge tone="critical">{String(localConsistency.inconsistent)}</Badge>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      )}
      {consistencyIssues.length > 0 && (
        <Card>
          <BlockStack gap="400">
            <Text as="h3" variant="headingSm">
              一致性问题类型分布
            </Text>
            <Box minHeight="250px">
              <Bar data={issuesByType} options={issuesBarOptions} />
            </Box>
            <BlockStack gap="200">
              {Object.entries(
                issuesByType.labels.reduce((acc, label, index) => {
                  acc[label] = issuesByType.datasets[0].data[index];
                  return acc;
                }, {} as Record<string, number>)
              ).map(([type, count]) => (
                <InlineStack key={type} align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {type}
                  </Text>
                  <Badge tone={count > 5 ? "critical" : count > 2 ? undefined : "info"}>
                    {`${count} 个`}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
