import { useCallback, useMemo, useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Modal,
} from "@shopify/polaris";
import { ArrowRightIcon, CheckCircleIcon } from "~/components/icons";
import type { WizardTemplate } from "~/components/migrate/PixelMigrationWizard";
import {
  PIXEL_SETUP_STEPS,
  PRESET_TEMPLATES,
  SUPPORTED_PLATFORMS,
  DEFAULT_EVENT_MAPPINGS,
  PLATFORM_INFO,
  type SetupStep,
  type SupportedPlatform,
  type PlatformConfig,
} from "./constants";
import { SelectPlatformStep } from "./steps/SelectPlatformStep";
import { MappingsStep } from "./steps/MappingsStep";
import { CredentialsStep } from "./steps/CredentialsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { areCredentialsComplete } from "~/components/forms/PlatformCredentialsForm";

export interface NewPixelWizardProps {
  templates: { presets?: WizardTemplate[]; custom?: WizardTemplate[] } | null;
  isStarterOrAbove: boolean;
  backendUrlInfo: { placeholderDetected?: boolean; isConfigured?: boolean } | null;
  submit: (formData: FormData, options: { method: "post" }) => void;
  isSubmitting: boolean;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

const initialConfigs = (): Partial<Record<SupportedPlatform, PlatformConfig>> => ({
  google: {
    platform: "google",
    enabled: false,
    platformId: "",
    credentials: {},
    eventMappings: DEFAULT_EVENT_MAPPINGS.google,
    environment: "test",
  },
  meta: {
    platform: "meta",
    enabled: false,
    platformId: "",
    credentials: {},
    eventMappings: DEFAULT_EVENT_MAPPINGS.meta,
    environment: "test",
  },
  tiktok: {
    platform: "tiktok",
    enabled: false,
    platformId: "",
    credentials: {},
    eventMappings: DEFAULT_EVENT_MAPPINGS.tiktok,
    environment: "test",
  },
});

export function NewPixelWizard({
  templates,
  isStarterOrAbove,
  backendUrlInfo,
  submit,
  isSubmitting,
  showSuccess,
  showError,
}: NewPixelWizardProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>("select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<SupportedPlatform>>(new Set());
  const [platformConfigs, setPlatformConfigs] = useState<Partial<Record<SupportedPlatform, PlatformConfig>>>(initialConfigs);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const availableTemplates = useMemo(() => {
    const presetTemplates = templates?.presets?.length ? templates.presets : PRESET_TEMPLATES;
    const customTemplates = templates?.custom || [];
    return [...presetTemplates, ...customTemplates].filter(
      (t) =>
        t &&
        t.platforms &&
        t.platforms.every((p) => SUPPORTED_PLATFORMS.includes(p as SupportedPlatform))
    );
  }, [templates]);

  const handlePlatformToggle = useCallback((platform: SupportedPlatform, enabled: boolean) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(platform);
      else next.delete(platform);
      return next;
    });
    setPlatformConfigs((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], enabled } as PlatformConfig,
    }));
  }, []);

  const handleApplyTemplate = useCallback(
    (template: WizardTemplate) => {
      const configs = { ...platformConfigs };
      const platforms = new Set<SupportedPlatform>();
      template.platforms.forEach((platform) => {
        if (!SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform)) return;
        const platformKey = platform as SupportedPlatform;
        platforms.add(platformKey);
        const existingConfig = configs[platformKey];
        if (existingConfig) {
          configs[platformKey] = {
            ...existingConfig,
            enabled: true,
            eventMappings: template.eventMappings[platform] || existingConfig.eventMappings,
          };
        } else {
          configs[platformKey] = {
            platform: platformKey,
            enabled: true,
            platformId: "",
            credentials: {},
            eventMappings: template.eventMappings[platform] || {},
            environment: "test",
          };
        }
      });
      setSelectedPlatforms(platforms);
      setPlatformConfigs(configs);
      setShowTemplateModal(false);
      showSuccess(`已应用模板「${template.name}」`);
    },
    [platformConfigs, showSuccess]
  );

  const handleEventMappingUpdate = useCallback(
    (platform: SupportedPlatform, shopifyEvent: string, platformEvent: string) => {
      setPlatformConfigs((prev) => {
        const currentConfig = prev[platform];
        if (!currentConfig) return prev;
        return {
          ...prev,
          [platform]: {
            ...currentConfig,
            eventMappings: {
              ...currentConfig.eventMappings,
              [shopifyEvent]: platformEvent,
            },
          },
        };
      });
    },
    []
  );

  const handleCredentialsChange = useCallback(
    (platform: SupportedPlatform, credentials: Record<string, string>) => {
      setPlatformConfigs((prev) => {
        const currentConfig = prev[platform];
        if (!currentConfig) return prev;
        return {
          ...prev,
          [platform]: { ...currentConfig, credentials },
        };
      });
    },
    []
  );

  const validateStep = useCallback(
    (step: SetupStep) => {
      const errors: string[] = [];
      if (step === "select" && selectedPlatforms.size === 0) {
        errors.push("请至少选择一个平台");
      }
      if (step === "mappings") {
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          if (!config || Object.keys(config.eventMappings || {}).length === 0) {
            errors.push(`${PLATFORM_INFO[platform]?.name || platform}: 至少需要配置一个事件映射`);
          }
        });
      }
      return errors;
    },
    [platformConfigs, selectedPlatforms]
  );

  const handleNext = useCallback(() => {
    const errors = validateStep(currentStep);
    if (errors.length > 0) {
      showError(`请先完成当前步骤：${errors.join("; ")}`);
      return;
    }
    const currentIndex = PIXEL_SETUP_STEPS.findIndex((s) => s.id === currentStep);
    if (currentIndex < PIXEL_SETUP_STEPS.length - 1) {
      setCurrentStep(PIXEL_SETUP_STEPS[currentIndex + 1].id);
    }
  }, [currentStep, validateStep, showError]);

  const handleSave = useCallback(() => {
    const errors = validateStep("mappings");
    if (errors.length > 0) {
      showError(`配置错误：${errors.join("; ")}`);
      return;
    }
    const configs = Array.from(selectedPlatforms).map((platform) => {
      const config = platformConfigs[platform] as PlatformConfig;
      const creds = config.credentials ?? {};
      const serverSideEnabled = areCredentialsComplete(platform, creds as unknown as Parameters<typeof areCredentialsComplete>[1]);
      return {
        platform,
        platformId: config.platformId,
        credentials: creds,
        serverSideEnabled,
        eventMappings: config.eventMappings,
        environment: config.environment,
      };
    });
    const formData = new FormData();
    formData.append("_action", "savePixelConfigs");
    formData.append("configs", JSON.stringify(configs));
    submit(formData, { method: "post" });
  }, [platformConfigs, selectedPlatforms, submit, validateStep, showError]);

  const currentIndex = PIXEL_SETUP_STEPS.findIndex((s) => s.id === currentStep);

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              配置进度
            </Text>
            <Badge tone="info">{`步骤 ${currentIndex + 1} / ${PIXEL_SETUP_STEPS.length}`}</Badge>
          </InlineStack>
          <InlineStack gap="300" wrap>
            {PIXEL_SETUP_STEPS.map((step, index) => (
              <Badge
                key={step.id}
                tone={
                  index === currentIndex ? "success" : index < currentIndex ? "info" : undefined
                }
              >
                {step.label}
              </Badge>
            ))}
          </InlineStack>
        </BlockStack>
      </Card>

      {currentStep === "select" && (
        <SelectPlatformStep
          selectedPlatforms={selectedPlatforms}
          onPlatformToggle={handlePlatformToggle}
          onOpenTemplateModal={() => setShowTemplateModal(true)}
        />
      )}
      {currentStep === "mappings" && (
        <MappingsStep
          selectedPlatforms={selectedPlatforms}
          platformConfigs={platformConfigs}
          onEventMappingUpdate={handleEventMappingUpdate}
        />
      )}
      {currentStep === "credentials" && (
        <CredentialsStep
          selectedPlatforms={selectedPlatforms}
          platformConfigs={platformConfigs}
          onCredentialsChange={handleCredentialsChange}
        />
      )}
      {currentStep === "review" && (
        <ReviewStep
          selectedPlatforms={selectedPlatforms}
          platformConfigs={platformConfigs}
          backendUrlInfo={backendUrlInfo}
        />
      )}

      <Card>
        <InlineStack align="space-between" wrap>
          <Button url="/app/pixels" disabled={isSubmitting}>
            取消
          </Button>
          <InlineStack gap="200" wrap>
            {currentIndex > 0 && (
              <Button
                onClick={() => setCurrentStep(PIXEL_SETUP_STEPS[currentIndex - 1].id)}
                disabled={isSubmitting}
              >
                上一步
              </Button>
            )}
            {currentStep !== "review" ? (
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={isSubmitting}
                icon={ArrowRightIcon}
              >
                下一步
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSubmitting}
                icon={CheckCircleIcon}
                disabled={!isStarterOrAbove}
              >
                保存配置并测试
              </Button>
            )}
          </InlineStack>
        </InlineStack>
      </Card>

      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title="选择预设模板"
        primaryAction={{
          content: "关闭",
          onAction: () => setShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              选择一个预设模板快速配置多个平台的事件映射。
            </Text>
            {availableTemplates.map((template) => {
              if (!template) return null;
              return (
                <Card key={template.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {template.name}
                          </Text>
                          {template.isPublic && <Badge tone="info">公开</Badge>}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {template.description}
                        </Text>
                      </BlockStack>
                      <Button size="slim" onClick={() => handleApplyTemplate(template)}>
                        应用
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              );
            })}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
