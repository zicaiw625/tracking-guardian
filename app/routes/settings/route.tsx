import { useState, useEffect, useCallback, useRef } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, ContextualSaveBar, Button, InlineStack, Text } from "@shopify/polaris";
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
  const { shop, currentMonitoringData, hmacSecurityStats } =
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
    alertFrequency,
    failureRateThreshold,
    missingParamsThreshold,
    volumeDropThreshold,
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
            "订阅管理与计费：在「订阅计划」标签页配置，或直接访问「订阅与计费」页面（推荐）",
            "告警阈值集中在「警报通知」标签页",
            "数据保留与隐私策略在「安全与隐私」标签页",
            "隐私政策与 GDPR 请求在「隐私」页面",
            "实时监控与告警在「监控中心」页面",
          ]}
          primaryAction={{ content: "订阅与计费", url: "/app/billing" }}
          secondaryAction={{ content: "隐私设置", url: "/app/privacy" }}
        />
        <Banner tone="warning" title="重要功能快速访问">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              以下功能可通过左侧导航菜单或下方按钮直接访问
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/billing" variant="primary" size="large">
                订阅与计费
              </Button>
              <Button url="/app/privacy" variant="secondary" size="large">
                隐私设置
              </Button>
              <Button url="/app/monitor" variant="secondary" size="large">
                监控中心
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              订阅与计费用于管理您的付费计划和账单，隐私设置用于配置数据保护和合规选项，监控中心用于查看追踪状态和告警信息。
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="info" title="订阅与计费管理">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              管理您的订阅计划、查看账单历史、升级或降级套餐。您可以在「订阅计划」标签页中查看当前计划详情，或直接访问「订阅与计费」页面进行更详细的管理。
            </Text>
            <InlineStack gap="200">
              <Button url="/app/billing" variant="primary">
                前往订阅与计费页面
              </Button>
              <Button onClick={() => handleTabChange(2)} variant="secondary">
                查看订阅计划标签页
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
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
              hmacSecurityStats={hmacSecurityStats}
            />
          )}
          {selectedTab === 2 && <SubscriptionTab currentPlan={shop?.plan as PlanId || "free"} />}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
