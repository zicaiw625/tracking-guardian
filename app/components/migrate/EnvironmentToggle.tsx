import { useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
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
  const { t } = useTranslation();
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
                {t("components.environmentToggle.title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {platformNames[platform] || platform} {t("components.environmentToggle.pixelConfig")}
              </Text>
            </BlockStack>
            <Badge
              tone={currentEnvironment === "live" ? "success" : "warning"}
            >
              {currentEnvironment === "live" ? t("components.environmentToggle.prodEnv") : t("components.environmentToggle.testEnv")}
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
                    {t("components.environmentToggle.currentEnv")}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {currentEnvironment === "test"
                      ? t("components.environmentToggle.testModeDesc")
                      : t("components.environmentToggle.prodModeDesc")}
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
                    🧪 {t("components.environmentToggle.testBtn")}
                  </Button>
                  <Button
                    pressed={currentEnvironment === "live"}
                    onClick={() => handleEnvironmentChange("live")}
                    disabled={isSwitching || isLoading}
                    loading={isSwitching && pendingEnvironment === "live"}
                    size="slim"
                  >
                    🚀 {t("components.environmentToggle.prodBtn")}
                  </Button>
                </ButtonGroup>
              </InlineStack>
              {currentEnvironment === "test" && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    {t("components.environmentToggle.testWarning")}
                  </Text>
                </Banner>
              )}
              {currentEnvironment === "live" && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("components.environmentToggle.prodInfo")}
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
                          {t("components.environmentToggle.versionManage")}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {t("components.environmentToggle.currentVersion")}{configVersion}
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
                          ⏪ {t("components.environmentToggle.rollback")}
                        </Button>
                      )}
                    </InlineStack>
                    {canRollback && (
                      <Banner tone="info">
                        <Text as="p" variant="bodySm">
                          {t("components.environmentToggle.rollbackInfo")}
                        </Text>
                      </Banner>
                    )}
                    {!canRollback && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("components.environmentToggle.noRollback")}
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
        title={t("components.environmentToggle.confirmSwitchTitle")}
        primaryAction={{
          content: t("components.environmentToggle.confirmSwitchBtn"),
          onAction: handleConfirmSwitch,
          loading: isSwitching,
        }}
        secondaryActions={[
          {
            content: t("components.environmentToggle.cancel"),
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
              <Trans i18nKey="components.environmentToggle.switchMessage" components={{ strong: <strong /> }} />
            </Text>
            <Banner tone="critical">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("components.environmentToggle.importantNote")}
                </Text>
                <ul style={{ paddingLeft: "1.5rem", margin: 0 }}>
                  <li>
                    <Text as="span" variant="bodySm">
                      {t("components.environmentToggle.switchWarning1")}
                    </Text>
                  </li>
                  <li>
                    <Text as="span" variant="bodySm">
                      {t("components.environmentToggle.switchWarning2")}
                    </Text>
                  </li>
                  <li>
                    <Text as="span" variant="bodySm">
                      {t("components.environmentToggle.switchWarning3")}
                    </Text>
                  </li>
                </ul>
              </BlockStack>
            </Banner>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("components.environmentToggle.confirmContinue")}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRollbackModal}
        onClose={() => setShowRollbackModal(false)}
        title={t("components.environmentToggle.confirmRollbackTitle")}
        primaryAction={{
          content: t("components.environmentToggle.confirmRollbackBtn"),
          destructive: true,
          onAction: confirmRollback,
          loading: isSwitching,
        }}
        secondaryActions={[
          {
            content: t("components.environmentToggle.cancel"),
            onAction: () => setShowRollbackModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              {t("components.environmentToggle.rollbackMessage")}
            </Text>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                {t("components.environmentToggle.rollbackWarning")}
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
