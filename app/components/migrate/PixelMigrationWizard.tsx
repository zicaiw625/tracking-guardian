import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ArrowRightIcon,
} from "~/components/icons";
import { useSubmit, useNavigation } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import type { PlatformType } from "~/types/enums";
import { isV1SupportedPlatform } from "~/utils/v1-platforms";
import { SelectPlatformStep } from "./PixelMigrationWizard/SelectPlatformStep";
import { CredentialsStep } from "./PixelMigrationWizard/CredentialsStep";
import { EventMappingsStep } from "./PixelMigrationWizard/EventMappingsStep";
import { ReviewStep } from "./PixelMigrationWizard/ReviewStep";
import { TestingStep } from "./PixelMigrationWizard/TestingStep";
import { useWizardState, type PlatformConfig } from "./PixelMigrationWizard/useWizardState";
import { WIZARD_STEPS, type WizardStep } from "./PixelMigrationWizard/steps";
import { DEFAULT_EVENT_MAPPINGS, PLATFORM_INFO } from "./PixelMigrationWizard/constants";

export interface WizardTemplate {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  eventMappings: Record<string, Record<string, string>>;
  isPublic: boolean;
  usageCount: number;
}

export interface PrefillAsset {
  id: string;
  platform: string | null;
  category: string;
  displayName: string | null;
  suggestedMigration: string;
  details?: Record<string, unknown> | null;
}

export interface PixelMigrationWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  initialPlatforms?: PlatformType[];
  canManageMultiple?: boolean;
  shopId?: string;
  templates?: {
    presets: WizardTemplate[];
    custom: WizardTemplate[];
  };
  wizardDraft?: {
    step: "select" | "credentials" | "mappings" | "review" | "testing";
    selectedPlatforms: string[];
    configs: Record<string, {
      platform: string;
      platformId: string;
      credentials: Record<string, string>;
      eventMappings: Record<string, string>;
      environment: "test" | "live";
    }>;
  } | null;
  prefillAsset?: PrefillAsset | null;
  pixelConfigs?: Array<{
    platform: string;
    environment: string;
    configVersion: number;
    previousConfig: unknown;
    rollbackAllowed: boolean;
  }>;
}


