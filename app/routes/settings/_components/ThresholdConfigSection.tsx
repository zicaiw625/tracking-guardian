

import {
  Text,
  BlockStack,
  Divider,
  Box,
  Badge,
  Banner,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { ThresholdSlider } from "~/components/settings/ThresholdSlider";
import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";

interface ThresholdConfigSectionProps {
  failureRateThreshold: number;
  onFailureRateChange: (value: number) => void;
}

export function ThresholdConfigSection({
  failureRateThreshold,
  onFailureRateChange,
}: ThresholdConfigSectionProps) {
  const recommendationsFetcher = useFetcher();
  const currentFetcher = useFetcher();
  const testFetcher = useFetcher();

  const [missingParamsThreshold, setMissingParamsThreshold] = useState(5);
  const [volumeDropThreshold, setVolumeDropThreshold] = useState(50);

  useEffect(() => {
    recommendationsFetcher.load("/api/threshold-recommendations?action=recommendations");
    currentFetcher.load("/api/threshold-recommendations?action=current");
  }, []);

  const recommendations = recommendationsFetcher.data?.recommendations;
  const currentValues = currentFetcher.data?.current;
  const testResult = testFetcher.data?.testResult;

  const handleTest = () => {
    testFetcher.load(
      `/api/threshold-recommendations?action=test&failureRate=${failureRateThreshold}&missingParams=${missingParamsThreshold}&volumeDrop=${volumeDropThreshold}`
    );
  };

  return (
    <BlockStack gap="400">
      {}
      <Box>
        <ThresholdSlider
          label="事件失败率阈值"
          value={failureRateThreshold}
          onChange={onFailureRateChange}
          min={0}
          max={50}
          step={0.5}
          helpText="当事件发送失败率超过此百分比时触发警报（推荐: 2-5%）"
          unit="%"
          colorRanges={[
            { min: 0, max: 2, tone: "success" },
            { min: 2, max: 10, tone: "warning" },
            { min: 10, max: 50, tone: "critical" },
          ]}
        />
        {currentValues && (
          <Box paddingBlockStart="200" paddingBlockEnd="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                当前失败率: {currentValues.failureRate.toFixed(2)}%
              </Text>
              <Badge tone={currentValues.failureRate > failureRateThreshold ? "critical" : "success"}>
                {currentValues.failureRate > failureRateThreshold ? "将触发告警" : "正常"}
              </Badge>
            </InlineStack>
          </Box>
        )}
        {recommendations && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                推荐值: {recommendations.failureRate.toFixed(1)}%（基于历史数据）
              </Text>
              {Math.abs(failureRateThreshold - recommendations.failureRate) > 0.5 && (
                <Button
                  size="slim"
                  variant="secondary"
                  onClick={() => onFailureRateChange(recommendations.failureRate)}
                >
                  应用推荐值
                </Button>
              )}
            </BlockStack>
          </Banner>
        )}
      </Box>

      <Divider />

      {}
      <Box>
        <ThresholdSlider
          label="缺参率阈值"
          value={missingParamsThreshold}
          onChange={setMissingParamsThreshold}
          min={0}
          max={50}
          step={0.5}
          helpText="当事件参数缺失率超过此百分比时触发警报（推荐: 5-10%）"
          unit="%"
          colorRanges={[
            { min: 0, max: 5, tone: "success" },
            { min: 5, max: 10, tone: "warning" },
            { min: 10, max: 50, tone: "critical" },
          ]}
        />
        {currentValues && (
          <Box paddingBlockStart="200" paddingBlockEnd="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                当前缺参率: {currentValues.missingParams.toFixed(2)}%
              </Text>
              <Badge tone={currentValues.missingParams > missingParamsThreshold ? "critical" : "success"}>
                {currentValues.missingParams > missingParamsThreshold ? "将触发告警" : "正常"}
              </Badge>
            </InlineStack>
          </Box>
        )}
        {recommendations && (
          <Banner tone="info">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                推荐值: {recommendations.missingParams.toFixed(1)}%（基于历史数据）
              </Text>
              {Math.abs(missingParamsThreshold - recommendations.missingParams) > 0.5 && (
                <Button
                  size="slim"
                  variant="secondary"
                  onClick={() => setMissingParamsThreshold(recommendations.missingParams)}
                >
                  应用推荐值
                </Button>
              )}
            </BlockStack>
          </Banner>
        )}
      </Box>

      <Divider />

      {}
      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold">
              事件量骤降阈值
            </Text>
            <Badge tone="info">默认: 50%</Badge>
          </InlineStack>
          <Text as="span" variant="bodySm" tone="subdued">
            当 24 小时内事件量下降超过此百分比时触发警报
          </Text>
        </BlockStack>
      </Box>

      {}
      <Button
        variant="secondary"
        onClick={handleTest}
        loading={testFetcher.state === "loading"}
      >
        测试阈值（查看过去24小时触发情况）
      </Button>

      {}
      {testResult && (
        <Banner tone={testResult.failureRate.wouldTrigger || testResult.missingParams.wouldTrigger ? "warning" : "success"}>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              测试结果（过去24小时）
            </Text>
            <Text as="p" variant="bodySm">
              失败率: {testResult.failureRate.wouldTrigger ? "⚠️ 将触发" : "✅ 正常"}（当前: {testResult.failureRate.currentValue.toFixed(2)}%，阈值: {testResult.failureRate.threshold.toFixed(1)}%）
            </Text>
            <Text as="p" variant="bodySm">
              缺参率: {testResult.missingParams.wouldTrigger ? "⚠️ 将触发" : "✅ 正常"}（当前: {testResult.missingParams.currentValue.toFixed(2)}%，阈值: {testResult.missingParams.threshold.toFixed(1)}%）
            </Text>
            <Text as="p" variant="bodySm">
              事件量骤降: {testResult.volumeDrop.wouldTrigger ? "⚠️ 将触发" : "✅ 正常"}（变化: {testResult.volumeDrop.currentValue.toFixed(2)}%，阈值: {testResult.volumeDrop.threshold.toFixed(1)}%）
            </Text>
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}

