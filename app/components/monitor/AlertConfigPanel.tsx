

import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Checkbox,
  Banner,
  Divider,
  Box,
  Badge,
} from "@shopify/polaris";
import { SettingsIcon, AlertCircleIcon } from "~/components/icons";

interface MonitoringAlert {
  id: string;
  shopId: string;
  alertType: string;
  threshold: number | null;
  condition: Record<string, unknown> | null;
  isEnabled: boolean;
  lastTriggeredAt: Date | null;
  triggerCount: number;
  notificationChannels: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertConfigPanelProps {
  shopId: string;
  existingAlerts?: MonitoringAlert[];
  onSave?: (alert: {
    alertType: "failure_rate" | "missing_params" | "volume_drop";
    threshold: number;
    condition?: Record<string, unknown>;
  }) => Promise<void>;
  onDelete?: (alertId: string) => Promise<void>;
}

export function AlertConfigPanel({
  shopId,
  existingAlerts = [],
  onSave,
  onDelete,
}: AlertConfigPanelProps) {
  const [failureRateThreshold, setFailureRateThreshold] = useState("2.0");
  const [missingParamsThreshold, setMissingParamsThreshold] = useState("5.0");
  const [volumeDropThreshold, setVolumeDropThreshold] = useState("50");
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveFailureRate = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        alertType: "failure_rate",
        threshold: parseFloat(failureRateThreshold) || 2.0,
      });
    } finally {
      setIsSaving(false);
    }
  }, [onSave, failureRateThreshold]);

  const handleSaveMissingParams = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        alertType: "missing_params",
        threshold: parseFloat(missingParamsThreshold) || 5.0,
      });
    } finally {
      setIsSaving(false);
    }
  }, [onSave, missingParamsThreshold]);

  const handleSaveVolumeDrop = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        alertType: "volume_drop",
        threshold: parseFloat(volumeDropThreshold) || 50,
        condition: {
          dropPercentage: parseFloat(volumeDropThreshold) || 50,
        },
      });
    } finally {
      setIsSaving(false);
    }
  }, [onSave, volumeDropThreshold]);

  const failureRateAlert = existingAlerts.find((a) => a.alertType === "failure_rate");
  const missingParamsAlert = existingAlerts.find((a) => a.alertType === "missing_params");
  const volumeDropAlert = existingAlerts.find((a) => a.alertType === "volume_drop");

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">
              告警配置
            </Text>
            <Badge tone="info">{`${existingAlerts.length} 个告警已配置`}</Badge>
          </InlineStack>

          <Banner tone="info">
            <Text variant="bodySm" as="span">
              当指标超过阈值时，系统将自动发送告警通知（邮件/应用内）。
            </Text>
          </Banner>

          <Divider />

          <BlockStack gap="300">
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">
                  事件失败率告警
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  当事件失败率超过阈值时触发告警
                </Text>
              </BlockStack>
              {failureRateAlert && (
                <Badge tone={failureRateAlert.isEnabled ? "success" : undefined}>
                  {failureRateAlert.isEnabled ? "已启用" : "已禁用"}
                </Badge>
              )}
            </InlineStack>

            <InlineStack gap="200" blockAlign="end">
              <Box minWidth="200px">
                <TextField
                  label="阈值 (%)"
                  value={failureRateThreshold}
                  onChange={setFailureRateThreshold}
                  type="number"
                  suffix="%"
                  helpText="默认: 2.0%"
                  autoComplete="off"
                />
              </Box>
              <Button
                onClick={handleSaveFailureRate}
                loading={isSaving}
                variant="primary"
              >
                {failureRateAlert ? "更新" : "创建"}
              </Button>
            </InlineStack>
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">
                  Purchase 事件缺参率告警
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  当 Purchase 事件缺参率超过阈值时触发告警
                </Text>
              </BlockStack>
              {missingParamsAlert && (
                <Badge tone={missingParamsAlert.isEnabled ? "success" : undefined}>
                  {missingParamsAlert.isEnabled ? "已启用" : "已禁用"}
                </Badge>
              )}
            </InlineStack>

            <InlineStack gap="200" blockAlign="end">
              <Box minWidth="200px">
                <TextField
                  label="阈值 (%)"
                  value={missingParamsThreshold}
                  onChange={setMissingParamsThreshold}
                  type="number"
                  suffix="%"
                  helpText="默认: 5.0%"
                  autoComplete="off"
                />
              </Box>
              <Button
                onClick={handleSaveMissingParams}
                loading={isSaving}
                variant="primary"
              >
                {missingParamsAlert ? "更新" : "创建"}
              </Button>
            </InlineStack>
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3">
                  事件量骤降告警
                </Text>
                <Text variant="bodySm" as="span" tone="subdued">
                  当最近 24 小时事件量下降超过阈值时触发告警
                </Text>
              </BlockStack>
              {volumeDropAlert && (
                <Badge tone={volumeDropAlert.isEnabled ? "success" : undefined}>
                  {volumeDropAlert.isEnabled ? "已启用" : "已禁用"}
                </Badge>
              )}
            </InlineStack>

            <InlineStack gap="200" blockAlign="end">
              <Box minWidth="200px">
                <TextField
                  label="下降阈值 (%)"
                  value={volumeDropThreshold}
                  onChange={setVolumeDropThreshold}
                  type="number"
                  suffix="%"
                  helpText="默认: 50%"
                  autoComplete="off"
                />
              </Box>
              <Button
                onClick={handleSaveVolumeDrop}
                loading={isSaving}
                variant="primary"
              >
                {volumeDropAlert ? "更新" : "创建"}
              </Button>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

