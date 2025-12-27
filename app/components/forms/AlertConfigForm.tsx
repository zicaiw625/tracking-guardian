

import { BlockStack, TextField, Select, Checkbox } from "@shopify/polaris";

export type AlertChannel = "email" | "slack" | "telegram";

export interface AlertConfig {
  channel: AlertChannel;
  email?: string;
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
  threshold: string;
  enabled: boolean;
}

export interface AlertConfigFormProps {

  values: AlertConfig;

  onChange: (values: AlertConfig) => void;

  errors?: Record<string, string>;

  disabled?: boolean;
}

export function AlertConfigForm({
  values,
  onChange,
  errors,
  disabled,
}: AlertConfigFormProps) {
  const handleChannelChange = (channel: string) => {
    onChange({
      ...values,
      channel: channel as AlertChannel,
    });
  };

  return (
    <BlockStack gap="300">
      <Select
        label="通知渠道"
        options={[
          { label: "邮件", value: "email" },
          { label: "Slack", value: "slack" },
          { label: "Telegram", value: "telegram" },
        ]}
        value={values.channel}
        onChange={handleChannelChange}
        disabled={disabled}
      />

      {values.channel === "email" && (
        <TextField
          label="邮箱地址"
          type="email"
          value={values.email || ""}
          onChange={(v) => onChange({ ...values, email: v })}
          autoComplete="email"
          placeholder="your@email.com"
          error={errors?.email}
          disabled={disabled}
        />
      )}

      {values.channel === "slack" && (
        <TextField
          label="Slack Webhook URL"
          value={values.webhookUrl || ""}
          onChange={(v) => onChange({ ...values, webhookUrl: v })}
          autoComplete="off"
          placeholder="https://hooks.slack.com/services/..."
          helpText="在 Slack 中创建 Incoming Webhook 获取此 URL"
          error={errors?.webhookUrl}
          disabled={disabled}
        />
      )}

      {values.channel === "telegram" && (
        <>
          <TextField
            label="Bot Token"
            value={values.botToken || ""}
            onChange={(v) => onChange({ ...values, botToken: v })}
            autoComplete="off"
            placeholder="123456:ABC-DEF1234ghIkl..."
            helpText="通过 @BotFather 创建 Bot 获取"
            error={errors?.botToken}
            disabled={disabled}
          />
          <TextField
            label="Chat ID"
            value={values.chatId || ""}
            onChange={(v) => onChange({ ...values, chatId: v })}
            autoComplete="off"
            placeholder="-1001234567890"
            helpText="群组或频道的 Chat ID"
            error={errors?.chatId}
            disabled={disabled}
          />
        </>
      )}

      <TextField
        label="警报阈值 (%)"
        type="number"
        value={values.threshold}
        onChange={(v) => onChange({ ...values, threshold: v })}
        autoComplete="off"
        helpText="当差异率超过此百分比时触发警报"
        suffix="%"
        error={errors?.threshold}
        disabled={disabled}
      />

      <Checkbox
        label="启用警报通知"
        checked={values.enabled}
        onChange={(v) => onChange({ ...values, enabled: v })}
        disabled={disabled}
      />
    </BlockStack>
  );
}

export function getDefaultAlertConfig(): AlertConfig {
  return {
    channel: "email",
    email: "",
    webhookUrl: "",
    botToken: "",
    chatId: "",
    threshold: "10",
    enabled: true,
  };
}

export function isAlertConfigValid(config: AlertConfig): boolean {
  switch (config.channel) {
    case "email":
      return Boolean(config.email && config.email.includes("@"));
    case "slack":
      return Boolean(
        config.webhookUrl?.startsWith("https://hooks.slack.com/")
      );
    case "telegram":
      return Boolean(config.botToken && config.chatId);
  }
}

export function getChannelSettings(
  config: AlertConfig
): Record<string, string> {
  switch (config.channel) {
    case "email":
      return { email: config.email || "" };
    case "slack":
      return { webhookUrl: config.webhookUrl || "" };
    case "telegram":
      return {
        botToken: config.botToken || "",
        chatId: config.chatId || "",
      };
  }
}

export default AlertConfigForm;

