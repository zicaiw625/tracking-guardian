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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
      
      const templateName = template.id === 'standard' 
        ? t("newPixelWizard.templates.presets.standard.name") 
        : template.id === 'advanced'
          ? t("newPixelWizard.templates.presets.advanced.name")
          : template.name;
          
      showSuccess(t("newPixelWizard.templates.applied", { name: templateName }));
    },
    [platformConfigs, showSuccess, t]
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
        errors.push(t("newPixelWizard.errors.selectPlatform"));
      }
      if (step === "mappings") {
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          if (!config || Object.keys(config.eventMappings || {}).length === 0) {
            // Translate platform name if possible, or use the one from constant
            // Note: PLATFORM_INFO names are hardcoded in constants.ts. 
            // Ideally we should use translation keys for platform names too.
            // For now, we'll stick to the constant names but use translated error message structure.
            const platformName = PLATFORM_INFO[platform]?.nameKey
              ? t(PLATFORM_INFO[platform].nameKey, { defaultValue: platform })
              : platform;
            errors.push(t("newPixelWizard.errors.missingMapping", { platform: platformName }));
          }
        });
      }
      return errors;
    },
    [platformConfigs, selectedPlatforms, t]
  );

  const handleNext = useCallback(() => {
    const errors = validateStep(currentStep);
    if (errors.length > 0) {
      showError(t("newPixelWizard.errors.completeStep", { errors: errors.join("; ") }));
      return;
    }
    const currentIndex = PIXEL_SETUP_STEPS.findIndex((s) => s.id === currentStep);
    if (currentIndex < PIXEL_SETUP_STEPS.length - 1) {
      setCurrentStep(PIXEL_SETUP_STEPS[currentIndex + 1].id);
    }
  }, [currentStep, validateStep, showError, t]);

  const handleSave = useCallback(() => {
    const errors = validateStep("mappings");
    if (errors.length > 0) {
      showError(t("newPixelWizard.errors.configError", { errors: errors.join("; ") }));
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
  }, [platformConfigs, selectedPlatforms, submit, validateStep, showError, t]);

  const currentIndex = PIXEL_SETUP_STEPS.findIndex((s) => s.id === currentStep);

  const getStepLabel = (stepId: string) => {
    return t(`newPixelWizard.steps.${stepId}`);
  };

  return (
    <>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("newPixelWizard.progress")}
            </Text>
            <Badge tone="info">{t("newPixelWizard.stepIndicator", { current: currentIndex + 1, total: PIXEL_SETUP_STEPS.length })}</Badge>
          </InlineStack>
          <InlineStack gap="300" wrap>
            {PIXEL_SETUP_STEPS.map((step, index) => (
              <Badge
                key={step.id}
                tone={
                  index === currentIndex ? "success" : index < currentIndex ? "info" : undefined
                }
              >
                {getStepLabel(step.id)}
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
            {t("newPixelWizard.actions.cancel")}
          </Button>
          <InlineStack gap="200" wrap>
            {currentIndex > 0 && (
              <Button
                onClick={() => setCurrentStep(PIXEL_SETUP_STEPS[currentIndex - 1].id)}
                disabled={isSubmitting}
              >
                {t("newPixelWizard.actions.prev")}
              </Button>
            )}
            {currentStep !== "review" ? (
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={isSubmitting}
                icon={ArrowRightIcon}
              >
                {t("newPixelWizard.actions.next")}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSubmitting}
                icon={CheckCircleIcon}
                disabled={!isStarterOrAbove}
              >
                {t("newPixelWizard.actions.saveAndTest")}
              </Button>
            )}
          </InlineStack>
        </InlineStack>
      </Card>

      <Modal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        title={t("newPixelWizard.templates.title")}
        primaryAction={{
          content: t("newPixelWizard.actions.close"),
          onAction: () => setShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              {t("newPixelWizard.templates.description")}
            </Text>
            {availableTemplates.map((template) => {
              if (!template) return null;
              
              const templateName = template.id === 'standard' 
                ? t("newPixelWizard.templates.presets.standard.name") 
                : template.id === 'advanced'
                  ? t("newPixelWizard.templates.presets.advanced.name")
                  : template.name;
                  
              const templateDesc = template.id === 'standard' 
                ? t("newPixelWizard.templates.presets.standard.description") 
                : template.id === 'advanced'
                  ? t("newPixelWizard.templates.presets.advanced.description")
                  : template.description;
              
              return (
                <Card key={template.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {templateName}
                          </Text>
                          {template.isPublic && <Badge tone="info">{t("newPixelWizard.templates.public")}</Badge>}
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {templateDesc}
                        </Text>
                      </BlockStack>
                      <Button size="slim" onClick={() => handleApplyTemplate(template)}>
                        {t("newPixelWizard.actions.apply")}
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
