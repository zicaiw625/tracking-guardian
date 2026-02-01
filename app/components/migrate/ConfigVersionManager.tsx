import { useState, useCallback, useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Divider,
  List,
  Modal,
  Banner,
} from "@shopify/polaris";
import { ClockIcon, ArrowLeftIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";
import type { PlatformType } from "~/types/enums";

export interface ConfigVersionManagerProps {
  shopId: string;
  platform: PlatformType;
  currentVersion: number;
  historyEndpoint?: string;
  onRollbackComplete?: () => void;
}

interface ConfigVersion {
  version: number;
  config: {
    platformId: string | null;
    environment: string;
    clientSideEnabled: boolean;
    serverSideEnabled: boolean;
  };
  savedAt: Date;
}

export function ConfigVersionManager({
  shopId: _shopId,
  platform,
  currentVersion: _initialCurrentVersion,
  historyEndpoint,
  onRollbackComplete,
}: ConfigVersionManagerProps) {
  const { t, i18n } = useTranslation();
  const [versionHistory, setVersionHistory] = useState<{
    currentVersion: number;
    versions: ConfigVersion[];
    canRollback: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const fetcher = useFetcher();
  const loadVersionHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("_action", "getConfigVersionHistory");
      formData.append("platform", platform);
      const response = await fetch(historyEndpoint || "/app/migrate", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.success && data.history) {
        setVersionHistory(data.history);
      }
    } catch (error) {
      const { debugError } = await import("../../utils/debug-log.client");
      debugError("Failed to load version history", error);
    } finally {
      setIsLoading(false);
    }
  }, [platform, historyEndpoint]);
  useEffect(() => {
    loadVersionHistory();
  }, [loadVersionHistory]);
  const handleRollback = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "rollbackConfig");
    formData.append("platform", platform);
    fetcher.submit(formData, {
      method: "post",
      action: historyEndpoint || "/app/migrate",
    });
  }, [platform, fetcher, historyEndpoint]);
  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
      setRollbackModalOpen(false);
      loadVersionHistory();
      if (onRollbackComplete) {
        onRollbackComplete();
      }
    }
  }, [fetcher.data, loadVersionHistory, onRollbackComplete]);
  if (isLoading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("components.configVersionManager.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("components.configVersionManager.loading")}
          </Text>
        </BlockStack>
      </Card>
    );
  }
  if (!versionHistory || versionHistory.versions.length === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("components.configVersionManager.title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("components.configVersionManager.noHistory")}
          </Text>
        </BlockStack>
      </Card>
    );
  }
  const platformNames: Partial<Record<PlatformType, string>> = {
    google: "Google Analytics 4",
    meta: "Meta Pixel",
    tiktok: "TikTok Pixel",
  };
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("components.configVersionManager.title")}
            </Text>
            {versionHistory.canRollback && (
              <Button
                onClick={() => setRollbackModalOpen(true)}
                variant="secondary"
                size="slim"
                icon={ArrowLeftIcon}
              >
                {t("components.configVersionManager.rollbackToPrev")}
              </Button>
            )}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("components.configVersionManager.historyDesc", {
              platform: platformNames[platform],
              version: versionHistory.currentVersion
            })}
          </Text>
          <Divider />
          <BlockStack gap="300">
            {versionHistory.versions.map((version, index) => {
              const isCurrent = version.version === versionHistory.currentVersion;
              const isLatest = index === 0;
              return (
                <Box
                  key={version.version}
                  background={
                    isCurrent ? "bg-surface-success" : "bg-surface-secondary"
                  }
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="headingSm" fontWeight="semibold">
                            {t("components.configVersionManager.version", { version: version.version })}
                          </Text>
                          {isCurrent && (
                            <Badge tone="success">{t("components.configVersionManager.currentVersionBadge")}</Badge>
                          )}
                          {isLatest && !isCurrent && (
                            <Badge tone="info">{t("components.configVersionManager.latestBadge")}</Badge>
                          )}
                        </InlineStack>
                        <InlineStack gap="300" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            <ClockIcon />
                            {new Date(version.savedAt).toLocaleString(
                              (i18n.resolvedLanguage ?? i18n.language)?.toLowerCase().startsWith("zh")
                                ? "zh-CN"
                                : "en-US"
                            )}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack gap="400" wrap>
                        <Text as="span" variant="bodySm">
                          <strong>{t("components.configVersionManager.env")}</strong>
                          <Badge>{version.config.environment}</Badge>
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>{t("components.configVersionManager.client")}</strong>
                          {version.config.clientSideEnabled ? (
                            <Badge tone="success">{t("components.configVersionManager.enabled")}</Badge>
                          ) : (
                            <Badge>{t("components.configVersionManager.disabled")}</Badge>
                          )}
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>{t("components.configVersionManager.server")}</strong>
                          {version.config.serverSideEnabled ? (
                            <Badge tone="success">{t("components.configVersionManager.enabled")}</Badge>
                          ) : (
                            <Badge>{t("components.configVersionManager.disabled")}</Badge>
                          )}
                        </Text>
                      </InlineStack>
                      {version.config.platformId && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          <strong>{t("components.configVersionManager.platformId")}</strong>
                          {version.config.platformId}
                        </Text>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
          {!versionHistory.canRollback && versionHistory.versions.length > 1 && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("components.configVersionManager.cannotRollback")}
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>
      <Modal
        open={rollbackModalOpen}
        onClose={() => setRollbackModalOpen(false)}
        title={t("components.configVersionManager.confirmRollbackTitle")}
        primaryAction={{
          content: t("components.configVersionManager.confirmRollbackBtn"),
          onAction: handleRollback,
          loading: fetcher.state === "submitting",
          destructive: true,
        }}
        secondaryActions={[
          {
            content: t("components.environmentToggle.cancel"),
            onAction: () => setRollbackModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {t("components.configVersionManager.rollbackWarning")}
              </Text>
            </Banner>
            <BlockStack gap="300">
              <Text as="p" variant="bodySm">
                <Trans 
                  i18nKey="components.configVersionManager.rollbackMessage" 
                  values={{ platform: platformNames[platform], version: versionHistory.currentVersion - 1 }}
                  components={{ strong: <strong /> }}
                />
              </Text>
              <List>
                <List.Item>
                  {t("components.configVersionManager.rollbackItem1", { version: versionHistory.currentVersion })}
                </List.Item>
                <List.Item>
                  {t("components.configVersionManager.rollbackItem2")}
                </List.Item>
                <List.Item>
                  {t("components.configVersionManager.rollbackItem3")}
                </List.Item>
              </List>
              {fetcher.data && (fetcher.data as { error?: string }).error ? (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    {(fetcher.data as { error: string }).error}
                  </Text>
                </Banner>
              ) : null}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
