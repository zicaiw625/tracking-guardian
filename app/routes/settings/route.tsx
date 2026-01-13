import { useState, useEffect, useCallback, useRef } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, ContextualSaveBar } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useToastContext } from "~/components/ui";

import { settingsLoader } from "./loader.server";
import { settingsAction } from "./actions.server";
import type { SettingsActionResponse } from "./types";
import {
  AlertsTab,
  SecurityTab,
  SubscriptionTab,
} from "./_components";
import type { PlanId } from "~/services/billing/plans";

export const loader = settingsLoader;
export const action = settingsAction;

export default function SettingsPage() {
  const { shop, tokenIssues, currentMonitoringData } =
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const getTabIndex = (tab: string | null): number => {
    if (tab === "billing" || tab === "subscription") return 2;
    if (tab === "alerts") return 0;
    if (tab === "security") return 1;
    return 0;
  };
  const getTabId = (index: number): string => {
    if (index === 0) return "alerts";
    if (index === 1) return "security";
    if (index === 2) return "subscription";
    return "alerts";
  };
  const [selectedTab, setSelectedTab] = useState(() => getTabIndex(tabParam));
  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    setSelectedTab(newTabIndex);
  }, [tabParam]);
  const handleTabChange = useCallback((index: number) => {
    const tabId = getTabId(index);
    setSearchParams({ tab: tabId });
  }, [setSearchParams]);
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
  const [alertFormDirty, setAlertFormDirty] = useState(false);
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
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedTab === 0) {
        checkAlertFormDirty();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedTab, checkAlertFormDirty]);
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
    }
  }, [selectedTab, handleSaveAlert]);
  const tabs = [
    { id: "alerts", content: "警报通知" },
    { id: "security", content: "安全与隐私" },
    { id: "subscription", content: "订阅计划" },
  ];
  const showSaveBar = selectedTab === 0 && alertFormDirty;
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
        <PageIntroCard
          title="设置总览"
          description="配置告警通知、安全与隐私策略，以及订阅计划。"
          items={[
            "告警阈值集中在「警报通知」",
            "数据保留与隐私策略在「安全与隐私」",
          ]}
          primaryAction={{ content: "查看订阅计划", url: "/app/settings?tab=subscription" }}
          secondaryAction={{ content: "配置告警", url: "/app/settings?tab=alerts" }}
        />
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
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
            <SecurityTab
              shop={shop}
              isSubmitting={isSubmitting}
              onRotateSecret={handleRotateSecret}
            />
          )}
          {selectedTab === 2 && <SubscriptionTab currentPlan={shop?.plan as PlanId || "free"} />}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
