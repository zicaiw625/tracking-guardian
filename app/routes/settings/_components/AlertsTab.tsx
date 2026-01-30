import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  TextField,
  Box,
  Divider,
  Banner,
} from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import type { AlertConfigDisplay } from "../types";

interface AlertsTabProps {
  alertConfigs: AlertConfigDisplay[];
  isSubmitting: boolean;
  alertChannelsEnabled?: boolean;
}

export function AlertsTab({ alertConfigs, isSubmitting, alertChannelsEnabled = false }: AlertsTabProps) {
  const submit = useSubmit();
  const [configs, setConfigs] = useState<AlertConfigDisplay[]>(alertConfigs);
  useEffect(() => {
    setConfigs(alertConfigs);
  }, [alertConfigs]);
  const [newChannel, setNewChannel] = useState<string>("email");
  const [newEmail, setNewEmail] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newBotToken, setNewBotToken] = useState("");
  const [newChatId, setNewChatId] = useState("");
  const [newThreshold, setNewThreshold] = useState(10);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "saveAlertConfigs");
    formData.append("alertConfigs", JSON.stringify(configs));
    submit(formData, { method: "post" });
  }, [configs, submit]);

  const handleRemove = useCallback((id: string) => {
    setConfigs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleAdd = useCallback(() => {
    const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    let settings: Record<string, unknown> | null = null;
    if (newChannel === "email") {
      if (!newEmail.trim()) return;
      settings = { email: newEmail.trim() };
    } else if (newChannel === "slack") {
      if (!newWebhookUrl.trim()) return;
      settings = { webhookUrl: newWebhookUrl.trim() };
    } else if (newChannel === "telegram") {
      if (!newBotToken.trim() || !newChatId.trim()) return;
      settings = { botToken: newBotToken.trim(), chatId: newChatId.trim() };
    }
    setConfigs((prev) => [
      ...prev,
      {
        id,
        channel: newChannel,
        settings,
        discrepancyThreshold: newThreshold,
        isEnabled: true,
      },
    ]);
    setNewEmail("");
    setNewWebhookUrl("");
    setNewBotToken("");
    setNewChatId("");
    setNewThreshold(10);
  }, [newChannel, newEmail, newWebhookUrl, newBotToken, newChatId, newThreshold]);

  const channelOptions = [
    { label: "Email", value: "email" },
    { label: "Slack", value: "slack" },
    { label: "Telegram", value: "telegram" },
  ];

  return (
    <BlockStack gap="400">
      {!alertChannelsEnabled && (
        <Banner tone="warning" title="外发通知已关闭">
          <Text as="p" variant="bodySm">
            当前版本外发通知（Slack/Telegram/Email）已关闭，仅应用内告警记录生效。如需开启请联系支持或等待后续版本。
          </Text>
        </Banner>
      )}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">告警配置</Text>
          <Text as="p" tone="subdued">
            配置告警通道与阈值；当断档或异常触发时将写入告警记录，并可在 Monitoring 页面查看。
          </Text>
          {configs.length > 0 ? (
            <BlockStack gap="300">
              {configs.map((c) => (
                <Box key={c.id} paddingBlockStart="200" paddingBlockEnd="200">
                  <InlineStack align="space-between" blockAlign="center" gap="400">
                    <InlineStack gap="200">
                      <Text as="span" variant="bodyMd">{c.channel}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        阈值 {c.discrepancyThreshold}% · {c.isEnabled ? "启用" : "禁用"}
                      </Text>
                    </InlineStack>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={() => handleRemove(c.id)}
                      disabled={isSubmitting}
                    >
                      删除
                    </Button>
                  </InlineStack>
                  <Divider />
                </Box>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">暂无告警通道，请添加。</Text>
          )}
          <Divider />
          <Text as="h3" variant="headingSm">添加告警通道</Text>
          <Select
            label="通道类型"
            options={channelOptions}
            value={newChannel}
            onChange={setNewChannel}
          />
          {newChannel === "email" && (
            <TextField
              label="邮箱"
              value={newEmail}
              onChange={setNewEmail}
              type="email"
              autoComplete="email"
            />
          )}
          {newChannel === "slack" && (
            <TextField
              label="Webhook URL"
              value={newWebhookUrl}
              onChange={setNewWebhookUrl}
              type="url"
              autoComplete="off"
            />
          )}
          {newChannel === "telegram" && (
            <BlockStack gap="300">
              <TextField
                label="Bot Token"
                value={newBotToken}
                onChange={setNewBotToken}
                autoComplete="off"
              />
              <TextField
                label="Chat ID"
                value={newChatId}
                onChange={setNewChatId}
                autoComplete="off"
              />
            </BlockStack>
          )}
          <TextField
            label="对账差异阈值（%）"
            type="number"
            value={String(newThreshold)}
            onChange={(v) => setNewThreshold(parseInt(v, 10) || 10)}
            min={1}
            max={100}
            autoComplete="off"
          />
          <InlineStack gap="300">
            <Button onClick={handleAdd} disabled={isSubmitting}>添加</Button>
            <Button variant="primary" onClick={handleSave} loading={isSubmitting}>保存告警配置</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
