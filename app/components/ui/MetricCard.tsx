import { Card, Text, BlockStack, InlineStack, Box, ProgressBar, Icon } from "@shopify/polaris";
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "~/components/icons";

export type TrendDirection = "up" | "down" | "neutral";

export interface MetricValue {
  value: number | string;
  label?: string;
  unit?: string;
}

export interface MetricCardProps {

  title: string;

  value: number | string;

  unit?: string;

  description?: string;

  trend?: TrendDirection;

  trendValue?: string;

  trendPeriod?: string;

  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  unit,
  description,
  trend,
  trendValue,
  trendPeriod = "vs 上周",
  loading = false,
}: MetricCardProps) {
  const getTrendColor = () => {
    switch (trend) {
      case "up":
        return "success";
      case "down":
        return "critical";
      default:
        return "subdued";
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case "up":
        return ArrowUpIcon;
      case "down":
        return ArrowDownIcon;
      default:
        return MinusIcon;
    }
  };

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" tone="subdued">
          {title}
        </Text>

        <InlineStack align="start" blockAlign="end" gap="100">
          <Text as="p" variant="heading2xl" fontWeight="bold">
            {loading ? "-" : value}
          </Text>
          {unit && (
            <Text as="span" variant="bodyMd" tone="subdued">
              {unit}
            </Text>
          )}
        </InlineStack>

        {trend && trendValue && (
          <InlineStack gap="100" align="start">
            <Box>
              <Icon source={getTrendIcon()} tone={getTrendColor()} />
            </Box>
            <Text as="span" variant="bodySm" tone={getTrendColor()}>
              {trendValue}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {trendPeriod}
            </Text>
          </InlineStack>
        )}

        {description && (
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export interface ProgressMetricCardProps {

  title: string;

  current: number;

  total: number;

  unit?: string;

  tone?: "primary" | "success" | "warning" | "critical";

  showPercentage?: boolean;

  description?: string;
}

export function ProgressMetricCard({
  title,
  current,
  total,
  unit = "",
  tone = "primary",
  showPercentage = true,
  description,
}: ProgressMetricCardProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  const getProgressTone = (): "highlight" | "success" | "critical" | undefined => {
    if (percentage >= 90) return "critical";
    if (percentage >= 70) return "highlight";
    if (tone === "success") return "success";
    if (tone === "critical") return "critical";
    return undefined;
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <Text as="h3" variant="headingSm" tone="subdued">
            {title}
          </Text>
          {showPercentage && (
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {percentage}%
            </Text>
          )}
        </InlineStack>

        <ProgressBar progress={percentage} tone={getProgressTone()} size="small" />

        <Text as="p" variant="bodySm">
          <Text as="span" fontWeight="semibold">
            {current.toLocaleString()}
          </Text>
          <Text as="span" tone="subdued">
            {" "}/ {total.toLocaleString()} {unit}
          </Text>
        </Text>

        {description && (
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export interface ComparisonMetricCardProps {

  title: string;

  leftLabel: string;

  leftValue: number | string;

  rightLabel: string;

  rightValue: number | string;

  unit?: string;

  highlightDifference?: boolean;
}

export function ComparisonMetricCard({
  title,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  unit = "",
  highlightDifference = false,
}: ComparisonMetricCardProps) {
  const leftNum = typeof leftValue === "number" ? leftValue : parseFloat(String(leftValue)) || 0;
  const rightNum = typeof rightValue === "number" ? rightValue : parseFloat(String(rightValue)) || 0;
  const difference = leftNum - rightNum;
  const differencePercent = rightNum !== 0 ? ((difference / rightNum) * 100).toFixed(1) : "0";

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" tone="subdued">
          {title}
        </Text>

        <InlineStack gap="400" align="space-between">
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              {leftLabel}
            </Text>
            <Text as="p" variant="headingLg" fontWeight="bold">
              {typeof leftValue === "number" ? leftValue.toLocaleString() : leftValue}
              {unit && <Text as="span" variant="bodySm" tone="subdued"> {unit}</Text>}
            </Text>
          </BlockStack>

          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              {rightLabel}
            </Text>
            <Text as="p" variant="headingLg" fontWeight="bold">
              {typeof rightValue === "number" ? rightValue.toLocaleString() : rightValue}
              {unit && <Text as="span" variant="bodySm" tone="subdued"> {unit}</Text>}
            </Text>
          </BlockStack>
        </InlineStack>

        {highlightDifference && (
          <Text
            as="p"
            variant="bodySm"
            tone={difference >= 0 ? "success" : "critical"}
          >
            差异: {difference >= 0 ? "+" : ""}{difference.toLocaleString()} ({differencePercent}%)
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export interface MetricGridProps {

  items: Array<{
    title: string;
    value: number | string;
    unit?: string;
    trend?: TrendDirection;
    trendValue?: string;
  }>;

  columns?: 2 | 3 | 4;
}

export function MetricGrid({ items, columns = 3 }: MetricGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "var(--p-space-400)",
      }}
    >
      {items.map((item, index) => (
        <MetricCard
          key={index}
          title={item.title}
          value={item.value}
          unit={item.unit}
          trend={item.trend}
          trendValue={item.trendValue}
        />
      ))}
    </div>
  );
}

export interface StatItemProps {
  label: string;
  value: number | string;
  unit?: string;
}

export function StatItem({ label, value, unit }: StatItemProps) {
  return (
    <InlineStack align="space-between">
      <Text as="span" tone="subdued">
        {label}
      </Text>
      <Text as="span" fontWeight="semibold">
        {typeof value === "number" ? value.toLocaleString() : value}
        {unit && ` ${unit}`}
      </Text>
    </InlineStack>
  );
}
