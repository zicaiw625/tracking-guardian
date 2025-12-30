import { useState, useCallback, useEffect } from "react";
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
import { ClockIcon, ArrowLeftIcon, CheckCircleIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";
import type { Platform } from "~/services/migration.server";

export interface ConfigVersionManagerProps {
  shopId: string;
  platform: Platform;
  currentVersion: number;
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
  shopId,
  platform,
  currentVersion: initialCurrentVersion,
  onRollbackComplete,
}: ConfigVersionManagerProps) {
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

      const response = await fetch("/app/migrate", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success && data.history) {
        setVersionHistory(data.history);
      }
    } catch (error) {
      console.error("Failed to load version history", error);
    } finally {
      setIsLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    loadVersionHistory();
  }, [loadVersionHistory]);

  const handleRollback = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "rollbackConfig");
    formData.append("platform", platform);
    fetcher.submit(formData, { method: "post" });
  }, [platform, fetcher]);

  // 处理回滚结果
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
            配置版本历史
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            加载中...
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
            配置版本历史
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            暂无版本历史记录
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const platformNames: Record<Platform, string> = {
    google: "Google Analytics 4",
    meta: "Meta Pixel",
    tiktok: "TikTok Pixel",
    pinterest: "Pinterest Tag",
  };

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              配置版本历史
            </Text>
            {versionHistory.canRollback && (
              <Button
                onClick={() => setRollbackModalOpen(true)}
                variant="secondary"
                size="slim"
                icon={ArrowLeftIcon}
              >
                回滚到上一版本
              </Button>
            )}
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {platformNames[platform]} 的配置版本历史。当前版本：v{versionHistory.currentVersion}
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
                            版本 {version.version}
                          </Text>
                          {isCurrent && (
                            <Badge tone="success">当前版本</Badge>
                          )}
                          {isLatest && !isCurrent && (
                            <Badge tone="info">最新</Badge>
                          )}
                        </InlineStack>
                        <InlineStack gap="300" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            <ClockIcon />
                            {new Date(version.savedAt).toLocaleString("zh-CN")}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>

                    <Divider />

                    <BlockStack gap="200">
                      <InlineStack gap="400" wrap>
                        <Text as="span" variant="bodySm">
                          <strong>环境：</strong>
                          <Badge>{version.config.environment}</Badge>
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>客户端：</strong>
                          {version.config.clientSideEnabled ? (
                            <Badge tone="success">启用</Badge>
                          ) : (
                            <Badge tone="subdued">禁用</Badge>
                          )}
                        </Text>
                        <Text as="span" variant="bodySm">
                          <strong>服务端：</strong>
                          {version.config.serverSideEnabled ? (
                            <Badge tone="success">启用</Badge>
                          ) : (
                            <Badge tone="subdued">禁用</Badge>
                          )}
                        </Text>
                      </InlineStack>
                      {version.config.platformId && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          <strong>平台 ID：</strong>
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
                无法回滚：当前配置没有保存的上一个版本，或回滚功能已禁用
              </Text>
            </Banner>
          )}
        </BlockStack>
      </Card>

      <Modal
        open={rollbackModalOpen}
        onClose={() => setRollbackModalOpen(false)}
        title="确认回滚配置"
        primaryAction={{
          content: "确认回滚",
          onAction: handleRollback,
          loading: fetcher.state === "submitting",
          destructive: true,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setRollbackModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="warning">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                警告：回滚操作将恢复配置到上一个版本
              </Text>
            </Banner>

            <BlockStack gap="300">
              <Text as="p" variant="bodySm">
                您即将将 <strong>{platformNames[platform]}</strong> 的配置回滚到版本{" "}
                {versionHistory.currentVersion - 1}。
              </Text>

              <List>
                <List.Item>
                  当前配置（版本 {versionHistory.currentVersion}）将被保存为新的快照
                </List.Item>
                <List.Item>
                  配置将恢复到上一个版本的状态
                </List.Item>
                <List.Item>
                  此操作可以再次回滚（恢复到当前版本）
                </List.Item>
              </List>

              {fetcher.data && (fetcher.data as { error?: string }).error && (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    {(fetcher.data as { error: string }).error}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

