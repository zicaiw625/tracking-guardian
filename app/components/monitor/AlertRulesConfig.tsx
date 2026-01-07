
import { useState, useCallback, useMemo } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  TextField,
  Select,
  Checkbox,
  Banner,
  List,
  RangeSlider,
  Collapsible,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon } from "~/components/icons";
import type {
  VolumeAnomalyAlertConfig,
  VolumeAnomalyAlertResult,
} from "../../services/monitoring/volume-anomaly.server";
import type {
  MissingParamsAlertConfig,
  MissingParamsAlertResult,
} from "../../services/monitoring/missing-params.server";

export interface AlertRulesConfigData {
  successRate?: {
    enabled: boolean;
    threshold: number;
    criticalThreshold?: number;
  };
  missingParams?: MissingParamsAlertConfig;
  volumeAnomaly?: VolumeAnomalyAlertConfig;
}

export interface AlertRulesConfigProps {
  shopId: string;
  initialConfig?: AlertRulesConfigData;
  currentMetrics?: {
    failureRate?: number;
    missingParamsRate?: number;
    volumeDrop?: number;
  };
  onSave?: (config: AlertRulesConfigData) => Promise<void>;
  onTest?: (config: AlertRulesConfigData) => Promise<void>;
  isLoading?: boolean;
}

