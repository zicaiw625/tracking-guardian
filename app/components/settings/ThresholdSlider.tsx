

import {
  Box,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  ProgressBar,
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
}: ThresholdSliderProps) {
  const getTone = (val: number): "success" | "warning" | "critical" => {
    const range = colorRanges.find((r) => val >= r.min && val < r.max);
    return range?.tone || "success";
  };

  const percentage = ((value - min) / (max - min)) * 100;

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
        <Badge tone={getTone(value)}>
          {value}
          {unit}
        </Badge>
      </InlineStack>

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

