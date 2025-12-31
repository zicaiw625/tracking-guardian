

import { useState, useEffect, useCallback, useRef } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, ContextualSaveBar } from "@shopify/polaris";
import { useToastContext } from "~/components/ui";

import { settingsLoader } from "./loader.server";
import { settingsAction } from "./actions.server";
import type { SettingsActionResponse } from "./types";
import {
  AlertsTab,
  ServerTrackingTab,
  SecurityTab,
  SubscriptionTab,
} from "./_components";

export const loader = settingsLoader;
export const action = settingsAction;

export default function SettingsPage() {
  const { shop, tokenIssues, pcdApproved, pcdStatusMessage, currentMonitoringData } =
    useLoaderData<typeof settingsLoader>();
  const actionData = useActionData<SettingsActionResponse>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showSuccess(actionData.message || "设置已保存");
      } else if (actionData.error) {
        showError(actionData.error);
      }
    }
  }, [actionData, showSuccess, showError]);

  const existingAlertConfig = shop?.alertConfigs?.[0];
  const existingPixelConfig = shop?.pixelConfigs?.[0];

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const getTabIndex = (tab: string | null): number => {
    if (tab === "billing" || tab === "subscription") return 3;
    if (tab === "alerts") return 0;
    if (tab === "server-side" || tab === "server") return 1;
    if (tab === "security") return 2;
    return 0;
  };

  const [selectedTab, setSelectedTab] = useState(() => getTabIndex(tabParam));

  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    if (newTabIndex !== selectedTab) {
      setSelectedTab(newTabIndex);
    }
  }, [tabParam, selectedTab]);

  const [alertChannel, setAlertChannel] = useState(() => existingAlertConfig?.channel || "email");
  const [alertEmail, setAlertEmail] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [alertThreshold, setAlertThreshold] = useState(() =>
    existingAlertConfig ? String(Math.round(existingAlertConfig.discrepancyThreshold * 100)) : "10"
  );
  const [alertEnabled, setAlertEnabled] = useState(() => existingAlertConfig?.isEnabled ?? true);

  const settings = existingAlertConfig?.settings as { thresholds?: { failureRate?: number; missingParams?: number; volumeDrop?: number } } | undefined;
  const [failureRateThreshold, setFailureRateThreshold] = useState(() =>
    settings?.thresholds?.failureRate ? String(Math.round(settings.thresholds.failureRate * 100)) : "2"
  );
  const [missingParamsThreshold, setMissingParamsThreshold] = useState(() =>
    settings?.thresholds?.missingParams ? String(Math.round(settings.thresholds.missingParams * 100)) : "5"
  );
  const [volumeDropThreshold, setVolumeDropThreshold] = useState(() =>
    settings?.thresholds?.volumeDrop ? String(Math.round(settings.thresholds.volumeDrop * 100)) : "50"
  );

  const [alertFrequency, setAlertFrequency] = useState(() =>
    existingAlertConfig?.frequency || "daily"
  );

  const [serverPlatform, setServerPlatform] = useState(() => existingPixelConfig?.platform || "meta");
  const [serverEnabled, setServerEnabled] = useState(() => existingPixelConfig?.serverSideEnabled ?? false);

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

  const [pinterestAdAccountId, setPinterestAdAccountId] = useState(() =>
    existingPixelConfig?.platform === "pinterest" ? (existingPixelConfig.platformId || "") : ""
  );
  const [pinterestAccessToken, setPinterestAccessToken] = useState("");

  const [environment, setEnvironment] = useState<"test" | "live">(() =>
    (existingPixelConfig?.environment as "test" | "live") ?? "live"
  );

  const [alertFormDirty, setAlertFormDirty] = useState(false);
  const [serverFormDirty, setServerFormDirty] = useState(false);

  const initialAlertValues = useRef({
    channel: existingAlertConfig?.channel || "email",
    email: "",
    slackWebhook: "",
    telegramToken: "",
    telegramChatId: "",
    threshold: existingAlertConfig ? String(Math.round(existingAlertConfig.discrepancyThreshold * 100)) : "10",
    enabled: existingAlertConfig?.isEnabled ?? true,
    failureRateThreshold: settings?.thresholds?.failureRate ? String(Math.round(settings.thresholds.failureRate * 100)) : "2",
    missingParamsThreshold: settings?.thresholds?.missingParams ? String(Math.round(settings.thresholds.missingParams * 100)) : "5",
    volumeDropThreshold: settings?.thresholds?.volumeDrop ? String(Math.round(settings.thresholds.volumeDrop * 100)) : "50",
    alertFrequency: existingAlertConfig?.frequency || "daily",
  });

  const initialServerValues = useRef({
    platform: existingPixelConfig?.platform || "meta",
    enabled: existingPixelConfig?.serverSideEnabled ?? false,
    environment: (existingPixelConfig?.environment as "test" | "live") ?? "live",
    metaPixelId: existingPixelConfig?.platform === "meta" ? (existingPixelConfig.platformId || "") : "",
    metaAccessToken: "",
    metaTestCode: "",
    googleMeasurementId: existingPixelConfig?.platform === "google" ? (existingPixelConfig.platformId || "") : "",
    googleApiSecret: "",
    tiktokPixelId: existingPixelConfig?.platform === "tiktok" ? (existingPixelConfig.platformId || "") : "",
    tiktokAccessToken: "",
    pinterestAdAccountId: existingPixelConfig?.platform === "pinterest" ? (existingPixelConfig.platformId || "") : "",
    pinterestAccessToken: "",
  });

  const isSubmitting = navigation.state === "submitting";

  const checkAlertFormDirty = useCallback(() => {
    const initial = initialAlertValues.current;
    const isDirty =
      alertChannel !== initial.channel ||
      alertEmail !== initial.email ||
      slackWebhook !== initial.slackWebhook ||
      telegramToken !== initial.telegramToken ||
      telegramChatId !== initial.telegramChatId ||
      alertThreshold !== initial.threshold ||
      alertEnabled !== initial.enabled ||
      failureRateThreshold !== (initial.failureRateThreshold || "2") ||
      missingParamsThreshold !== (initial.missingParamsThreshold || "5") ||
      volumeDropThreshold !== (initial.volumeDropThreshold || "50") ||
      alertFrequency !== (initial.alertFrequency || "daily");
    setAlertFormDirty(isDirty);
  }, [
    alertChannel,
    alertEmail,
    slackWebhook,
    telegramToken,
    telegramChatId,
    alertThreshold,
    alertEnabled,
    failureRateThreshold,
    missingParamsThreshold,
    volumeDropThreshold,
    alertFrequency,
  ]);

  const checkServerFormDirty = useCallback(() => {
    const initial = initialServerValues.current;
    const isDirty =
      serverPlatform !== initial.platform ||
      serverEnabled !== initial.enabled ||
      environment !== initial.environment ||
      metaPixelId !== initial.metaPixelId ||
      metaAccessToken !== initial.metaAccessToken ||
      metaTestCode !== initial.metaTestCode ||
      googleMeasurementId !== initial.googleMeasurementId ||
      googleApiSecret !== initial.googleApiSecret ||
      tiktokPixelId !== initial.tiktokPixelId ||
      tiktokAccessToken !== initial.tiktokAccessToken ||
      pinterestAdAccountId !== initial.pinterestAdAccountId ||
      pinterestAccessToken !== initial.pinterestAccessToken;
    setServerFormDirty(isDirty);
  }, [
    serverPlatform,
    serverEnabled,
    environment,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    pinterestAdAccountId,
    pinterestAccessToken,
  ]);

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
            failureRateThreshold: failureRateThreshold,
            missingParamsThreshold: missingParamsThreshold,
            volumeDropThreshold: volumeDropThreshold,
            alertFrequency: alertFrequency,
          };
          setAlertFormDirty(false);
        } else if (selectedTab === 1) {
          initialServerValues.current = {
            platform: serverPlatform,
            enabled: serverEnabled,
            environment: environment,
            metaPixelId: metaPixelId,
            metaAccessToken: metaAccessToken,
            metaTestCode: metaTestCode,
            googleMeasurementId: googleMeasurementId,
            googleApiSecret: googleApiSecret,
            tiktokPixelId: tiktokPixelId,
            tiktokAccessToken: tiktokAccessToken,
            pinterestAdAccountId: pinterestAdAccountId,
            pinterestAccessToken: pinterestAccessToken,
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
    environment,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    pinterestAdAccountId,
    pinterestAccessToken,
  ]);

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
      setFailureRateThreshold(initial.failureRateThreshold || "2");
      setMissingParamsThreshold(initial.missingParamsThreshold || "5");
      setVolumeDropThreshold(initial.volumeDropThreshold || "50");
      setAlertFrequency(initial.alertFrequency || "daily");
      setAlertFormDirty(false);
    } else if (selectedTab === 1) {
      const initial = initialServerValues.current;
      setServerPlatform(initial.platform);
      setServerEnabled(initial.enabled);
      setEnvironment(initial.environment);
      setMetaPixelId(initial.metaPixelId);
      setMetaAccessToken(initial.metaAccessToken);
      setMetaTestCode(initial.metaTestCode);
      setGoogleMeasurementId(initial.googleMeasurementId);
      setGoogleApiSecret(initial.googleApiSecret);
      setTiktokPixelId(initial.tiktokPixelId);
      setTiktokAccessToken(initial.tiktokAccessToken);
      setPinterestAdAccountId(initial.pinterestAdAccountId);
      setPinterestAccessToken(initial.pinterestAccessToken);
      setServerFormDirty(false);
    }
  }, [selectedTab]);

  const handleSaveAlert = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "saveAlert");
    formData.append("channel", alertChannel);
    formData.append("threshold", alertThreshold);
    formData.append("enabled", alertEnabled.toString());

    formData.append("failureRateThreshold", failureRateThreshold);
    formData.append("missingParamsThreshold", missingParamsThreshold);
    formData.append("volumeDropThreshold", volumeDropThreshold);

    formData.append("frequency", alertFrequency);

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
    failureRateThreshold,
    missingParamsThreshold,
    volumeDropThreshold,
    alertFrequency,
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
    formData.append("environment", environment);

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
    } else if (serverPlatform === "pinterest") {
      formData.append("adAccountId", pinterestAdAccountId);
      formData.append("accessToken", pinterestAccessToken);
    }

    submit(formData, { method: "post" });
  }, [
    serverPlatform,
    serverEnabled,
    environment,
    metaPixelId,
    metaAccessToken,
    metaTestCode,
    googleMeasurementId,
    googleApiSecret,
    tiktokPixelId,
    tiktokAccessToken,
    pinterestAdAccountId,
    pinterestAccessToken,
    submit,
  ]);

  const handleSwitchEnvironment = useCallback((platform: string, env: "test" | "live") => {
    const formData = new FormData();
    formData.append("_action", "switchEnvironment");
    formData.append("platform", platform);
    formData.append("environment", env);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleRollbackEnvironment = useCallback((platform: string) => {
    if (confirm("确定要回滚到上一个配置版本吗？")) {
      const formData = new FormData();
      formData.append("_action", "rollbackEnvironment");
      formData.append("platform", platform);
      submit(formData, { method: "post" });
    }
  }, [submit]);

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
        {}

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
              failureRateThreshold={failureRateThreshold}
              setFailureRateThreshold={setFailureRateThreshold}
              missingParamsThreshold={missingParamsThreshold}
              setMissingParamsThreshold={setMissingParamsThreshold}
              volumeDropThreshold={volumeDropThreshold}
              setVolumeDropThreshold={setVolumeDropThreshold}
              alertFrequency={alertFrequency}
              setAlertFrequency={setAlertFrequency}
              currentMonitoringData={currentMonitoringData}
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
              environment={environment}
              setEnvironment={setEnvironment}
              onSwitchEnvironment={handleSwitchEnvironment}
              onRollbackEnvironment={handleRollbackEnvironment}
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
              pinterestAdAccountId={pinterestAdAccountId}
              setPinterestAdAccountId={setPinterestAdAccountId}
              pinterestAccessToken={pinterestAccessToken}
              setPinterestAccessToken={setPinterestAccessToken}
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
