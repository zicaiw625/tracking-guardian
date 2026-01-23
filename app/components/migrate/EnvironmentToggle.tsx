import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  ButtonGroup,
  Badge,
  Box,
  Banner,
  Modal,
} from "@shopify/polaris";

type PixelEnvironment = "test" | "live";

interface EnvironmentToggleProps {
  platform: string;
  currentEnvironment: PixelEnvironment;
  configVersion?: number | null;
  canRollback?: boolean;
  onSwitch: (environment: PixelEnvironment) => Promise<void>;
  onRollback?: () => Promise<void>;
  isLoading?: boolean;
}

export function EnvironmentToggle({
  platform,
  currentEnvironment,
  configVersion,
  canRollback = false,
  onSwitch,
  onRollback,
  isLoading = false,
}: EnvironmentToggleProps) {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingEnvironment, setPendingEnvironment] = useState<PixelEnvironment | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const handleEnvironmentChange = useCallback(
    async (newEnvironment: PixelEnvironment) => {
      if (newEnvironment === currentEnvironment) {
        return;
      }
      if (currentEnvironment === "test" && newEnvironment === "live") {
        setPendingEnvironment(newEnvironment);
        setShowConfirmModal(true);
      } else {
        setIsSwitching(true);
        try {
          await onSwitch(newEnvironment);
        } finally {
          setIsSwitching(false);
        }
      }
    },
    [currentEnvironment, onSwitch]
  );
  const handleConfirmSwitch = useCallback(async () => {
    if (!pendingEnvironment) return;
    setShowConfirmModal(false);
    setIsSwitching(true);
    try {
      await onSwitch(pendingEnvironment);
    } finally {
      setIsSwitching(false);
      setPendingEnvironment(null);
    }
  }, [pendingEnvironment, onSwitch]);
  const handleRollback = useCallback(async () => {
    if (!onRollback) return;
    setShowRollbackModal(true);
  }, [onRollback]);
  const confirmRollback = useCallback(async () => {
    if (!onRollback) {
      setShowRollbackModal(false);
      return;
    }
    setShowRollbackModal(false);
    setIsSwitching(true);
    try {
      await onRollback();
    } finally {
      setIsSwitching(false);
    }
  }, [onRollback]);
  const platformNames: Record<string, string> = {
    google: "Google Analytics 4",
    meta: "Meta (Facebook)",
    tiktok: "TikTok",
  };
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                运行环境
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {platformNames[platform] || platform} 像素配置
              </Text>
            </BlockStack>
            <Badge
              tone={currentEnvironment === "live" ? "success" : "warning"}
            >
              {currentEnvironment === "live" ? "生产环境" : "测试环境"}
            </Badge>
          </InlineStack>
          <Box
            background="bg-surface-secondary"
            padding="400"
            borderRadius="200"
            borderWidth="025"
            borderColor="border"
          >
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    当前环境
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {currentEnvironment === "test"
                      ? "测试模式：事件发送到测试端点，不影响正式数据"
                      : "生产模式：事件发送到正式端点，影响实际追踪数据"}
                  </Text>
                </BlockStack>
                <ButtonGroup variant="segmented">
                  <Button
                    pressed={currentEnvironment === "test"}
                    onClick={() => handleEnvironmentChange("test")}
                    disabled={isSwitching || isLoading}
                    loading={isSwitching && pendingEnvironment === "test"}
                    size="slim"
                  >
                    🧪 测试
                  </Button>
                  <Button
                    pressed={currentEnvironment === "live"}
                    onClick={() => handleEnvironmentChange("live")}
                    disabled={isSwitching || isLoading}
                    loading={isSwitching && pendingEnvironment === "live"}
                    size="slim"
                  >
                    🚀 生产
                  </Button>
                </ButtonGroup>
              </InlineStack>
              {currentEnvironment === "test" && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    ⚠️ 测试模式：事件将发送到平台的测试端点，不会影响正式数据。
                    验证完成后请切换到生产环境。
                  </Text>
                </Banner>
              )}
              {currentEnvironment === "live" && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    ✅ 生产模式：事件将发送到正式端点，影响实际追踪数据。
                    请确保配置正确后再切换到生产环境。
                  </Text>
                </Banner>
              )}
              {configVersion && (
                <Box
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          配置版本管理
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          当前版本: v{configVersion}
                        </Text>
                      </BlockStack>
                      {canRollback && (
                        <Button
                          size="slim"
                          variant="primary"
                          onClick={handleRollback}
                          disabled={isSwitching || isLoading}
                          loading={isSwitching}
                        >
                          ⏪ 一键回滚
                        </Button>
                      )}
                    </InlineStack>
                    {canRollback && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          💡 您可以回滚到上一个配置版本。回滚后，当前配置将被上一个版本替换，并创建新的版本记录。
                        </Text>
                      </Banner>
                    )}
                    {!canRollback && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        暂无可回滚的版本
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Box>
        </BlockStack>
      </Card>
      <Modal
        open={showConfirmModal}
        onClose={() => {
          setShowConfirmModal(false);
          setPendingEnvironment(null);
        }}
        title="确认切换到生产环境"
        primaryAction={{
          content: "确认切换",
          onAction: handleConfirmSwitch,
          loading: isSwitching,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => {
              setShowConfirmModal(false);
              setPendingEnvironment(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              您即将从<strong>测试环境</strong>切换到<strong>生产环境</strong>。
            </Text>
            <Banner tone="critical">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  重要提示：
                </Text>
                <ul style={{ paddingLeft: "1.5rem", margin: 0 }}>
                  <li>
                    <Text as="span" variant="bodySm">
                      生产环境的事件将影响实际的广告归因和转化数据
                    </Text>
                  </li>
                  <li>
                    <Text as="span" variant="bodySm">
                      请确保已在测试环境中验证配置正确
                    </Text>
                  </li>
                  <li>
                    <Text as="span" variant="bodySm">
                      切换后，当前配置版本将自动保存
                    </Text>
                  </li>
                </ul>
              </BlockStack>
            </Banner>
            <Text as="p" variant="bodySm" tone="subdued">
              确定要继续吗？
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRollbackModal}
        onClose={() => setShowRollbackModal(false)}
        title="确认回滚配置版本"
        primaryAction={{
          content: "确认回滚",
          destructive: true,
          onAction: confirmRollback,
          loading: isSwitching,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowRollbackModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              确定要回滚到上一个配置版本吗？当前配置将被上一个版本替换。
            </Text>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                回滚操作会生成新的版本记录，建议在回滚前导出当前配置作为备份。
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