export function AlertRulesConfig({
  shopId,
  initialConfig,
  currentMetrics,
  onSave,
  onTest,
  isLoading = false,
}: AlertRulesConfigProps) {

  const [successRateEnabled, setSuccessRateEnabled] = useState(
    initialConfig?.successRate?.enabled ?? true
  );
  const [failureRateThreshold, setFailureRateThreshold] = useState(
    String(initialConfig?.successRate?.threshold ?? 5)
  );
  const [failureRateCriticalThreshold, setFailureRateCriticalThreshold] = useState(
    String(initialConfig?.successRate?.criticalThreshold ?? 10)
  );

  const [missingParamsEnabled, setMissingParamsEnabled] = useState(
    initialConfig?.missingParams?.enabled ?? true
  );
  const [missingParamsThreshold, setMissingParamsThreshold] = useState(
    String(initialConfig?.missingParams?.threshold ?? 5)
  );
  const [missingParamsCriticalThreshold, setMissingParamsCriticalThreshold] = useState(
    String(initialConfig?.missingParams?.criticalThreshold ?? 10)
  );
  const [missingParamsToCheck, setMissingParamsToCheck] = useState<string[]>(
    initialConfig?.missingParams?.params ?? ["value", "currency"]
  );

  const [volumeAnomalyEnabled, setVolumeAnomalyEnabled] = useState(
    initialConfig?.volumeAnomaly?.enabled ?? true
  );
  const [volumeDropThreshold, setVolumeDropThreshold] = useState(
    String(initialConfig?.volumeAnomaly?.threshold ?? 50)
  );
  const [volumeDropCriticalThreshold, setVolumeDropCriticalThreshold] = useState(
    String(initialConfig?.volumeAnomaly?.criticalThreshold ?? 80)
  );
  const [volumeMinEvents, setVolumeMinEvents] = useState(
    String(initialConfig?.volumeAnomaly?.minVolume ?? 10)
  );
  const [useZScore, setUseZScore] = useState(
    initialConfig?.volumeAnomaly?.useZScore ?? false
  );
  const [zScoreThreshold, setZScoreThreshold] = useState(
    String(initialConfig?.volumeAnomaly?.zScoreThreshold ?? -2)
  );

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    successRate: true,
    missingParams: true,
    volumeAnomaly: true,
  });

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const handleSave = useCallback(async () => {
    const config: AlertRulesConfigData = {
      successRate: {
        enabled: successRateEnabled,
        threshold: parseFloat(failureRateThreshold),
        criticalThreshold: parseFloat(failureRateCriticalThreshold),
      },
      missingParams: {
        enabled: missingParamsEnabled,
        threshold: parseFloat(missingParamsThreshold),
        criticalThreshold: parseFloat(missingParamsCriticalThreshold),
        params: missingParamsToCheck,
      },
      volumeAnomaly: {
        enabled: volumeAnomalyEnabled,
        threshold: parseFloat(volumeDropThreshold),
        criticalThreshold: parseFloat(volumeDropCriticalThreshold),
        minVolume: parseInt(volumeMinEvents, 10),
        useZScore,
        zScoreThreshold: parseFloat(zScoreThreshold),
      },
    };

    if (onSave) {
      await onSave(config);
    }
  }, [
    successRateEnabled,
    failureRateThreshold,
    failureRateCriticalThreshold,
    missingParamsEnabled,
    missingParamsThreshold,
    missingParamsCriticalThreshold,
    missingParamsToCheck,
    volumeAnomalyEnabled,
    volumeDropThreshold,
    volumeDropCriticalThreshold,
    volumeMinEvents,
    useZScore,
    zScoreThreshold,
    onSave,
  ]);

  const handleTest = useCallback(async () => {
    const config: AlertRulesConfigData = {
      successRate: {
        enabled: successRateEnabled,
        threshold: parseFloat(failureRateThreshold),
        criticalThreshold: parseFloat(failureRateCriticalThreshold),
      },
      missingParams: {
        enabled: missingParamsEnabled,
        threshold: parseFloat(missingParamsThreshold),
        criticalThreshold: parseFloat(missingParamsCriticalThreshold),
        params: missingParamsToCheck,
      },
      volumeAnomaly: {
        enabled: volumeAnomalyEnabled,
        threshold: parseFloat(volumeDropThreshold),
        criticalThreshold: parseFloat(volumeDropCriticalThreshold),
        minVolume: parseInt(volumeMinEvents, 10),
        useZScore,
        zScoreThreshold: parseFloat(zScoreThreshold),
      },
    };

    if (onTest) {
      await onTest(config);
    }
  }, [
    successRateEnabled,
    failureRateThreshold,
    failureRateCriticalThreshold,
    missingParamsEnabled,
    missingParamsThreshold,
    missingParamsCriticalThreshold,
    missingParamsToCheck,
    volumeAnomalyEnabled,
    volumeDropThreshold,
    volumeDropCriticalThreshold,
    volumeMinEvents,
    useZScore,
    zScoreThreshold,
    onTest,
  ]);

  const getStatusBadge = useCallback((value: number | undefined, threshold: number, criticalThreshold: number) => {
    if (value === undefined) return null;
    if (value >= criticalThreshold) {
      return <Badge tone="critical">超过严重阈值</Badge>;
    }
    if (value >= threshold) {
      return <Badge tone="warning">超过阈值</Badge>;
    }
    return <Badge tone="success">正常</Badge>;
  }, []);

  return (
    <Card>
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            告警规则配置
          </Text>
          <InlineStack gap="200">
            <Button onClick={handleTest} disabled={isLoading}>
              测试告警
            </Button>
            <Button variant="primary" onClick={handleSave} loading={isLoading}>
              保存配置
            </Button>
          </InlineStack>
        </InlineStack>

        <Divider />

        <BlockStack gap="300">
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection("successRate")}
            onKeyDown={(e) => e.key === "Enter" && toggleSection("successRate")}
            style={{ cursor: "pointer" }}
          >
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  事件成功率/失败率告警
                </Text>
                {currentMetrics?.failureRate !== undefined && (
                  getStatusBadge(
                    currentMetrics.failureRate,
                    parseFloat(failureRateThreshold),
                    parseFloat(failureRateCriticalThreshold)
                  )
                )}
              </InlineStack>
              <Text as="span" tone="subdued">
                {expandedSections.successRate ? "▲ 收起" : "▼ 展开"}
              </Text>
            </InlineStack>
          </div>

          <Collapsible open={expandedSections.successRate} id="success-rate-config">
            <BlockStack gap="400">
              <Checkbox
                label="启用事件失败率告警"
                checked={successRateEnabled}
                onChange={setSuccessRateEnabled}
              />

              {successRateEnabled && (
                <BlockStack gap="300">
                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      失败率阈值: {failureRateThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(failureRateThreshold, 10)}
                      onChange={(value) => setFailureRateThreshold(String(value))}
                      min={0}
                      max={50}
                      step={1}
                      output
                    />
                  </Box>

                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      严重告警阈值: {failureRateCriticalThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(failureRateCriticalThreshold, 10)}
                      onChange={(value) => setFailureRateCriticalThreshold(String(value))}
                      min={parseInt(failureRateThreshold, 10)}
                      max={100}
                      step={1}
                      output
                    />
                  </Box>

                  {currentMetrics?.failureRate !== undefined && (
                    <Banner
                      tone={
                        currentMetrics.failureRate >= parseFloat(failureRateCriticalThreshold)
                          ? "critical"
                          : currentMetrics.failureRate >= parseFloat(failureRateThreshold)
                            ? "warning"
                            : "info"
                      }
                    >
                      <Text as="p" variant="bodySm">
                        当前失败率: {currentMetrics.failureRate.toFixed(2)}%
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Collapsible>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection("missingParams")}
            onKeyDown={(e) => e.key === "Enter" && toggleSection("missingParams")}
            style={{ cursor: "pointer" }}
          >
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  缺参率告警
                </Text>
                {currentMetrics?.missingParamsRate !== undefined && (
                  getStatusBadge(
                    currentMetrics.missingParamsRate,
                    parseFloat(missingParamsThreshold),
                    parseFloat(missingParamsCriticalThreshold)
                  )
                )}
              </InlineStack>
              <Text as="span" tone="subdued">
                {expandedSections.missingParams ? "▲ 收起" : "▼ 展开"}
              </Text>
            </InlineStack>
          </div>

          <Collapsible open={expandedSections.missingParams} id="missing-params-config">
            <BlockStack gap="400">
              <Checkbox
                label="启用缺参率告警"
                checked={missingParamsEnabled}
                onChange={setMissingParamsEnabled}
              />

              {missingParamsEnabled && (
                <BlockStack gap="300">
                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      缺参率阈值: {missingParamsThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(missingParamsThreshold, 10)}
                      onChange={(value) => setMissingParamsThreshold(String(value))}
                      min={0}
                      max={50}
                      step={1}
                      output
                    />
                  </Box>

                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      严重告警阈值: {missingParamsCriticalThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(missingParamsCriticalThreshold, 10)}
                      onChange={(value) => setMissingParamsCriticalThreshold(String(value))}
                      min={parseInt(missingParamsThreshold, 10)}
                      max={100}
                      step={1}
                      output
                    />
                  </Box>

                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      检测的参数
                    </Text>
                    <Checkbox
                      label="订单金额 (value)"
                      checked={missingParamsToCheck.includes("value")}
                      onChange={(checked) => {
                        setMissingParamsToCheck((prev) =>
                          checked ? [...prev, "value"] : prev.filter((p) => p !== "value")
                        );
                      }}
                    />
                    <Checkbox
                      label="货币代码 (currency)"
                      checked={missingParamsToCheck.includes("currency")}
                      onChange={(checked) => {
                        setMissingParamsToCheck((prev) =>
                          checked
                            ? [...prev, "currency"]
                            : prev.filter((p) => p !== "currency")
                        );
                      }}
                    />
                    <Checkbox
                      label="商品信息 (items)"
                      checked={missingParamsToCheck.includes("items")}
                      onChange={(checked) => {
                        setMissingParamsToCheck((prev) =>
                          checked ? [...prev, "items"] : prev.filter((p) => p !== "items")
                        );
                      }}
                    />
                    <Checkbox
                      label="事件 ID (event_id)"
                      checked={missingParamsToCheck.includes("event_id")}
                      onChange={(checked) => {
                        setMissingParamsToCheck((prev) =>
                          checked
                            ? [...prev, "event_id"]
                            : prev.filter((p) => p !== "event_id")
                        );
                      }}
                    />
                  </BlockStack>

                  {currentMetrics?.missingParamsRate !== undefined && (
                    <Banner
                      tone={
                        currentMetrics.missingParamsRate >= parseFloat(missingParamsCriticalThreshold)
                          ? "critical"
                          : currentMetrics.missingParamsRate >= parseFloat(missingParamsThreshold)
                            ? "warning"
                            : "info"
                      }
                    >
                      <Text as="p" variant="bodySm">
                        当前缺参率: {currentMetrics.missingParamsRate.toFixed(2)}%
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Collapsible>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleSection("volumeAnomaly")}
            onKeyDown={(e) => e.key === "Enter" && toggleSection("volumeAnomaly")}
            style={{ cursor: "pointer" }}
          >
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  事件量骤降告警
                </Text>
                {currentMetrics?.volumeDrop !== undefined && (
                  getStatusBadge(
                    Math.abs(currentMetrics.volumeDrop),
                    parseFloat(volumeDropThreshold),
                    parseFloat(volumeDropCriticalThreshold)
                  )
                )}
              </InlineStack>
              <Text as="span" tone="subdued">
                {expandedSections.volumeAnomaly ? "▲ 收起" : "▼ 展开"}
              </Text>
            </InlineStack>
          </div>

          <Collapsible open={expandedSections.volumeAnomaly} id="volume-anomaly-config">
            <BlockStack gap="400">
              <Checkbox
                label="启用事件量骤降告警"
                checked={volumeAnomalyEnabled}
                onChange={setVolumeAnomalyEnabled}
              />

              {volumeAnomalyEnabled && (
                <BlockStack gap="300">
                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      下降阈值: {volumeDropThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(volumeDropThreshold, 10)}
                      onChange={(value) => setVolumeDropThreshold(String(value))}
                      min={0}
                      max={100}
                      step={5}
                      output
                    />
                  </Box>

                  <Box paddingBlockStart="200">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      严重告警阈值: {volumeDropCriticalThreshold}%
                    </Text>
                    <RangeSlider
                      label=""
                      labelHidden
                      value={parseInt(volumeDropCriticalThreshold, 10)}
                      onChange={(value) => setVolumeDropCriticalThreshold(String(value))}
                      min={parseInt(volumeDropThreshold, 10)}
                      max={100}
                      step={5}
                      output
                    />
                  </Box>

                  <TextField
                    label="最小事件量（避免低流量误报）"
                    type="number"
                    value={volumeMinEvents}
                    onChange={setVolumeMinEvents}
                    helpText="低于此事件量时不触发告警"
                    autoComplete="off"
                  />

                  <Checkbox
                    label="使用 Z-Score 统计方法"
                    checked={useZScore}
                    onChange={setUseZScore}
                    helpText="使用统计学方法检测异常，更准确但需要足够的历史数据"
                  />

                  {useZScore && (
                    <TextField
                      label="Z-Score 阈值"
                      type="number"
                      value={zScoreThreshold}
                      onChange={setZScoreThreshold}
                      helpText="当 Z-Score 低于此值时触发告警（推荐: -2）"
                      autoComplete="off"
                    />
                  )}

                  {currentMetrics?.volumeDrop !== undefined && (
                    <Banner
                      tone={
                        Math.abs(currentMetrics.volumeDrop) >= parseFloat(volumeDropCriticalThreshold)
                          ? "critical"
                          : Math.abs(currentMetrics.volumeDrop) >= parseFloat(volumeDropThreshold)
                            ? "warning"
                            : "info"
                      }
                    >
                      <Text as="p" variant="bodySm">
                        当前事件量变化: {currentMetrics.volumeDrop.toFixed(2)}%
                      </Text>
                    </Banner>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Collapsible>
        </BlockStack>

        <Banner tone="info">
          <Text as="p" variant="bodySm">
            💡 提示：告警规则会在满足条件时通过您配置的通知渠道（邮箱、Slack、Telegram等）发送告警。
          </Text>
        </Banner>
      </BlockStack>
    </Card>
  );
}

