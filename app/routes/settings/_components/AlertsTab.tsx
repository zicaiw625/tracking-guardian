

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
} from "@shopify/polaris";
import type { AlertConfigDisplay } from "../types";

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
                placeholder="https://hooks.slack.com/services/..."
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

            <TextField
              label="警报阈值 (%)"
              type="number"
              value={alertThreshold}
              onChange={setAlertThreshold}
              autoComplete="off"
              helpText="当差异率超过此百分比时触发警报"
              suffix="%"
            />

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
              <Text as="p" tone="subdued">
                尚未配置警报
              </Text>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

