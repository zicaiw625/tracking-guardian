

import {
  Box,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
  Button,
} from "@shopify/polaris";

interface ThresholdSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  helpText?: string;
  unit?: string;
  colorRanges?: Array<{ min: number; max: number; tone: "success" | "warning" | "critical" }>;
  currentValue?: number;
  recommendedValue?: number;
  onApplyRecommendation?: () => void;
}

export function ThresholdSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  helpText,
  unit = "%",
  colorRanges = [
    { min: 0, max: 2, tone: "success" },
    { min: 2, max: 10, tone: "warning" },
    { min: 10, max: 100, tone: "critical" },
  ],
  currentValue,
  recommendedValue,
  onApplyRecommendation,
}: ThresholdSliderProps) {
  const getTone = (val: number): "success" | "critical" | undefined => {
    const range = colorRanges.find((r) => val >= r.min && val < r.max);
    if (!range) return "success";
    return range.tone === "warning" ? undefined : range.tone;
  };

  const percentage = ((value - min) / (max - min)) * 100;
  const wouldTrigger = currentValue !== undefined && currentValue > value;
  const diffFromCurrent = currentValue !== undefined ? (currentValue - value) : undefined;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="span" fontWeight="semibold">
            {label}
          </Text>
          {helpText && (
            <Text as="span" variant="bodySm" tone="subdued">
              {helpText}
            </Text>
          )}
        </BlockStack>
        <InlineStack gap="200" blockAlign="center">
          {currentValue !== undefined && (
            <Badge tone={wouldTrigger ? "critical" : "success"}>
              {`当前: ${currentValue.toFixed(1)}${unit}`}
            </Badge>
          )}
          <Badge tone={getTone(value)}>
            {`阈值: ${value}${unit}`}
          </Badge>
        </InlineStack>
      </InlineStack>

      {currentValue !== undefined && (
        <Box background="bg-surface-secondary" padding="200" borderRadius="100">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">
              {wouldTrigger ? (
                <Text as="span" tone="critical" fontWeight="semibold">
                  ⚠️ 当前值超过阈值 {diffFromCurrent!.toFixed(1)}{unit}，将触发告警
                </Text>
              ) : (
                <Text as="span" tone="success">
                  ✓ 当前值低于阈值，不会触发告警
                </Text>
              )}
            </Text>
            {diffFromCurrent !== undefined && (
              <Text as="span" variant="bodySm" tone="subdued">
                差值: {diffFromCurrent > 0 ? "+" : ""}{diffFromCurrent.toFixed(1)}{unit}
              </Text>
            )}
          </InlineStack>
        </Box>
      )}

      {recommendedValue !== undefined && Math.abs(recommendedValue - value) > 0.1 && (
        <Box background="bg-fill-info-secondary" padding="200" borderRadius="100">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">
              💡 推荐阈值: {recommendedValue.toFixed(1)}{unit}（基于历史数据）
            </Text>
            {onApplyRecommendation && (
              <Button size="micro" onClick={onApplyRecommendation}>
                应用推荐值
              </Button>
            )}
          </InlineStack>
        </Box>
      )}

      <Box position="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: "100%",
            height: "8px",
            borderRadius: "4px",
            outline: "none",
            cursor: "pointer",
          }}
        />
        <Box paddingBlockStart="200">
          <ProgressBar progress={percentage} tone={getTone(value)} size="small" />
        </Box>
      </Box>

      <InlineStack align="space-between">
        <Text as="span" variant="bodySm" tone="subdued">
          {min}
          {unit}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {max}
          {unit}
        </Text>
      </InlineStack>
    </BlockStack>
  );
}

