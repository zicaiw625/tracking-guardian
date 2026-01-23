import { useState, useCallback, useEffect } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Tabs,
  Banner,
  Modal,
  Select,
} from "@shopify/polaris";
import { SettingsIcon } from "~/components/icons";
import { ConfigComparison } from "~/components/settings/ConfigComparison";
import type { PixelConfigSnapshot } from "~/services/pixel-rollback.server";
import { ConfigVersionManager } from "./ConfigVersionManager";
import { useFetcher } from "@remix-run/react";
import type { Platform } from "~/services/migration.server";
import { useToastContext } from "~/components/ui";

type ConfigComparisonData = {
  current: PixelConfigSnapshot & { version: number; updatedAt: Date };
  previous: PixelConfigSnapshot | null;
  differences: Array<{
    field: string;
    current: unknown;
    previous: unknown;
    changed: boolean;
  }>;
};

interface PixelConfig {
  id: string;
  platform: string;
  environment: string;
  configVersion: number | null;
  previousConfig: unknown;
  rollbackAllowed: boolean;
}

interface ConfigManagementCardProps {
  pixelConfigs: PixelConfig[];
  shopId: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Analytics 4",
  meta: "Meta (Facebook)",
  tiktok: "TikTok",
};

export function ConfigManagementCard({
  pixelConfigs,
  shopId,
}: ConfigManagementCardProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [environmentChanging, setEnvironmentChanging] = useState<string | null>(null);
  const [showEnvConfirmModal, setShowEnvConfirmModal] = useState(false);
  const [pendingEnvChange, setPendingEnvChange] = useState<{ platform: string; newEnv: string } | null>(null);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [pendingRollbackPlatform, setPendingRollbackPlatform] = useState<string | null>(null);
  const comparisonFetcher = useFetcher();
  const historyFetcher = useFetcher();
  const envFetcher = useFetcher();
  const { showError, showSuccess } = useToastContext();
  const handleViewConfig = useCallback(
    (platform: string) => {
      setSelectedPlatform(platform);
      setShowModal(true);
      setActiveTab(0);
      comparisonFetcher.load(
        `/api/pixel-config-history?platform=${platform}&type=comparison`
      );
      historyFetcher.load(
        `/api/pixel-config-history?platform=${platform}&type=history&limit=10`
      );
    },
    [comparisonFetcher, historyFetcher]
  );
  const handleEnvironmentChange = useCallback(
    (platform: string, newEnvironment: string) => {
      const config = pixelConfigs.find((c) => c.platform === platform);
      if (!config) return;
      if (config.environment === newEnvironment) {
        return;
      }
      setPendingEnvChange({ platform, newEnv: newEnvironment });
      setShowEnvConfirmModal(true);
    },
    [pixelConfigs]
  );
  const confirmEnvironmentChange = useCallback(() => {
    if (!pendingEnvChange) return;
    setEnvironmentChanging(pendingEnvChange.platform);
    const formData = new FormData();
    formData.append("_action", "switch_environment");
    formData.append("platform", pendingEnvChange.platform);
    formData.append("environment", pendingEnvChange.newEnv);
    envFetcher.submit(formData, {
      method: "post",
      action: "/app/actions/pixel-config",
    });
    setShowEnvConfirmModal(false);
    setPendingEnvChange(null);
  }, [pendingEnvChange, envFetcher]);
  const cancelEnvironmentChange = useCallback(() => {
    setShowEnvConfirmModal(false);
    setPendingEnvChange(null);
  }, []);
  const handleRollback = useCallback((platform: string) => {
    setPendingRollbackPlatform(platform);
    setShowRollbackModal(true);
  }, []);
  const confirmRollback = useCallback(async () => {
    if (!pendingRollbackPlatform) {
      setShowRollbackModal(false);
      return;
    }
    setEnvironmentChanging(pendingRollbackPlatform);
    try {
      const formData = new FormData();
      formData.append("_action", "rollback");
      formData.append("platform", pendingRollbackPlatform);
      const response = await fetch("/app/actions/pixel-config", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        showSuccess("回滚成功，正在刷新页面");
        window.location.reload();
      } else {
        showError(data.error || "回滚失败");
      }
    } catch {
      showError("回滚失败");
    } finally {
      setEnvironmentChanging(null);
      setShowRollbackModal(false);
      setPendingRollbackPlatform(null);
    }
  }, [pendingRollbackPlatform, showError, showSuccess]);
  useEffect(() => {
    if (envFetcher.data && envFetcher.state === "idle") {
      const result = envFetcher.data as { success: boolean; message?: string; error?: string };
      if (result.success) {
        setEnvironmentChanging(null);
        if (result.message) {
          showSuccess(result.message);
        }
        window.location.reload();
      } else {
        setEnvironmentChanging(null);
        showError(result.error || result.message || "环境切换失败");
      }
    }
  }, [envFetcher.data, envFetcher.state, showError, showSuccess]);
  if (pixelConfigs.length === 0) {
    return null;
  }
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              已配置的平台
            </Text>
            <Badge tone="success">{`${String(pixelConfigs.length)} 个`}</Badge>
          </InlineStack>
          <Divider />
          <BlockStack gap="300">
            {pixelConfigs.map((config) => (
              <Box
                key={config.id}
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {PLATFORM_LABELS[config.platform] || config.platform}
                      </Text>
                      <Badge
                        tone={
                          config.environment === "live" ? "success" : "warning"
                        }
                      >
                        {config.environment === "live" ? "生产" : "测试"}
                      </Badge>
                      {config.configVersion && (
                        <Badge>{`v${String(config.configVersion)}`}</Badge>
                      )}
                    </InlineStack>
                    {config.rollbackAllowed && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        可回滚到上一个版本
                      </Text>
                    )}
                  </BlockStack>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodySm" tone="subdued">
                        环境:
                      </Text>
                      <Box minWidth="120px">
                        <Select
                          label="环境"
                          options={[
                            { label: "测试 (Test)", value: "test" },
                            { label: "生产 (Live)", value: "live" },
                          ]}
                          value={config.environment}
                          onChange={(value) =>
                            handleEnvironmentChange(config.platform, value)
                          }
                          disabled={environmentChanging === config.platform}
                        />
                      </Box>
                    </InlineStack>
                    <InlineStack gap="200">
                      {config.rollbackAllowed && (
                        <Button
                          size="slim"
                          variant="primary"
                          onClick={() => handleRollback(config.platform)}
                          loading={environmentChanging === config.platform}
                        >
                          ⏪ 快速回滚
                        </Button>
                      )}
                      <Button
                        size="slim"
                        icon={SettingsIcon}
                        onClick={() => handleViewConfig(config.platform)}
                      >
                        查看配置
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
          <Button url="/app/settings" fullWidth>
            前往设置页面管理
          </Button>
        </BlockStack>
      </Card>
      {showModal && selectedPlatform && (
        <Modal
          open={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedPlatform(null);
          }}
          title={`${PLATFORM_LABELS[selectedPlatform] || selectedPlatform} 配置管理`}
          primaryAction={{
            content: "关闭",
            onAction: () => {
              setShowModal(false);
              setSelectedPlatform(null);
            },
          }}
        >
          <Modal.Section>
            <Tabs
              tabs={[
                { id: "comparison", content: "配置对比" },
                { id: "history", content: "版本历史" },
              ]}
              selected={activeTab}
              onSelect={(index) => setActiveTab(index)}
            >
              <Box paddingBlockStart="400">
                {activeTab === 0 &&
                  comparisonFetcher.data &&
                  typeof comparisonFetcher.data === "object" &&
                  comparisonFetcher.data !== null &&
                  "comparison" in comparisonFetcher.data &&
                  comparisonFetcher.data.comparison &&
                  typeof comparisonFetcher.data.comparison === "object" &&
                  comparisonFetcher.data.comparison !== null &&
                  "current" in comparisonFetcher.data.comparison &&
                  "previous" in comparisonFetcher.data.comparison &&
                  "differences" in comparisonFetcher.data.comparison &&
                  Array.isArray(comparisonFetcher.data.comparison.differences) ? (
                    <ConfigComparison
                      current={comparisonFetcher.data.comparison.current as ConfigComparisonData["current"]}
                      previous={comparisonFetcher.data.comparison.previous as ConfigComparisonData["previous"]}
                      differences={comparisonFetcher.data.comparison.differences as ConfigComparisonData["differences"]}
                      platform={selectedPlatform}
                    />
                  ) : null}
                {activeTab === 1 && selectedPlatform && (
                  <ConfigVersionManager
                    shopId={shopId}
                    platform={selectedPlatform as Platform}
                    currentVersion={
                      pixelConfigs.find((c) => c.platform === selectedPlatform)
                        ?.configVersion || 1
                    }
                    onRollbackComplete={() => {
                      window.location.reload();
                    }}
                  />
                )}
              </Box>
            </Tabs>
          </Modal.Section>
        </Modal>
      )}
      <Modal
        open={showEnvConfirmModal}
        onClose={cancelEnvironmentChange}
        title="确认切换环境"
        primaryAction={{
          content: "确认切换",
          onAction: confirmEnvironmentChange,
          loading: environmentChanging !== null,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: cancelEnvironmentChange,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {pendingEnvChange && (
              <>
                <Text as="p">
                  确定要将{" "}
                  <strong>
                    {PLATFORM_LABELS[pendingEnvChange.platform] ||
                      pendingEnvChange.platform}
                  </strong>{" "}
                  从{" "}
                  <strong>
                    {pixelConfigs.find((c) => c.platform === pendingEnvChange.platform)
                      ?.environment === "live"
                      ? "生产 (Live)"
                      : "测试 (Test)"}
                  </strong>{" "}
                  切换到{" "}
                  <strong>
                    {pendingEnvChange.newEnv === "live"
                      ? "生产 (Live)"
                      : "测试 (Test)"}
                  </strong>{" "}
                  吗？
                </Text>
                <Box
                  background={
                    pendingEnvChange.newEnv === "live"
                      ? "bg-fill-critical"
                      : "bg-fill-warning"
                  }
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {pendingEnvChange.newEnv === "live"
                        ? "⚠️ 切换到生产环境"
                        : "ℹ️ 切换到测试环境"}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {pendingEnvChange.newEnv === "live"
                        ? "切换到生产环境后，事件将发送到正式端点。请确保已充分测试。"
                        : "切换到测试环境后，事件将发送到沙盒/测试端点，不会影响实际数据。"}
                    </Text>
                  </BlockStack>
                </Box>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRollbackModal}
        onClose={() => {
          setShowRollbackModal(false);
          setPendingRollbackPlatform(null);
        }}
        title="确认回滚配置"
        primaryAction={{
          content: "确认回滚",
          destructive: true,
          onAction: confirmRollback,
          loading: environmentChanging !== null,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => {
              setShowRollbackModal(false);
              setPendingRollbackPlatform(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              确定要回滚{" "}
              <strong>
                {pendingRollbackPlatform
                  ? PLATFORM_LABELS[pendingRollbackPlatform] || pendingRollbackPlatform
                  : "该平台"}
              </strong>{" "}
              的配置到上一个版本吗？当前配置将被上一个版本替换。
            </Text>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                回滚后会创建新的版本记录，建议回滚前确认当前配置已保存。
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
