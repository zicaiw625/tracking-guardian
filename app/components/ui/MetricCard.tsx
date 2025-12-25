/**
 * Metric Card Components
 *
 * Reusable components for displaying metrics and statistics.
 */

import { Card, Text, BlockStack, InlineStack, Box, ProgressBar, Icon } from "@shopify/polaris";
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "~/components/icons";

// =============================================================================
// Types
// =============================================================================

export type TrendDirection = "up" | "down" | "neutral";

export interface MetricValue {
  value: number | string;
  label?: string;
  unit?: string;
}

// =============================================================================
// Basic Metric Card
// =============================================================================

export interface MetricCardProps {
  /** Card title */
  title: string;
  /** Primary value */
  value: number | string;
  /** Value unit (e.g., "条", "个", "%") */
  unit?: string;
  /** Description or secondary info */
  description?: string;
  /** Trend direction */
  trend?: TrendDirection;
  /** Trend percentage or value */
  trendValue?: string;
  /** Trend comparison period */
  trendPeriod?: string;
  /** Loading state */
  loading?: boolean;
}

/**
 * Single metric display card
 */
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

// =============================================================================
// Progress Metric Card
// =============================================================================

export interface ProgressMetricCardProps {
  /** Card title */
  title: string;
  /** Current value */
  current: number;
  /** Maximum/total value */
  total: number;
  /** Value unit */
  unit?: string;
  /** Progress bar color */
  tone?: "primary" | "success" | "warning" | "critical";
  /** Show percentage */
  showPercentage?: boolean;
  /** Description */
  description?: string;
}

/**
 * Metric card with progress bar
 */
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
  // Map our tone values to Polaris ProgressBar tone values
  const getProgressTone = (): "highlight" | "success" | "critical" | undefined => {
    if (percentage >= 90) return "critical";
    if (percentage >= 70) return "highlight"; // Polaris uses "highlight" instead of "warning"
    if (tone === "success") return "success";
    if (tone === "critical") return "critical";
    return undefined; // Default/primary
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

// =============================================================================
// Comparison Metric Card
// =============================================================================

export interface ComparisonMetricCardProps {
  /** Card title */
  title: string;
  /** Left value label */
  leftLabel: string;
  /** Left value */
  leftValue: number | string;
  /** Right value label */
  rightLabel: string;
  /** Right value */
  rightValue: number | string;
  /** Value unit */
  unit?: string;
  /** Highlight difference */
  highlightDifference?: boolean;
}

/**
 * Side-by-side comparison metric card
 */
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

// =============================================================================
// Metric Grid
// =============================================================================

export interface MetricGridProps {
  /** Metric items */
  items: Array<{
    title: string;
    value: number | string;
    unit?: string;
    trend?: TrendDirection;
    trendValue?: string;
  }>;
  /** Number of columns */
  columns?: 2 | 3 | 4;
}

/**
 * Grid of metric cards
 */
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

// =============================================================================
// Stat Item (Inline)
// =============================================================================

export interface StatItemProps {
  label: string;
  value: number | string;
  unit?: string;
}

/**
 * Inline stat item for lists
 */
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
