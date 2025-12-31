

import {
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Select,
  Checkbox,
  Divider,
  Badge,
  Box,
  List,
} from "@shopify/polaris";
import { EnhancedEmptyState } from "~/components/ui";
import { ThresholdSlider } from "~/components/settings/ThresholdSlider";
import { ThresholdConfigCard, type ThresholdConfig } from "~/components/settings/ThresholdConfigCard";
import type { AlertConfigDisplay } from "../types";
import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";

interface AlertsTabProps {
  shop: {
    alertConfigs: AlertConfigDisplay[];
  } | null;
  alertChannel: string;
  setAlertChannel: (value: string) => void;
  alertEmail: string;
  setAlertEmail: (value: string) => void;
  slackWebhook: string;
  setSlackWebhook: (value: string) => void;
  telegramToken: string;
  setTelegramToken: (value: string) => void;
  telegramChatId: string;
  setTelegramChatId: (value: string) => void;
  alertThreshold: string;
  setAlertThreshold: (value: string) => void;
  alertEnabled: boolean;
  setAlertEnabled: (value: boolean) => void;
  alertFormDirty: boolean;
  isSubmitting: boolean;
  onSaveAlert: () => void;
  onTestAlert: () => void;

  failureRateThreshold?: string;
  setFailureRateThreshold?: (value: string) => void;
  missingParamsThreshold?: string;
  setMissingParamsThreshold?: (value: string) => void;
  volumeDropThreshold?: string;
  setVolumeDropThreshold?: (value: string) => void;

  alertFrequency?: string;
  setAlertFrequency?: (value: string) => void;

  currentMonitoringData?: {
    failureRate: number;
    missingParamsRate: number;
    volumeDrop: number;
  } | null;
}

