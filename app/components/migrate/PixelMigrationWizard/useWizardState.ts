import { useState, useCallback, useRef, useEffect } from "react";
import type { PlatformType } from "~/types/enums";
import type { WizardStep } from "./steps";

export interface PlatformConfig {
  platform: PlatformType;
  enabled: boolean;
  platformId: string;
  credentials: {
    measurementId?: string;
    apiSecret?: string;
    pixelId?: string;
    accessToken?: string;
    testEventCode?: string;
  };
  eventMappings: Record<string, string>;
  environment: "test" | "live";
  configVersion?: number;
}

export interface UseWizardStateOptions {
  initialStep?: WizardStep;
  initialPlatforms?: PlatformType[];
  shopId?: string;
  wizardDraft?: {
    step: WizardStep;
    selectedPlatforms: PlatformType[];
    configs: Partial<Record<PlatformType, Partial<PlatformConfig>>>;
  };
  prefillAsset?: {
    platform: PlatformType;
    details?: Record<string, unknown>;
  };
  defaultConfigs: Partial<Record<PlatformType, PlatformConfig>>;
}

export interface UseWizardStateReturn {
  currentStep: WizardStep;
  setCurrentStep: (step: WizardStep) => void;
  selectedPlatforms: Set<PlatformType>;
  setSelectedPlatforms: React.Dispatch<React.SetStateAction<Set<PlatformType>>>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  setPlatformConfigs: React.Dispatch<React.SetStateAction<Partial<Record<PlatformType, PlatformConfig>>>>;
  selectedTemplate: string | null;
  setSelectedTemplate: (template: string | null) => void;
  showTemplateModal: boolean;
  setShowTemplateModal: (show: boolean) => void;
  handlePlatformToggle: (platform: PlatformType, enabled: boolean) => void;
  handleCredentialUpdate: (platform: PlatformType, field: string, value: string) => void;
  handleEventMappingUpdate: (platform: PlatformType, shopifyEvent: string, platformEvent: string) => void;
  handleEnvironmentToggle: (platform: PlatformType, environment: "test" | "live") => void;
  saveDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;
}

export function useWizardState({
  initialStep = "select",
  initialPlatforms = [],
  shopId,
  wizardDraft,
  prefillAsset: _prefillAsset,
  defaultConfigs,
}: UseWizardStateOptions): UseWizardStateReturn {
  const [currentStep, setCurrentStep] = useState<WizardStep>(wizardDraft?.step || initialStep);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PlatformType>>(
    wizardDraft ? new Set(wizardDraft.selectedPlatforms) : new Set(initialPlatforms)
  );
  const [platformConfigs, setPlatformConfigs] = useState<Partial<Record<PlatformType, PlatformConfig>>>(
    wizardDraft?.configs as Partial<Record<PlatformType, PlatformConfig>> || defaultConfigs
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const timeoutRefs = useRef<Array<NodeJS.Timeout>>([]);

  const handlePlatformToggle = useCallback((platform: PlatformType, enabled: boolean) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(platform);
      } else {
        next.delete(platform);
      }
      return next;
    });
    setPlatformConfigs((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        enabled,
      } as PlatformConfig,
    }));
  }, []);

  const handleCredentialUpdate = useCallback((platform: PlatformType, field: string, value: string) => {
    setPlatformConfigs((prev) => {
      const currentConfig = prev[platform];
      if (!currentConfig) return prev;
      return {
        ...prev,
        [platform]: {
          ...currentConfig,
          credentials: {
            ...currentConfig.credentials,
            [field]: value,
          },
          platformId:
            field === "measurementId" || field === "pixelId"
              ? value
              : currentConfig.platformId,
        },
      };
    });
  }, []);

  const handleEventMappingUpdate = useCallback((platform: PlatformType, shopifyEvent: string, platformEvent: string) => {
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
  }, []);

  const handleEnvironmentToggle = useCallback((platform: PlatformType, environment: "test" | "live") => {
    setPlatformConfigs((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        environment,
      } as PlatformConfig,
    }));
  }, []);

  const saveDraft = useCallback(async () => {
    const fullDraft = {
      step: currentStep,
      selectedPlatforms: Array.from(selectedPlatforms),
      platformConfigs: Object.fromEntries(
        Array.from(selectedPlatforms)
          .filter((platform) => platformConfigs[platform] !== undefined)
          .map((platform) => [
            platform,
            {
              platformId: platformConfigs[platform]!.platformId,
              credentials: platformConfigs[platform]!.credentials,
              eventMappings: platformConfigs[platform]!.eventMappings,
              environment: platformConfigs[platform]!.environment,
            },
          ])
      ),
      selectedTemplate,
    };
    const draftForLocal = {
      step: currentStep,
      selectedPlatforms: Array.from(selectedPlatforms),
      selectedTemplate,
      timestamp: Date.now(),
    };
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftForLocal));
    } catch (error) {
      import("../../../utils/debug-log.client").then(({ debugWarn }) => {
        debugWarn("[PixelMigrationWizard] Failed to save draft to localStorage:", error);
      });
    }
    if (shopId) {
      try {
        const formData = new FormData();
        formData.append("_action", "saveWizardDraft");
        formData.append("draft", JSON.stringify(fullDraft));
        const response = await fetch("/app/migrate", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const { debugWarn } = await import("../../../utils/debug-log.client");
          debugWarn("[PixelMigrationWizard] Failed to save draft to database");
        }
      } catch (error) {
        const { debugWarn } = await import("../../../utils/debug-log.client");
        debugWarn("[PixelMigrationWizard] Failed to save draft to database:", error);
      }
    }
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, shopId]);

  const clearDraft = useCallback(async () => {
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
      import("../../../utils/debug-log.client").then(({ debugWarn }) => {
        debugWarn("[PixelMigrationWizard] Failed to clear draft from localStorage:", error);
      });
    }
    if (shopId) {
      try {
        const formData = new FormData();
        formData.append("_action", "clearWizardDraft");
        await fetch("/app/migrate", {
          method: "POST",
          body: formData,
        });
      } catch (error) {
        import("../../../utils/debug-log.client").then(({ debugWarn }) => {
          debugWarn("[PixelMigrationWizard] Failed to clear draft from database:", error);
        });
      }
    }
  }, [shopId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveDraft();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, saveDraft]);

  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current = [];
    };
  }, []);

  return {
    currentStep,
    setCurrentStep,
    selectedPlatforms,
    setSelectedPlatforms,
    platformConfigs,
    setPlatformConfigs,
    selectedTemplate,
    setSelectedTemplate,
    showTemplateModal,
    setShowTemplateModal,
    handlePlatformToggle,
    handleCredentialUpdate,
    handleEventMappingUpdate,
    handleEnvironmentToggle,
    saveDraft,
    clearDraft,
  };
}
