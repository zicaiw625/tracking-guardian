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
import { useTranslation } from "react-i18next";
import type { AlertConfigDisplay } from "../types";

interface AlertsTabProps {
  alertConfigs: AlertConfigDisplay[];
  isSubmitting: boolean;
  alertChannelsEnabled?: boolean;
}

export function AlertsTab({ alertConfigs, isSubmitting, alertChannelsEnabled = false }: AlertsTabProps) {
  const { t } = useTranslation();
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
  const [validationError, setValidationError] = useState<string | null>(null);

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
    const email = newEmail.trim();
    const webhookUrl = newWebhookUrl.trim();
    const botToken = newBotToken.trim();
    const chatId = newChatId.trim();
    const safeThreshold = Math.max(1, Math.min(100, Number(newThreshold) || 10));
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isUniqueConfig = (channel: string, payload: Record<string, unknown>) =>
      !configs.some((existing) => {
        if (existing.channel !== channel) return false;
        return JSON.stringify(existing.settings || {}) === JSON.stringify(payload);
      });

    if (newChannel === "email") {
      if (!email || !emailPattern.test(email)) {
        setValidationError(t("settings.alerts.validation.invalidEmail", { defaultValue: "Please enter a valid email address." }));
        return;
      }
      settings = { email };
      if (!isUniqueConfig(newChannel, settings)) {
        setValidationError(t("settings.alerts.validation.duplicate", { defaultValue: "This alert channel configuration already exists." }));
        return;
      }
    } else if (newChannel === "slack") {
      const looksLikeHttps = /^https:\/\//i.test(webhookUrl);
      if (!webhookUrl || !looksLikeHttps) {
        setValidationError(t("settings.alerts.validation.invalidWebhook", { defaultValue: "Please enter a valid HTTPS webhook URL." }));
        return;
      }
      settings = { webhookUrl };
      if (!isUniqueConfig(newChannel, settings)) {
        setValidationError(t("settings.alerts.validation.duplicate", { defaultValue: "This alert channel configuration already exists." }));
        return;
      }
    } else if (newChannel === "telegram") {
      if (!botToken || !chatId) {
        setValidationError(t("settings.alerts.validation.invalidTelegram", { defaultValue: "Please provide bot token and chat ID." }));
        return;
      }
      settings = { botToken, chatId };
      if (!isUniqueConfig(newChannel, settings)) {
        setValidationError(t("settings.alerts.validation.duplicate", { defaultValue: "This alert channel configuration already exists." }));
        return;
      }
    }
    setValidationError(null);
    setConfigs((prev) => [
      ...prev,
      {
        id,
        channel: newChannel,
        settings,
        discrepancyThreshold: safeThreshold,
        isEnabled: true,
      },
    ]);
    setNewEmail("");
    setNewWebhookUrl("");
    setNewBotToken("");
    setNewChatId("");
    setNewThreshold(10);
  }, [configs, newBotToken, newChannel, newChatId, newEmail, newThreshold, newWebhookUrl, t]);

  const channelOptions = [
    { label: t("settings.alerts.channels.email"), value: "email" },
    { label: t("settings.alerts.channels.slack"), value: "slack" },
    { label: t("settings.alerts.channels.telegram"), value: "telegram" },
  ];

  return (
    <BlockStack gap="400">
      {!alertChannelsEnabled && (
        <Banner tone="warning" title={t("settings.alerts.banner.title")}>
          <Text as="p" variant="bodySm">
            {t("settings.alerts.banner.content")}
          </Text>
        </Banner>
      )}
      <Card>
        <BlockStack gap="400">
          {validationError && (
            <Banner tone="critical">
              <Text as="p" variant="bodySm">{validationError}</Text>
            </Banner>
          )}
          <Text as="h2" variant="headingMd">{t("settings.alerts.title")}</Text>
          <Text as="p" tone="subdued">
            {t("settings.alerts.description")}
          </Text>
          {configs.length > 0 ? (
            <BlockStack gap="300">
              {configs.map((c) => (
                <Box key={c.id} paddingBlockStart="200" paddingBlockEnd="200">
                  <InlineStack align="space-between" blockAlign="center" gap="400">
                    <InlineStack gap="200">
                      <Text as="span" variant="bodyMd">{c.channel}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("settings.alerts.threshold")} {c.discrepancyThreshold}% · {c.isEnabled ? t("common.enabled") : t("common.disabled")}
                      </Text>
                    </InlineStack>
                    <Button
                      variant="plain"
                      tone="critical"
                      onClick={() => handleRemove(c.id)}
                      disabled={isSubmitting}
                    >
                      {t("common.delete")}
                    </Button>
                  </InlineStack>
                  <Divider />
                </Box>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">{t("settings.alerts.empty")}</Text>
          )}
          <Divider />
          <Text as="h3" variant="headingSm">{t("settings.alerts.addChannel")}</Text>
          <Select
            label={t("settings.alerts.channelType")}
            options={channelOptions}
            value={newChannel}
            onChange={setNewChannel}
          />
          {newChannel === "email" && (
            <TextField
              label={t("settings.alerts.email")}
              value={newEmail}
              onChange={setNewEmail}
              type="email"
              autoComplete="email"
            />
          )}
          {newChannel === "slack" && (
            <TextField
              label={t("settings.alerts.webhookUrl")}
              value={newWebhookUrl}
              onChange={setNewWebhookUrl}
              type="url"
              autoComplete="off"
            />
          )}
          {newChannel === "telegram" && (
            <BlockStack gap="300">
              <TextField
                label={t("settings.alerts.botToken")}
                value={newBotToken}
                onChange={setNewBotToken}
                autoComplete="off"
              />
              <TextField
                label={t("settings.alerts.chatId")}
                value={newChatId}
                onChange={setNewChatId}
                autoComplete="off"
              />
            </BlockStack>
          )}
          <TextField
            label={t("settings.alerts.discrepancyThreshold")}
            type="number"
            value={String(newThreshold)}
            onChange={(v) => setNewThreshold(parseInt(v, 10) || 10)}
            min={1}
            max={100}
            autoComplete="off"
          />
          <InlineStack gap="300">
            <Button onClick={handleAdd} disabled={isSubmitting}>{t("common.add")}</Button>
            <Button variant="primary" onClick={handleSave} loading={isSubmitting}>{t("settings.alerts.saveConfig")}</Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
