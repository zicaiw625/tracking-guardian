import { useState, useCallback, useEffect, useRef } from "react";
import { BlockStack, InlineStack, Text, Icon, Banner, List, Card, Button, Box, Link } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import type { PlatformType } from "~/types/enums";
import type { PlatformConfig } from "./useWizardState";
import { PLATFORM_INFO } from "./constants";

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
          return { valid: false, message: "解析响应失败", details: {} };
        });
        return { platform, result: data };
      });
      const validationResults = await Promise.all(validationPromises);
      validationResults.forEach(({ platform, result }) => {
        results[platform] = {
          valid: result.valid || false,
          message: result.message || "验证失败",
          details: result.details || {},
        };
      });
      setValidationResults(results);
      const allValid = Object.values(results).every((r) => r.valid);
      if (allValid) {
        showSuccess("所有平台测试环境配置验证通过！测试事件已成功发送。");
      } else {
        const failedPlatforms = Object.entries(results)
          .filter(([_, r]) => !r.valid)
          .map(([p]) => PLATFORM_INFO[p as PlatformType]?.name || p)
          .join(", ");
        showError(`部分平台配置验证失败: ${failedPlatforms}。请检查配置和凭证。`);
      }
    } catch (error) {
      showError("验证过程中发生错误");
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Test environment validation error:", error);
    } finally {
      setIsValidating(false);
    }
  }, [shopId, selectedPlatforms, showSuccess, showError]);
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
            return { success: false, error: "解析响应失败" };
          });
          if (data.success) {
            onEnvironmentToggle(platform, "live");
          }
          return { platform, success: data.success, error: data.error };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          const { debugError } = await import("../../../utils/debug-log.client");
          debugError(`[PixelMigrationWizard] Failed to switch platform ${platform}:`, error);
          return { platform, success: false, error: errorMessage };
        }
      });
      const results = await Promise.all(switchPromises);
      const allSuccess = results.every((r) => r.success);
      if (allSuccess) {
        showSuccess("所有平台已切换到生产模式！");
        const timeout = setTimeout(() => {
          window.location.href = "/app/verification";
        }, 1500);
        timeoutRefs.current.push(timeout);
      } else {
        const failedPlatforms = results
          .filter((r) => !r.success)
          .map((r) => PLATFORM_INFO[r.platform as PlatformType]?.name || r.platform)
          .join(", ");
        showError(`部分平台切换失败: ${failedPlatforms}。请稍后重试。`);
      }
    } catch (error) {
      showError("切换环境时发生错误");
      const { debugError } = await import("../../../utils/debug-log.client");
      debugError("[PixelMigrationWizard] Switch to live error:", error);
    } finally {
      setIsSwitchingToLive(false);
    }
  }, [shopId, selectedPlatforms, onEnvironmentToggle, showSuccess, showError]);
  const handleGoToVerification = useCallback(() => {
    window.location.href = "/app/verification";
  }, []);
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
        showSuccess("配置验证通过！正在跳转到验收页面...");
        handleGoToVerification();
      }, 3000);
    }
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [validationResults, isSwitchingToLive, allInTestMode, handleGoToVerification, showSuccess]);
  return (
    <BlockStack gap="400">
      <InlineStack gap="200" blockAlign="center">
        <Icon source={CheckCircleIcon} tone="success" />
        <Text as="h3" variant="headingMd">
          配置已保存
        </Text>
      </InlineStack>
      <Banner tone="success">
        <BlockStack gap="200">
          <Text as="p" fontWeight="semibold">
            下一步：测试验证
          </Text>
          <Text as="p" variant="bodySm">
            配置已保存。建议您：
          </Text>
          <List type="number">
            <List.Item>验证测试环境配置（可选）</List.Item>
            <List.Item>创建一个测试订单</List.Item>
            <List.Item>在「监控」页面查看事件是否成功发送</List.Item>
            <List.Item>在「验收」页面运行验收测试</List.Item>
            <List.Item>验证无误后，在设置页面将环境切换为「生产模式」</List.Item>
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
                  测试环境验证
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  发送测试事件到各平台，验证配置是否正确
                </Text>
              </BlockStack>
              <Button
                size="slim"
                variant="primary"
                onClick={handleValidateTestEnvironment}
                loading={isValidating}
                disabled={isValidating}
              >
                {isValidating ? "验证中..." : "发送测试事件"}
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
                            {PLATFORM_INFO[platform]?.name || platform}: {result.message}
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
                                      测试事件已成功发送
                                    </Text>
                                  </InlineStack>
                                  {result.details.responseTime && (
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      响应时间: {result.details.responseTime}ms
                                    </Text>
                                  )}
                                </BlockStack>
                              </Box>
                            )}
                            {result.details.testEventCode && (
                              <Banner tone="info">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    Meta Test Event Code: {result.details.testEventCode}
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    请在 Meta Events Manager 的「测试事件」页面查看此事件。
                                    如果看到测试事件，说明配置正确。
                                  </Text>
                                  <Link
                                    url="https://business.facebook.com/events_manager2"
                                    external
                                  >
                                    打开 Meta Events Manager
                                  </Link>
                                </BlockStack>
                              </Banner>
                            )}
                            {result.details.debugViewUrl && (
                              <Banner tone="info">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    GA4 DebugView
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    测试事件已发送，请在 GA4 DebugView 中查看实时事件流。
                                  </Text>
                                  <Link url={result.details.debugViewUrl} external>
                                    打开 GA4 DebugView
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
                                    错误详情
                                  </Text>
                                  <Text as="span" variant="bodySm">
                                    {result.details.error}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    请检查：
                                  </Text>
                                  <List type="bullet">
                                    <List.Item>平台凭证是否正确</List.Item>
                                    <List.Item>网络连接是否正常</List.Item>
                                    <List.Item>平台 API 是否可用</List.Item>
                                  </List>
                                </BlockStack>
                              </Banner>
                            )}
                            {result.valid && result.details.eventSent && (
                              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    测试事件详情
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    事件 ID: test-order-{Date.now()}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    事件类型: {platformConfigs[platform]?.eventMappings?.checkout_completed || "purchase"}
                                  </Text>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    测试金额: $1.00 USD
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
              切换到生产模式
            </Text>
            <Banner tone="info">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  测试验证通过！现在可以切换到生产模式。
                </Text>
                <Text as="p" variant="bodySm">
                  切换后，事件将发送到实际广告平台，并开始追踪真实订单转化。
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    切换前请确认：
                  </Text>
                  <List type="bullet">
                    <List.Item>所有平台的凭证已正确配置</List.Item>
                    <List.Item>测试事件已成功发送并可在平台中查看</List.Item>
                    <List.Item>事件映射配置符合您的业务需求</List.Item>
                    <List.Item>已了解如何查看和监控生产环境事件</List.Item>
                  </List>
                </BlockStack>
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    💡 提示：切换到生产模式后，建议先运行一次验收测试，确保所有事件正常发送。
                    您可以在「验收向导」页面进行完整的验收测试。
                  </Text>
                </Banner>
              </BlockStack>
            </Banner>
            <Button
              variant="primary"
              onClick={handleSwitchToLive}
              loading={isSwitchingToLive}
              disabled={isSwitchingToLive}
            >
              切换到生产模式并前往验收
            </Button>
            <Text as="p" variant="bodySm" tone="subdued">
              切换后，您可以在「设置」页面随时切换回测试模式或回滚配置。
            </Text>
          </BlockStack>
        </Card>
      )}
      {!allInTestMode && Object.keys(validationResults).length > 0 &&
       Object.values(validationResults).every(r => r.valid) && (
        <Banner tone="success">
          <BlockStack gap="200">
            <Text as="p" fontWeight="semibold">
              ✅ 配置验证通过！建议您运行验收测试以确保一切正常。
            </Text>
            <Text as="p" variant="bodySm">
              系统将在 3 秒后自动跳转到验收页面，您也可以手动点击下方按钮。
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
          运行验收测试
        </Button>
        {!allInTestMode && (
          <Button
            variant="primary"
            onClick={() => {
              onComplete();
              const timeout = setTimeout(() => {
                window.location.href = "/app/verification";
              }, 300);
              timeoutRefs.current.push(timeout);
            }}
          >
            ✅ 完成并前往验收
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );
}