export function AlertsTab({
  shop,
  alertChannel,
  setAlertChannel,
  alertEmail,
  setAlertEmail,
  slackWebhook,
  setSlackWebhook,
  telegramToken,
  setTelegramToken,
  telegramChatId,
  setTelegramChatId,
  alertThreshold,
  setAlertThreshold,
  alertEnabled,
  setAlertEnabled,
  alertFormDirty,
  isSubmitting,
  onSaveAlert,
  onTestAlert,
  failureRateThreshold = "2",
  setFailureRateThreshold = () => {},
  missingParamsThreshold = "5",
  setMissingParamsThreshold = () => {},
  volumeDropThreshold = "50",
  setVolumeDropThreshold = () => {},
  alertFrequency = "daily",
  setAlertFrequency = () => {},
  currentMonitoringData,
}: AlertsTabProps) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              警报通知设置
            </Text>
            <Text as="p" tone="subdued">
              当追踪数据出现异常时，我们会通过您配置的渠道发送警报。
            </Text>

            <Divider />

            <Select
              label="通知渠道"
              options={[
                { label: "邮件", value: "email" },
                { label: "Slack", value: "slack" },
                { label: "Telegram", value: "telegram" },
              ]}
              value={alertChannel}
              onChange={setAlertChannel}
            />

            {alertChannel === "email" && (
              <TextField
                label="邮箱地址"
                type="email"
                value={alertEmail}
                onChange={setAlertEmail}
                autoComplete="email"
                placeholder="your@email.com"
              />
            )}

            {alertChannel === "slack" && (
              <TextField
                label="Slack Webhook URL"
                value={slackWebhook}
                onChange={setSlackWebhook}
                autoComplete="off"
                placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
                helpText="在 Slack 中创建 Incoming Webhook 获取此 URL"
              />
            )}

            {alertChannel === "telegram" && (
              <>
                <TextField
                  label="Bot Token"
                  value={telegramToken}
                  onChange={setTelegramToken}
                  autoComplete="off"
                  placeholder="123456:ABC-DEF1234ghIkl..."
                  helpText="通过 @BotFather 创建 Bot 获取"
                />
                <TextField
                  label="Chat ID"
                  value={telegramChatId}
                  onChange={setTelegramChatId}
                  autoComplete="off"
                  placeholder="-1001234567890"
                  helpText="群组或频道的 Chat ID"
                />
              </>
            )}

            <Divider />

            <Text as="h3" variant="headingSm">
              告警规则配置
            </Text>

            <BlockStack gap="400">
              <ThresholdConfigCard
                config={{
                  type: "failure_rate",
                  label: "事件失败率阈值",
                  value: parseFloat(failureRateThreshold) || 2,
                  min: 0,
                  max: 50,
                  step: 0.5,
                  unit: "%",
                  helpText: "当事件发送失败率超过此百分比时触发警报（推荐: 2-5%）",
                  recommendedValue: 2,
                  currentValue: currentMonitoringData?.failureRate,
                  colorRanges: [
                    { min: 0, max: 2, tone: "success" },
                    { min: 2, max: 10, tone: "warning" },
                    { min: 10, max: 50, tone: "critical" },
                  ],
                }}
                onChange={(val) => setFailureRateThreshold(String(val))}
                showPreview={true}
                showRecommendation={true}
              />

              <Divider />

              <ThresholdConfigCard
                config={{
                  type: "missing_params",
                  label: "缺参率阈值",
                  value: parseFloat(missingParamsThreshold) || 5,
                  min: 0,
                  max: 50,
                  step: 0.5,
                  unit: "%",
                  helpText: "当事件参数缺失率超过此百分比时触发警报（推荐: 5-10%）",
                  recommendedValue: 5,
                  currentValue: currentMonitoringData?.missingParamsRate,
                  colorRanges: [
                    { min: 0, max: 5, tone: "success" },
                    { min: 5, max: 10, tone: "warning" },
                    { min: 10, max: 50, tone: "critical" },
                  ],
                }}
                onChange={(val) => setMissingParamsThreshold(String(val))}
                showPreview={true}
                showRecommendation={true}
              />

              <Divider />

              <ThresholdConfigCard
                config={{
                  type: "volume_drop",
                  label: "事件量骤降阈值",
                  value: parseFloat(volumeDropThreshold) || 50,
                  min: 0,
                  max: 100,
                  step: 5,
                  unit: "%",
                  helpText: "当 24 小时内事件量下降超过此百分比时触发警报（推荐: 50%）",
                  recommendedValue: 50,
                  currentValue: currentMonitoringData?.volumeDrop,
                  colorRanges: [
                    { min: 0, max: 30, tone: "success" },
                    { min: 30, max: 70, tone: "warning" },
                    { min: 70, max: 100, tone: "critical" },
                  ],
                }}
                onChange={(val) => setVolumeDropThreshold(String(val))}
                showPreview={true}
                showRecommendation={true}
              />

              <Divider />

              <Text as="h4" variant="headingSm" tone="subdued">
                告警频率配置
              </Text>

              <Select
                label="告警频率"
                options={[
                  { label: "即时通知", value: "instant" },
                  { label: "每日汇总", value: "daily" },
                  { label: "每周汇总", value: "weekly" },
                ]}
                value={alertFrequency}
                onChange={(value) => setAlertFrequency(value)}
                helpText="选择告警通知的频率。即时通知会在检测到异常时立即发送，汇总模式会在指定时间发送所有告警的汇总报告。"
              />
            </BlockStack>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  支持的告警类型：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>事件失败率</strong> - 当发送失败率超过阈值时告警（默认 2%）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>参数缺失率</strong> - 当 Purchase 事件缺参率超过阈值时告警（默认 10%）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>事件量骤降</strong> - 当 24h 内事件量下降超过 50% 时告警
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>去重冲突</strong> - 当检测到重复事件 ID 时告警（默认 5 次）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      <strong>像素心跳丢失</strong> - 当超过 24 小时未收到像素心跳时告警
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
            </Box>

            <Checkbox
              label="启用警报通知"
              checked={alertEnabled}
              onChange={setAlertEnabled}
            />

            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={onSaveAlert}
                loading={isSubmitting}
                disabled={!alertFormDirty}
              >
                保存设置
              </Button>
              <Button
                variant="secondary"
                onClick={onTestAlert}
                loading={isSubmitting}
                disabled={alertFormDirty}
              >
                发送测试通知
              </Button>
            </InlineStack>
            {alertFormDirty && (
              <Text as="p" variant="bodySm" tone="caution">
                请先保存设置后再发送测试通知
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">
              已配置的警报
            </Text>
            {shop?.alertConfigs && shop.alertConfigs.length > 0 ? (
              shop.alertConfigs.map((config) => (
                <Box
                  key={config.id}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <InlineStack align="space-between">
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {config.channel === "email"
                          ? "邮件"
                          : config.channel === "slack"
                            ? "Slack"
                            : "Telegram"}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        阈值: {(config.discrepancyThreshold * 100).toFixed(0)}%
                      </Text>
                    </BlockStack>
                    <Badge tone={config.isEnabled ? "success" : "info"}>
                      {config.isEnabled ? "已启用" : "已禁用"}
                    </Badge>
                  </InlineStack>
                </Box>
              ))
            ) : (
              <EnhancedEmptyState
                icon="🔔"
                title="尚未配置警报"
                description="配置警报通知后，当追踪数据出现异常时会收到通知。"
                helpText="在上方表单中填写通知渠道信息并保存即可配置。"
              />
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

