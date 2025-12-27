/**
 * Settings Route
 *
 * Main settings page with tabbed navigation.
 * Refactored from the original monolithic app.settings.tsx file.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, ContextualSaveBar } from "@shopify/polaris";

import { settingsLoader } from "./loader.server";
import { settingsAction } from "./actions.server";
import type { SettingsActionResponse } from "./types";
import {
  AlertsTab,
  ServerTrackingTab,
  SecurityTab,
  SubscriptionTab,
} from "./_components";

// =============================================================================
// Exports
// =============================================================================

export const loader = settingsLoader;
export const action = settingsAction;

// =============================================================================
// Component
// =============================================================================

export default function SettingsPage() {
  const { shop, tokenIssues, pcdApproved, pcdStatusMessage } =
    useLoaderData<typeof settingsLoader>();
  const actionData = useActionData<SettingsActionResponse>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // Compute initial values from loader data
  const existingAlertConfig = shop?.alertConfigs?.[0];
  const existingPixelConfig = shop?.pixelConfigs?.[0];

  // Tab state
  const [selectedTab, setSelectedTab] = useState(0);

  // Alert form state - initialize from loader data
  const [alertChannel, setAlertChannel] = useState(() => existingAlertConfig?.channel || "email");
  const [alertEmail, setAlertEmail] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [alertThreshold, setAlertThreshold] = useState(() => 
    existingAlertConfig ? String(Math.round(existingAlertConfig.discrepancyThreshold * 100)) : "10"
  );
  const [alertEnabled, setAlertEnabled] = useState(() => existingAlertConfig?.isEnabled ?? true);

  // Server-side form state - initialize from loader data
  const [serverPlatform, setServerPlatform] = useState(() => existingPixelConfig?.platform || "meta");
  const [serverEnabled, setServerEnabled] = useState(() => existingPixelConfig?.serverSideEnabled ?? false);
  // Initialize platform IDs from existing config based on platform type
  const [metaPixelId, setMetaPixelId] = useState(() => 
    existingPixelConfig?.platform === "meta" ? (existingPixelConfig.platformId || "") : ""
  );
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestCode, setMetaTestCode] = useState("");
  const [googleMeasurementId, setGoogleMeasurementId] = useState(() =>
    existingPixelConfig?.platform === "google" ? (existingPixelConfig.platformId || "") : ""
  );
  const [googleApiSecret, setGoogleApiSecret] = useState("");
  const [tiktokPixelId, setTiktokPixelId] = useState(() =>
    existingPixelConfig?.platform === "tiktok" ? (existingPixelConfig.platformId || "") : ""
  );
  const [tiktokAccessToken, setTiktokAccessToken] = useState("");

  // Form dirty state
  const [alertFormDirty, setAlertFormDirty] = useState(false);
  const [serverFormDirty, setServerFormDirty] = useState(false);

  // Initial values refs - computed from loader data
  const initialAlertValues = useRef({
    channel: existingAlertConfig?.channel || "email",
    email: "",
    slackWebhook: "",
    telegramToken: "",
    telegramChatId: "",
    threshold: existingAlertConfig ? String(Math.round(existingAlertConfig.discrepancyThreshold * 100)) : "10",
    enabled: existingAlertConfig?.isEnabled ?? true,
  });

  const initialServerValues = useRef({
    platform: existingPixelConfig?.platform || "meta",
    enabled: existingPixelConfig?.serverSideEnabled ?? false,
    metaPixelId: existingPixelConfig?.platform === "meta" ? (existingPixelConfig.platformId || "") : "",
    metaAccessToken: "",
    metaTestCode: "",
    googleMeasurementId: existingPixelConfig?.platform === "google" ? (existingPixelConfig.platformId || "") : "",
    googleApiSecret: "",
    tiktokPixelId: existingPixelConfig?.platform === "tiktok" ? (existingPixelConfig.platformId || "") : "",
    tiktokAccessToken: "",
  });

  const isSubmitting = navigation.state === "submitting";

  // Check form dirty state
  const checkAlertFormDirty = useCallback(() => {
    const initial = initialAlertValues.current;
    const isDirty =
      alertChannel !== initial.channel ||
      alertEmail !== initial.email ||
      slackWebhook !== initial.slackWebhook ||
      telegramToken !== initial.telegramToken ||
      telegramChatId !== initial.telegramChatId ||
      alertThreshold !== initial.threshold ||
      alertEnabled !== initial.enabled;
    setAlertFormDirty(isDirty);
  }, [
    alertChannel,
    alertEmail,
    slackWebhook,
    telegramToken,
    telegramChatId,
    alertThreshold,
    alertEnabled,
  ]);

  const checkServerFormDirty = useCallback(() => {
    const initial = initialServerValues.current;
    const isDirty =
      serverPlatform !== initial.platform ||
      serverEnabled !== initial.enabled ||
      metaPixelId !== initial.metaPixelId ||
      metaAccessToken !== initial.metaAccessToken ||
      metaTestCode !== initial.metaTestCode ||
      googleMeasurementId !== initial.googleMeasurementId ||
      googleApiSecret !== initial.googleApiSecret ||
      tiktokPixelId !== initial.tiktokPixelId ||
      tiktokAccessToken !== initial.tiktokAccessToken;
    setServerFormDirty(isDirty);
  }, [
    serverPlatform,
    serverEnabled,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
  ]);

  // Effects
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedTab === 0) {
        checkAlertFormDirty();
      } else if (selectedTab === 1) {
        checkServerFormDirty();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedTab, checkAlertFormDirty, checkServerFormDirty]);

  // Reset form dirty state after successful save
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      const timer = setTimeout(() => {
        if (selectedTab === 0) {
          initialAlertValues.current = {
            channel: alertChannel,
            email: alertEmail,
            slackWebhook: slackWebhook,
            telegramToken: telegramToken,
            telegramChatId: telegramChatId,
            threshold: alertThreshold,
            enabled: alertEnabled,
          };
          setAlertFormDirty(false);
        } else if (selectedTab === 1) {
          initialServerValues.current = {
            platform: serverPlatform,
            enabled: serverEnabled,
            metaPixelId: metaPixelId,
            metaAccessToken: metaAccessToken,
            metaTestCode: metaTestCode,
            googleMeasurementId: googleMeasurementId,
            googleApiSecret: googleApiSecret,
            tiktokPixelId: tiktokPixelId,
            tiktokAccessToken: tiktokAccessToken,
          };
          setServerFormDirty(false);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [
    actionData,
    selectedTab,
    alertChannel,
    alertEmail,
    slackWebhook,
    telegramToken,
    telegramChatId,
    alertThreshold,
    alertEnabled,
    serverPlatform,
    serverEnabled,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
  ]);

  // Handlers
  const handleDiscardChanges = useCallback(() => {
    if (selectedTab === 0) {
      const initial = initialAlertValues.current;
      setAlertChannel(initial.channel);
      setAlertEmail(initial.email);
      setSlackWebhook(initial.slackWebhook);
      setTelegramToken(initial.telegramToken);
      setTelegramChatId(initial.telegramChatId);
      setAlertThreshold(initial.threshold);
      setAlertEnabled(initial.enabled);
      setAlertFormDirty(false);
    } else if (selectedTab === 1) {
      const initial = initialServerValues.current;
      setServerPlatform(initial.platform);
      setServerEnabled(initial.enabled);
      setMetaPixelId(initial.metaPixelId);
      setMetaAccessToken(initial.metaAccessToken);
      setMetaTestCode(initial.metaTestCode);
      setGoogleMeasurementId(initial.googleMeasurementId);
      setGoogleApiSecret(initial.googleApiSecret);
      setTiktokPixelId(initial.tiktokPixelId);
      setTiktokAccessToken(initial.tiktokAccessToken);
      setServerFormDirty(false);
    }
  }, [selectedTab]);

  const handleSaveAlert = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "saveAlert");
    formData.append("channel", alertChannel);
    formData.append("threshold", alertThreshold);
    formData.append("enabled", alertEnabled.toString());

    if (alertChannel === "email") {
      formData.append("email", alertEmail);
    } else if (alertChannel === "slack") {
      formData.append("webhookUrl", slackWebhook);
    } else if (alertChannel === "telegram") {
      formData.append("botToken", telegramToken);
      formData.append("chatId", telegramChatId);
    }

    submit(formData, { method: "post" });
  }, [
    alertChannel,
    alertEmail,
    slackWebhook,
    telegramToken,
    telegramChatId,
    alertThreshold,
    alertEnabled,
    submit,
  ]);

  const handleTestAlert = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "testAlert");
    formData.append("channel", alertChannel);

    if (alertChannel === "email") {
      formData.append("email", alertEmail);
    } else if (alertChannel === "slack") {
      formData.append("webhookUrl", slackWebhook);
    } else if (alertChannel === "telegram") {
      formData.append("botToken", telegramToken);
      formData.append("chatId", telegramChatId);
    }

    submit(formData, { method: "post" });
  }, [alertChannel, alertEmail, slackWebhook, telegramToken, telegramChatId, submit]);

  const handleSaveServerSide = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "saveServerSide");
    formData.append("platform", serverPlatform);
    formData.append("enabled", serverEnabled.toString());

    if (serverPlatform === "meta") {
      formData.append("pixelId", metaPixelId);
      formData.append("accessToken", metaAccessToken);
      formData.append("testEventCode", metaTestCode);
    } else if (serverPlatform === "google") {
      formData.append("measurementId", googleMeasurementId);
      formData.append("apiSecret", googleApiSecret);
    } else if (serverPlatform === "tiktok") {
      formData.append("pixelId", tiktokPixelId);
      formData.append("accessToken", tiktokAccessToken);
    }

    submit(formData, { method: "post" });
  }, [
    serverPlatform,
    serverEnabled,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    submit,
  ]);

  const handleTestConnection = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "testConnection");
    formData.append("platform", serverPlatform);

    if (serverPlatform === "meta") {
      formData.append("pixelId", metaPixelId);
      formData.append("accessToken", metaAccessToken);
      formData.append("testEventCode", metaTestCode);
    }

    submit(formData, { method: "post" });
  }, [serverPlatform, metaPixelId, metaAccessToken, metaTestCode, submit]);

  const handleRotateSecret = useCallback(() => {
    const message = shop?.hasIngestionSecret
      ? "确定要更换关联令牌吗？更换后 Web Pixel 将自动更新。"
      : "确定要生成关联令牌吗？";

    if (confirm(message)) {
      const formData = new FormData();
      formData.append("_action", "rotateIngestionSecret");
      submit(formData, { method: "post" });
    }
  }, [shop?.hasIngestionSecret, submit]);

  const handleSaveBarSave = useCallback(() => {
    if (selectedTab === 0) {
      handleSaveAlert();
    } else if (selectedTab === 1) {
      handleSaveServerSide();
    }
  }, [selectedTab, handleSaveAlert, handleSaveServerSide]);

  // Tab configuration
  const tabs = [
    { id: "alerts", content: "警报通知" },
    { id: "server-side", content: "服务端追踪" },
    { id: "security", content: "安全与隐私" },
    { id: "subscription", content: "订阅计划" },
  ];

  const showSaveBar =
    (selectedTab === 0 && alertFormDirty) ||
    (selectedTab === 1 && serverFormDirty);

  return (
    <Page title="设置">
      {showSaveBar && (
        <ContextualSaveBar
          message="未保存的更改"
          saveAction={{
            content: "保存",
            onAction: handleSaveBarSave,
            loading: isSubmitting,
          }}
          discardAction={{
            content: "放弃",
            onAction: handleDiscardChanges,
          }}
        />
      )}

      <BlockStack gap="500">
        {actionData && "message" in actionData && (
          <Banner
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            {actionData.message}
          </Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 && (
            <AlertsTab
              shop={shop}
              alertChannel={alertChannel}
              setAlertChannel={setAlertChannel}
              alertEmail={alertEmail}
              setAlertEmail={setAlertEmail}
              slackWebhook={slackWebhook}
              setSlackWebhook={setSlackWebhook}
              telegramToken={telegramToken}
              setTelegramToken={setTelegramToken}
              telegramChatId={telegramChatId}
              setTelegramChatId={setTelegramChatId}
              alertThreshold={alertThreshold}
              setAlertThreshold={setAlertThreshold}
              alertEnabled={alertEnabled}
              setAlertEnabled={setAlertEnabled}
              alertFormDirty={alertFormDirty}
              isSubmitting={isSubmitting}
              onSaveAlert={handleSaveAlert}
              onTestAlert={handleTestAlert}
            />
          )}

          {selectedTab === 1 && (
            <ServerTrackingTab
              shop={shop}
              tokenIssues={tokenIssues}
              serverPlatform={serverPlatform}
              setServerPlatform={setServerPlatform}
              serverEnabled={serverEnabled}
              setServerEnabled={setServerEnabled}
              metaPixelId={metaPixelId}
              setMetaPixelId={setMetaPixelId}
              metaAccessToken={metaAccessToken}
              setMetaAccessToken={setMetaAccessToken}
              metaTestCode={metaTestCode}
              setMetaTestCode={setMetaTestCode}
              googleMeasurementId={googleMeasurementId}
              setGoogleMeasurementId={setGoogleMeasurementId}
              googleApiSecret={googleApiSecret}
              setGoogleApiSecret={setGoogleApiSecret}
              tiktokPixelId={tiktokPixelId}
              setTiktokPixelId={setTiktokPixelId}
              tiktokAccessToken={tiktokAccessToken}
              setTiktokAccessToken={setTiktokAccessToken}
              serverFormDirty={serverFormDirty}
              isSubmitting={isSubmitting}
              onSaveServerSide={handleSaveServerSide}
              onTestConnection={handleTestConnection}
            />
          )}

          {selectedTab === 2 && (
            <SecurityTab
              shop={shop}
              pcdApproved={pcdApproved}
              pcdStatusMessage={pcdStatusMessage}
              isSubmitting={isSubmitting}
              onRotateSecret={handleRotateSecret}
            />
          )}

          {selectedTab === 3 && <SubscriptionTab />}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
