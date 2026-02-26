import { useState, useCallback, useEffect, useRef } from "react";
import { BlockStack, InlineStack, Text, Icon, Banner, List, Card, Button, Box, Link } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@remix-run/react";

interface TestingStepProps {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onComplete: () => void;
  shopId?: string;
  onEnvironmentToggle?: (platform: PlatformType, environment: "test" | "live") => void;
}

export function TestingStep({
  selectedPlatforms,
  platformConfigs,
  onComplete,
  shopId,
  onEnvironmentToggle,
}: TestingStepProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(false);
  const [isSwitchingToLive, setIsSwitchingToLive] = useState(false);
  const timeoutRefs = useRef<Array<NodeJS.Timeout>>([]);
  const [validationResults, setValidationResults] = useState<Record<string, {
    valid: boolean;
    message: string;
    details?: {
      eventSent?: boolean;
      responseTime?: number;
      error?: string;
      testEventCode?: string;
      debugViewUrl?: string;
      verificationInstructions?: string;
    }
  }>>({});
  const { showSuccess, showError } = useToastContext();
  const handleValidateTestEnvironment = useCallback(async () => {
    if (!shopId) return;
    setIsValidating(true);
    const results: Record<string, { valid: boolean; message: string; details?: { eventSent?: boolean; responseTime?: number; error?: string } }> = {};
    try {
      const validationPromises = Array.from(selectedPlatforms).map(async (platform) => {
        const formData = new FormData();
        formData.append("_action", "validateTestEnvironment");
        formData.append("platform", platform);
        formData.append("shopId", shopId);
        const response = await fetch("/app/migrate", {
          method: "POST",
          body: formData,
        });
        const data = await response.json().catch((error) => {
          import("../../../utils/debug-log.client").then(({ debugError }) => {
            debugError(`[PixelMigrationWizard] Failed to parse JSON for ${platform}:`, error);
          });
          return { valid: false, message: t("migrate.testingStep.errors.parseFailed"), details: {} };
        });
        return { platform, result: data };
      });
      const validationResults = await Promise.all(validationPromises);
      validationResults.forEach(({ platform, result }) => {
        results[platform] = {
          valid: result.valid || false,
          message: result.message || t("migrate.testingStep.errors.validationFailed", { platforms: "" }),
          details: result.details || {},
        };
      });
      setValidationResults(results);
      const allValid = Object.values(results).every((r) => r.valid);
      if (allValid) {
        showSuccess(t("migrate.testingStep.success.validationPassed"));
      } else {
        const failedPlatforms = Object.entries(results)
          .filter(([_, r]) => !r.valid)
          .map(([p]) => {
            const info = PLATFORM_INFO[p as PlatformType];
            return info?.nameKey ? t(info.nameKey, { defaultValue: p }) : p;
          })
          .join(", ");
        showError(t("migrate.testingStep.errors.validationFailed", { platforms: failedPlatforms }));
      }
    } catch (error) {
      showError(t("migrate.testingStep.errors.validationError"));
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Test environment validation error:", error);
    } finally {
      setIsValidating(false);
    }
  }, [shopId, selectedPlatforms, showSuccess, showError, t]);
  const handleSwitchToLive = useCallback(async () => {
    if (!shopId || !onEnvironmentToggle) return;
    setIsSwitchingToLive(true);
    try {
      const switchPromises = Array.from(selectedPlatforms).map(async (platform) => {
        try {
          const formData = new FormData();
          formData.append("_action", "switchEnvironment");
          formData.append("platform", platform);
          formData.append("environment", "live");
          const response = await fetch("/app/actions/pixel-config", {
            method: "POST",
            body: formData,
          });
          const data = await response.json().catch((error) => {
            import("../../../utils/debug-log.client").then(({ debugError }) => {
              debugError(`[PixelMigrationWizard] Failed to parse JSON when switching ${platform} to live:`, error);
            });
            return { success: false, error: t("migrate.testingStep.errors.parseFailed") };
          });
          if (data.success) {
            onEnvironmentToggle(platform, "live");
          }
          return { platform, success: data.success, error: data.error };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : t("migrate.testingStep.errors.unknown");
          const { debugError } = await import("../../../utils/debug-log.client");
          debugError(`[PixelMigrationWizard] Failed to switch platform ${platform}:`, error);
          return { platform, success: false, error: errorMessage };
        }
      });
      const results = await Promise.all(switchPromises);
      const allSuccess = results.every((r) => r.success);
      if (allSuccess) {
        showSuccess(t("migrate.testingStep.success.switchPassed"));
        const timeout = setTimeout(() => {
          navigate("/app/verification");
        }, 1500);
        timeoutRefs.current.push(timeout);
      } else {
        const failedPlatforms = results
          .filter((r) => !r.success)
          .map((r) => {
            const info = PLATFORM_INFO[r.platform as PlatformType];
            return info?.nameKey ? t(info.nameKey, { defaultValue: r.platform }) : r.platform;
          })
          .join(", ");
        showError(t("migrate.testingStep.errors.switchFailed", { platforms: failedPlatforms }));
      }
    } catch (error) {
      showError(t("migrate.testingStep.errors.switchError"));
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Switch to live error:", error);
    } finally {
      setIsSwitchingToLive(false);
    }
  }, [shopId, selectedPlatforms, onEnvironmentToggle, showSuccess, showError, t, navigate]);
  const handleGoToVerification = useCallback(() => {
    navigate("/app/verification");
  }, [navigate]);
  const allInTestMode = Array.from(selectedPlatforms).every(
    (platform) => platformConfigs[platform]?.environment === "test"
  );
  useEffect(() => {
    const allValid = Object.keys(validationResults).length > 0 &&
                     Object.values(validationResults).every(r => r.valid);
    let timer: NodeJS.Timeout | null = null;
    if (
      allValid &&
      !isSwitchingToLive &&
      !allInTestMode
    ) {
      timer = setTimeout(() => {
        showSuccess(t("migrate.testingStep.success.redirecting"));
        handleGoToVerification();
      }, 3000);
    }
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [validationResults, isSwitchingToLive, allInTestMode, handleGoToVerification, showSuccess, t]);
  return (
    <BlockStack gap="400">
      <InlineStack gap="200" blockAlign="center">
        <Icon source={CheckCircleIcon} tone="success" />
        <Text as="h3" variant="headingMd">
          {t("migrate.testingStep.status.saved")}
        </Text>
      </InlineStack>
      <Banner tone="success">
        <BlockStack gap="200">
          <Text as="p" fontWeight="semibold">
            {t("migrate.testingStep.status.nextStep")}
          </Text>
          <Text as="p" variant="bodySm">
            {t("migrate.testingStep.status.recommendations")}
          </Text>
          <List type="number">
            <List.Item>{t("migrate.testingStep.status.steps.validate")}</List.Item>
            <List.Item>{t("migrate.testingStep.status.steps.createOrder")}</List.Item>
            <List.Item>{t("migrate.testingStep.status.steps.monitor")}</List.Item>
            <List.Item>{t("migrate.testingStep.status.steps.verify")}</List.Item>
            <List.Item>{t("migrate.testingStep.status.steps.switch")}</List.Item>
          </List>
        </BlockStack>
      </Banner>
      <CheckoutCompletedBehaviorHint mode="info" collapsible={true} />
      {shopId && selectedPlatforms.size > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h4" variant="headingSm">
                  {t("migrate.testingStep.validation.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("migrate.testingStep.validation.description")}
                </Text>
              </BlockStack>
              <Button
                size="slim"
                variant="primary"
                onClick={handleValidateTestEnvironment}
                loading={isValidating}
                disabled={isValidating}
              >
                {isValidating ? t("migrate.testingStep.validation.validating") : t("migrate.testingStep.validation.sendEvent")}
              </Button>
            </InlineStack>
            {Object.keys(validationResults).length > 0 && (
              <BlockStack gap="200">
                {Array.from(selectedPlatforms).map((platform) => {
                  const result = validationResults[platform];
                  if (!result) return null;
                  return (
                    <Banner
                      key={platform}
                      tone={result.valid ? "success" : "critical"}
                    >
                      <BlockStack gap="200">
                        <InlineStack gap="200" blockAlign="center">
                          <Icon
                            source={result.valid ? CheckCircleIcon : AlertCircleIcon}
                            tone={result.valid ? "success" : "critical"}
                          />
                          <Text as="span" fontWeight="semibold">
                            {PLATFORM_INFO[platform]?.nameKey
                              ? t(PLATFORM_INFO[platform].nameKey, { defaultValue: platform })
                              : platform}: {t(result.message)}
                          </Text>
                        </InlineStack>
                        {result.details && (
                          <BlockStack gap="300">
                            {result.details.eventSent && (
                              <Box padding="300" background="bg-surface-success" borderRadius="200">
                                <BlockStack gap="200">
                                  <InlineStack gap="200" blockAlign="center">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <Text as="span" variant="bodySm" fontWeight="semibold">
                                      {t("migrate.testingStep.validation.eventSent")}
                                    </Text>
                                  </InlineStack>
                                  {result.details.responseTime && (
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {t("migrate.testingStep.validation.responseTime", { time: result.details.responseTime })}
                                    </Text>
                                  )}
                                </BlockStack>
                              </Box>
                            )}
                            {result.details.testEventCode && (
                              <Banner tone="info">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {t("migrate.testingStep.validation.metaCode", { code: result.details.testEventCode })}
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    {t("migrate.testingStep.validation.metaDesc")}
                                  </Text>
                                  <Link
                                    url="https://business.facebook.com/events_manager2"
                                    external
                                  >
                                    {t("migrate.testingStep.validation.openMeta")}
                                  </Link>
                                </BlockStack>
                              </Banner>
                            )}
                            {result.details.debugViewUrl && (
                              <Banner tone="info">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {t("migrate.testingStep.validation.ga4Debug")}
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    {t("migrate.testingStep.validation.ga4Desc")}
                                  </Text>
                                  <Link url={result.details.debugViewUrl} external>
                                    {t("migrate.testingStep.validation.openGa4")}
                                  </Link>
                                </BlockStack>
                              </Banner>
                            )}
                            {result.details.verificationInstructions && (
                              <Banner tone="info">
                                <Text as="span" variant="bodySm">
                                  💡 {result.details.verificationInstructions}
                                </Text>
                              </Banner>
                            )}
                            {result.details.error && (
                              <Banner tone="critical">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {t("migrate.testingStep.validation.errorDetails")}
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    {t(result.details.error || "")}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {t("migrate.testingStep.validation.checkList")}
                                  </Text>
                                  <List type="bullet">
                                    <List.Item>{t("migrate.testingStep.validation.checkItems.credentials")}</List.Item>
                                    <List.Item>{t("migrate.testingStep.validation.checkItems.network")}</List.Item>
                                    <List.Item>{t("migrate.testingStep.validation.checkItems.api")}</List.Item>
                                  </List>
                                </BlockStack>
                              </Banner>
                            )}
                            {result.valid && result.details.eventSent && (
                              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {t("migrate.testingStep.validation.eventDetails")}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {t("migrate.testingStep.validation.eventId", { id: `test-order-${Date.now()}` })}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {t("migrate.testingStep.validation.eventType", { type: platformConfigs[platform]?.eventMappings?.checkout_completed || "purchase" })}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {t("migrate.testingStep.validation.amount")}
                                  </Text>
                                </BlockStack>
                              </Box>
                            )}
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Banner>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      )}
      {allInTestMode && Object.keys(validationResults).length > 0 &&
       Object.values(validationResults).every(r => r.valid) && (
        <Card>
          <BlockStack gap="400">
            <Text as="h4" variant="headingSm">
              {t("migrate.testingStep.production.title")}
            </Text>
            <Banner tone="info">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {t("migrate.testingStep.production.successTitle")}
                </Text>
                <Text as="p" variant="bodySm">
                  {t("migrate.testingStep.production.desc")}
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {t("migrate.testingStep.production.confirmTitle")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("migrate.testingStep.production.confirmItems.credentials")}</List.Item>
                    <List.Item>{t("migrate.testingStep.production.confirmItems.eventSent")}</List.Item>
                    <List.Item>{t("migrate.testingStep.production.confirmItems.mapping")}</List.Item>
                    <List.Item>{t("migrate.testingStep.production.confirmItems.monitor")}</List.Item>
                  </List>
                </BlockStack>
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      {t("migrate.testingStep.production.tip")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {t("migrate.testingStep.production.marketingPurposeNote")}
                    </Text>
                  </BlockStack>
                </Banner>
              </BlockStack>
            </Banner>
            <Button
              variant="primary"
              onClick={handleSwitchToLive}
              loading={isSwitchingToLive}
              disabled={isSwitchingToLive}
            >
              {t("migrate.testingStep.production.action")}
            </Button>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("migrate.testingStep.production.note")}
            </Text>
          </BlockStack>
        </Card>
      )}
      {!allInTestMode && Object.keys(validationResults).length > 0 &&
       Object.values(validationResults).every(r => r.valid) && (
        <Banner tone="success">
          <BlockStack gap="200">
            <Text as="p" fontWeight="semibold">
              {t("migrate.testingStep.production.validatedTitle")}
            </Text>
            <Text as="p" variant="bodySm">
              {t("migrate.testingStep.production.redirectNote")}
            </Text>
          </BlockStack>
        </Banner>
      )}
      <InlineStack gap="200">
        <Button
          url="/app/verification"
          variant="primary"
          onClick={handleGoToVerification}
        >
          {t("migrate.testingStep.actions.runVerification")}
        </Button>
        {!allInTestMode && (
          <Button
            variant="primary"
            onClick={() => {
              onComplete();
              const timeout = setTimeout(() => {
                navigate("/app/verification");
              }, 300);
              timeoutRefs.current.push(timeout);
            }}
          >
            {t("migrate.testingStep.actions.complete")}
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );
}