export function PixelMigrationWizard({
  onComplete,
  onCancel,
  initialPlatforms = [],
  canManageMultiple: _canManageMultiple = false,
  shopId,
  templates,
  wizardDraft,
  prefillAsset,
  pixelConfigs,
}: PixelMigrationWizardProps) {
  const { t } = useTranslation();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  const extractPlatformIdFromAsset = useCallback((asset: PrefillAsset, platform: PlatformType): string => {
    if (!asset.details) return "";
    const details = asset.details as Record<string, unknown>;
    const matchedPatterns = details.matchedPatterns as string[] | undefined;
    if (matchedPatterns && matchedPatterns.length > 0) {
      for (const pattern of matchedPatterns) {
        if (platform === "google") {
          const ga4Match = pattern.match(/G-[A-Z0-9]{10,}/i);
          if (ga4Match && ga4Match.length > 0 && ga4Match[0]) {
            return ga4Match[0];
          }
        }
        if (platform === "meta") {
          const metaMatch = pattern.match(/\d{15,16}/);
          if (metaMatch && metaMatch.length > 0 && metaMatch[0]) {
            return metaMatch[0];
          }
        }
        if (platform === "tiktok") {
          const tiktokMatch = pattern.match(/[A-Z0-9]{8,}/i);
          if (tiktokMatch && tiktokMatch.length > 0 && tiktokMatch[0]) {
            return tiktokMatch[0];
          }
        }
      }
    }
    const content = details.content as string | undefined;
    if (content) {
      if (platform === "google") {
        const ga4Match = content.match(/G-[A-Z0-9]{10,}/i);
        if (ga4Match && ga4Match.length > 0 && ga4Match[0]) {
          return ga4Match[0];
        }
      }
      if (platform === "meta") {
        const metaMatch = content.match(/(?:fbq\s*\(['"]init['"]\s*,\s*['"]?|pixel[_-]?id['":\s]+)(\d{15,16})/i);
        if (metaMatch && metaMatch.length > 1 && metaMatch[1]) {
          return metaMatch[1];
        }
      }
      if (platform === "tiktok") {
        const tiktokMatch = content.match(/ttq\s*\.\s*load\s*\(['"]?([A-Z0-9]+)['"]?/i);
        if (tiktokMatch && tiktokMatch.length > 1 && tiktokMatch[1]) {
          return tiktokMatch[1];
        }
      }
    }
    return "";
  }, []);
  const initializeFromDraft = useCallback(() => {
    if (wizardDraft) {
      const draftPlatforms = new Set<PlatformType>(wizardDraft.selectedPlatforms as PlatformType[]);
      const draftConfigs: Partial<Record<PlatformType, PlatformConfig>> = {
        google: {
          platform: "google",
          enabled: draftPlatforms.has("google"),
          platformId: wizardDraft.configs.google?.platformId || "",
          credentials: wizardDraft.configs.google?.credentials || {},
          eventMappings: wizardDraft.configs.google?.eventMappings || DEFAULT_EVENT_MAPPINGS.google || {},
          environment: wizardDraft.configs.google?.environment || "test",
        },
        meta: {
          platform: "meta",
          enabled: draftPlatforms.has("meta"),
          platformId: wizardDraft.configs.meta?.platformId || "",
          credentials: wizardDraft.configs.meta?.credentials || {},
          eventMappings: wizardDraft.configs.meta?.eventMappings || DEFAULT_EVENT_MAPPINGS.meta || {},
          environment: wizardDraft.configs.meta?.environment || "test",
        },
        tiktok: {
          platform: "tiktok",
          enabled: draftPlatforms.has("tiktok"),
          platformId: wizardDraft.configs.tiktok?.platformId || "",
          credentials: wizardDraft.configs.tiktok?.credentials || {},
          eventMappings: wizardDraft.configs.tiktok?.eventMappings || DEFAULT_EVENT_MAPPINGS.tiktok || {},
          environment: wizardDraft.configs.tiktok?.environment || "test",
        },
      };
      return {
        step: wizardDraft.step as WizardStep,
        platforms: draftPlatforms,
        configs: draftConfigs,
      };
    }
    return null;
  }, [wizardDraft]);
  const draftData = initializeFromDraft();
  const initializeFromAsset = useCallback(() => {
    if (!prefillAsset || !prefillAsset.platform) return null;
    const platform = prefillAsset.platform as PlatformType;
    if (!isV1SupportedPlatform(platform)) return null;
    const platformId = extractPlatformIdFromAsset(prefillAsset, platform);
    return {
      platforms: new Set<PlatformType>([platform]),
      configs: {
        google: {
          platform: "google",
          enabled: platform === "google",
          platformId: platform === "google" ? platformId : "",
          credentials: {},
          eventMappings: DEFAULT_EVENT_MAPPINGS.google || {},
          environment: "test",
        },
        meta: {
          platform: "meta",
          enabled: platform === "meta",
          platformId: platform === "meta" ? platformId : "",
          credentials: {},
          eventMappings: DEFAULT_EVENT_MAPPINGS.meta || {},
          environment: "test",
        },
        tiktok: {
          platform: "tiktok",
          enabled: platform === "tiktok",
          platformId: platform === "tiktok" ? platformId : "",
          credentials: {},
          eventMappings: DEFAULT_EVENT_MAPPINGS.tiktok || {},
          environment: "test",
        },
      },
    };
  }, [prefillAsset, extractPlatformIdFromAsset]);
  const assetData = initializeFromAsset();
  const defaultConfigs: Partial<Record<PlatformType, PlatformConfig>> = {
    google: {
      platform: "google" as PlatformType,
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.google || {},
      environment: "test" as const,
    },
    meta: {
      platform: "meta" as PlatformType,
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.meta || {},
      environment: "test" as const,
    },
    tiktok: {
      platform: "tiktok" as PlatformType,
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.tiktok || {},
      environment: "test" as const,
    },
  };
  const wizardState = useWizardState({
    initialStep: draftData?.step || "select",
    initialPlatforms: draftData?.platforms ? Array.from(draftData.platforms) : (assetData?.platforms ? Array.from(assetData.platforms) : initialPlatforms),
    shopId,
    wizardDraft: wizardDraft ? {
      step: wizardDraft.step as WizardStep,
      selectedPlatforms: wizardDraft.selectedPlatforms as PlatformType[],
      configs: draftData?.configs || {},
    } : undefined,
    prefillAsset: prefillAsset ? {
      platform: prefillAsset.platform as PlatformType,
      details: prefillAsset.details || {},
    } : undefined,
    defaultConfigs: (draftData?.configs || assetData?.configs || defaultConfigs) as Partial<Record<PlatformType, PlatformConfig>>,
  });
  const {
    currentStep,
    setCurrentStep,
    selectedPlatforms,
    platformConfigs,
    showTemplateModal,
    setShowTemplateModal,
    handlePlatformToggle,
    handleCredentialUpdate,
    handleEventMappingUpdate,
    handleEnvironmentToggle,
    clearDraft,
  } = wizardState;
  const steps = WIZARD_STEPS;
  const currentStepIndex = useMemo(() => {
    return steps.findIndex((step) => step.id === currentStep);
  }, [currentStep, steps]);
  const progress = useMemo(() => {
    return ((currentStepIndex + 1) / steps.length) * 100;
  }, [currentStepIndex, steps.length]);
  const handleApplyTemplate = useCallback((template: WizardTemplate) => {
    const templatePlatforms = template.platforms as PlatformType[];
    templatePlatforms.forEach((platform) => {
      handlePlatformToggle(platform, true);
      if (template.eventMappings[platform]) {
        Object.entries(template.eventMappings[platform]).forEach(([shopifyEvent, platformEvent]) => {
          handleEventMappingUpdate(platform, shopifyEvent, platformEvent);
        });
      }
    });
    setShowTemplateModal(false);
  }, [handlePlatformToggle, handleEventMappingUpdate, setShowTemplateModal]);
  const allTemplates: WizardTemplate[] = useMemo(() => [
    ...(templates?.presets || []),
    ...(templates?.custom || []),
  ], [templates]);
  const isSubmitting = navigation.state === "submitting";
  const validateConfig = useCallback((platform: PlatformType): string[] => {
    const config = platformConfigs[platform];
    const errors: string[] = [];
    const info = PLATFORM_INFO[platform];
    if (!config || !info) return errors;
    if (!config.enabled) return errors;
    info.credentialFields.forEach((field) => {
      if (field.key === "testEventCode") return;
      if (!config.credentials[field.key as keyof typeof config.credentials]) {
        errors.push(t("pixelWizard.validation.missingField", { name: info.name, label: field.label }));
      }
    });
    return errors;
  }, [platformConfigs, t]);
  const canProceedToNextStep = useCallback((): { canProceed: boolean; errors: string[] } => {
    const errors: string[] = [];
    switch (currentStep) {
      case "select":
        if (selectedPlatforms.size === 0) {
          errors.push(t("pixelWizard.validation.selectPlatform"));
        }
        break;
      case "credentials":
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          const info = PLATFORM_INFO[platform];
          if (!config || !info) return;
          info.credentialFields.forEach((field) => {
            if (field.key === "testEventCode") return;
            if (!config.credentials[field.key as keyof typeof config.credentials]) {
              errors.push(t("pixelWizard.validation.missingField", { name: info.name, label: field.label }));
            }
          });
        });
        break;
      case "mappings":
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          if (!config) {
            errors.push(t("pixelWizard.validation.configNotFound", { name: PLATFORM_INFO[platform]?.name || platform }));
            return;
          }
          if (!config.eventMappings || Object.keys(config.eventMappings).length === 0) {
            errors.push(t("pixelWizard.validation.needEventMapping", { name: PLATFORM_INFO[platform]?.name || platform }));
          }
        });
        break;
      case "review":
        Array.from(selectedPlatforms).forEach((platform) => {
          const configErrors = validateConfig(platform);
          errors.push(...configErrors);
        });
        break;
      case "testing":
        break;
    }
    return {
      canProceed: errors.length === 0,
      errors,
    };
  }, [currentStep, selectedPlatforms, platformConfigs, validateConfig, t]);
  const handleSkip = useCallback(() => {
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStep(steps[nextStepIndex].id);
    }
  }, [currentStepIndex, steps, setCurrentStep]);
  const handleSave = useCallback(async () => {
    const enabledPlatforms = Array.from(selectedPlatforms);
    const allErrors: string[] = [];
    enabledPlatforms.forEach((platform) => {
      const errors = validateConfig(platform);
      allErrors.push(...errors);
    });
    if (allErrors.length > 0) {
      showError(t("pixelWizard.validation.configError", { errors: allErrors.join("; ") }));
      return;
    }
    const configs = enabledPlatforms.map((platform) => {
      const config = platformConfigs[platform];
      if (!config) {
        throw new Error(t("pixelWizard.validation.configMissing", { platform }));
      }
      return {
        platform,
        platformId: config.platformId,
        credentials: config.credentials,
        eventMappings: config.eventMappings,
        environment: config.environment,
      };
    });
    const formData = new FormData();
    formData.append("_action", "saveWizardConfigs");
    formData.append("configs", JSON.stringify(configs));
    submit(formData, {
      method: "post",
    });
    await clearDraft();
    showSuccess(t("pixelWizard.toast.configSaved"));
    setCurrentStep("testing");
  }, [selectedPlatforms, platformConfigs, validateConfig, submit, showSuccess, showError, clearDraft, setCurrentStep, t]);
  const handleNext = useCallback(() => {
    const validation = canProceedToNextStep();
    if (!validation.canProceed) {
      showError(t("pixelWizard.validation.completeStep", { errors: validation.errors.join("; ") }));
      return;
    }
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStep(steps[nextStepIndex].id);
    }
  }, [currentStepIndex, steps, canProceedToNextStep, showError, setCurrentStep, t]);
  const renderStepContent = () => {
    switch (currentStep) {
      case "select":
        return (
          <SelectPlatformStep
            selectedPlatforms={selectedPlatforms}
            platformConfigs={platformConfigs}
            onPlatformToggle={handlePlatformToggle}
            onApplyTemplate={handleApplyTemplate}
            showTemplateModal={showTemplateModal}
            onShowTemplateModal={setShowTemplateModal}
            templates={allTemplates}
          />
        );
      case "credentials":
        return (
          <CredentialsStep
            selectedPlatforms={selectedPlatforms}
            platformConfigs={platformConfigs}
            onCredentialUpdate={handleCredentialUpdate}
            onEnvironmentToggle={handleEnvironmentToggle}
          />
        );
      case "mappings":
        return (
          <EventMappingsStep
            selectedPlatforms={selectedPlatforms}
            platformConfigs={platformConfigs}
            onEventMappingUpdate={handleEventMappingUpdate}
          />
        );
      case "review":
        return (
          <ReviewStep
            selectedPlatforms={selectedPlatforms}
            platformConfigs={platformConfigs}
            onValidate={validateConfig}
            shopId={shopId}
            onEnvironmentToggle={handleEnvironmentToggle}
            pixelConfigs={pixelConfigs}
          />
        );
      case "testing":
        return (
          <TestingStep
            selectedPlatforms={selectedPlatforms}
            platformConfigs={platformConfigs}
            onComplete={onComplete}
            shopId={shopId}
            onEnvironmentToggle={handleEnvironmentToggle}
          />
        );
      default:
        return null;
    }
  };
  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {t("pixelWizard.title")}
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">
                {t("pixelWizard.progress.step", { current: currentStepIndex + 1, total: steps.length })}
              </Badge>
              <Badge>
                {t("pixelWizard.progress.complete", { percent: String(Math.round(progress)) })}
              </Badge>
            </InlineStack>
          </InlineStack>
          <ProgressBar progress={progress} tone="primary" size="small" />
          <div
            style={{
              paddingBlockStart: "var(--p-space-300)",
              paddingBlockEnd: "var(--p-space-200)",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <Box position="relative">
              <InlineStack gap="0" wrap={false} align="start">
                {steps.map((step, index) => {
                  const isCompleted = index < currentStepIndex;
                  const isCurrent = index === currentStepIndex;
                  const isUpcoming = index > currentStepIndex;
                  return (
                    <div
                      key={step.id}
                      style={{
                        minWidth: "100px",
                        maxWidth: "180px",
                        padding: "var(--p-space-200)",
                        flexShrink: 0,
                        position: "relative",
                      }}
                    >
                      <BlockStack gap="200" align="center">
                      <div
                        style={{
                          background: isCompleted
                            ? "var(--p-color-bg-fill-success)"
                            : isCurrent
                              ? "var(--p-color-bg-fill-info)"
                              : "var(--p-color-bg-surface-secondary)",
                          padding: "var(--p-space-200)",
                          borderRadius: "9999px",
                          minWidth: "36px",
                          minHeight: "36px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="bold"
                            alignment="center"
                          >
                            {isCompleted ? "✓" : String(step.number)}
                          </Text>
                        </div>
                        <BlockStack gap="050" align="center">
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight={isCurrent ? "bold" : "regular"}
                            tone={isUpcoming ? "subdued" : undefined}
                            alignment="center"
                          >
                            {step.label}
                          </Text>
                          {isCurrent && (
                            <Text
                              as="span"
                              variant="bodySm"
                              tone="subdued"
                              alignment="center"
                            >
                              {step.estimatedTime}
                            </Text>
                          )}
                        </BlockStack>
                      </BlockStack>
                      {index < steps.length - 1 && (
                        <div
                          style={{
                            position: "absolute",
                            left: "calc(50% + 18px)",
                            top: "18px",
                            width: "calc(100% - 36px)",
                            height: "2px",
                            background: isCompleted
                              ? "var(--p-color-bg-success)"
                              : "var(--p-color-bg-surface-secondary)",
                            zIndex: 0,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </InlineStack>
            </Box>
          </div>
        </BlockStack>
        <Divider />
        {renderStepContent()}
        <Divider />
        <InlineStack align="space-between" wrap>
          <Button onClick={onCancel} disabled={isSubmitting}>
            {t("pixelWizard.button.cancel")}
          </Button>
          <InlineStack gap="200" wrap>
            {currentStepIndex > 0 && (
              <Button
                onClick={() => {
                  const prevStep = steps[currentStepIndex - 1].id;
                  setCurrentStep(prevStep);
                }}
                disabled={isSubmitting}
              >
                {t("pixelWizard.button.previous")}
              </Button>
            )}
            {currentStep !== "select" &&
             currentStep !== "review" &&
             currentStep !== "testing" && (
              <Button
                variant="plain"
                onClick={handleSkip}
                disabled={isSubmitting}
              >
                {t("pixelWizard.button.skip")}
              </Button>
            )}
            {currentStep === "review" ? (
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSubmitting}
                icon={CheckCircleIcon}
              >
                {t("pixelWizard.button.save")}
              </Button>
            ) : currentStep !== "testing" ? (
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={isSubmitting}
                icon={ArrowRightIcon}
              >
                {t("pixelWizard.button.next")}
              </Button>
            ) : null}
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
