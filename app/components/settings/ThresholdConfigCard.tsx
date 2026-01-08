import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  Banner,
  Button,
} from "@shopify/polaris";
import { ThresholdSlider } from "./ThresholdSlider";
import { useState } from "react";

export interface ThresholdConfig {
  type: "failure_rate" | "missing_params" | "volume_drop" | "dedup_conflict";
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  helpText: string;
  recommendedValue?: number;
  currentValue?: number;
  colorRanges: Array<{ min: number; max: number; tone: "success" | "warning" | "critical" }>;
}

interface ThresholdConfigCardProps {
  config: ThresholdConfig;
  onChange: (value: number) => void;
  onTest?: () => void;
  showPreview?: boolean;
  showRecommendation?: boolean;
}

export function ThresholdConfigCard({
  config,
  onChange,
  onTest,
  showPreview = true,
  showRecommendation = true,
}: ThresholdConfigCardProps) {
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    if (onTest) {
      setIsTesting(true);
      try {
        await onTest();
      } finally {
        setIsTesting(false);
      }
    }
  };

  const getStatus = (): "success" | "warning" | "critical" | undefined => {
    if (!config.currentValue) return undefined;

    const range = config.colorRanges.find(
      (r) => config.currentValue! >= r.min && config.currentValue! < r.max
    );
    return range?.tone;
  };

  const isExceedingThreshold = config.currentValue !== undefined && config.currentValue > config.value;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {config.label}
          </Text>
          {config.recommendedValue !== undefined && showRecommendation && (
            <Badge tone="info">
              {`推荐值: ${config.recommendedValue.toFixed(1)}${config.unit}`}
            </Badge>
          )}
        </InlineStack>

        <ThresholdSlider
          label=""
          value={config.value}
          onChange={onChange}
          min={config.min}
          max={config.max}
          step={config.step}
          unit={config.unit}
          helpText={config.helpText}
          colorRanges={config.colorRanges}
        />

        {showPreview && config.currentValue !== undefined && (
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  当前值
                </Text>
                <Badge tone={getStatus()}>
                  {`${config.currentValue.toFixed(2)}${config.unit}`}
                </Badge>
              </InlineStack>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  阈值
                </Text>
                <Badge tone={isExceedingThreshold ? "critical" : "success"}>
                  {`${config.value.toFixed(1)}${config.unit}`}
                </Badge>
              </InlineStack>
              {isExceedingThreshold && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    当前值超过阈值，将触发告警
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Box>
        )}

        {showRecommendation && config.recommendedValue !== undefined && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                基于历史数据，推荐阈值设置为 {config.recommendedValue.toFixed(1)}{config.unit}
              </Text>
              {Math.abs(config.value - config.recommendedValue) > config.step && (
                <Button
                  size="slim"
                  variant="secondary"
                  onClick={() => onChange(config.recommendedValue!)}
                >
                  应用推荐值
                </Button>
              )}
            </BlockStack>
          </Banner>
        )}

        {onTest && (
          <Button
            size="slim"
            variant="secondary"
            onClick={handleTest}
            loading={isTesting}
          >
            测试阈值（查看过去24小时触发情况）
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}
