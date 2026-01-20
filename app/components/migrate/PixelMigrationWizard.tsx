import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  TextField,
  Select,
  Checkbox,
  ProgressBar,
  Icon,
  Modal,
  List,
  Link,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  SettingsIcon,
} from "~/components/icons";
import { CheckoutCompletedBehaviorHint } from "~/components/verification/CheckoutCompletedBehaviorHint";
import { useSubmit, useNavigation } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import { EventMappingEditor } from "./EventMappingEditor";
import { ConfigVersionManager } from "./ConfigVersionManager";
import type { PlatformType } from "~/types/enums";
import { isV1SupportedPlatform } from "~/utils/v1-platforms";

interface PlatformConfig {
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

interface PixelTemplate {
  id: string;
  name: string;
  description: string;
  platforms: PlatformType[];
  eventMappings: Record<string, Record<string, string>>;
}

const PRESET_TEMPLATES: PixelTemplate[] = [
  {
    id: "standard",
    name: "标准配置（v1）",
    description: "适用于大多数电商店铺的标准事件映射（GA4/Meta/TikTok）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
      },
      meta: {
        checkout_completed: "Purchase",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
      },
    },
  },
  {
    id: "advanced",
    name: "高级配置（v1.1+）",
    description: "包含更多事件类型的完整映射（v1.1+ 将支持 Pinterest/Snapchat）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        checkout_started: "begin_checkout",
        product_added_to_cart: "add_to_cart",
      },
      meta: {
        checkout_completed: "Purchase",
        checkout_started: "InitiateCheckout",
        product_added_to_cart: "AddToCart",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
        checkout_started: "InitiateCheckout",
        product_added_to_cart: "AddToCart",
      },
    },
  },
];

const DEFAULT_EVENT_MAPPINGS: Partial<Record<PlatformType, Record<string, string>>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    product_added_to_cart: "add_to_cart",
    product_viewed: "view_item",
    page_viewed: "page_view",
    search: "search",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
    search: "Search",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
    page_viewed: "PageView",
    search: "Search",
  },
};

const PLATFORM_INFO: Partial<Record<PlatformType, {
  name: string;
  icon: string;
  description: string;
  credentialFields: Array<{
    key: string;
    label: string;
    placeholder: string;
    type: "text" | "password";
    helpText?: string;
  }>;
}>> = {
  google: {
    name: "Google Analytics 4",
    icon: "🔵",
    description: "使用 Measurement Protocol 发送转化数据",
    credentialFields: [
      {
        key: "measurementId",
        label: "Measurement ID",
        placeholder: "G-XXXXXXXXXX",
        type: "text",
        helpText: "在 GA4 管理后台的「数据流」中查找",
      },
      {
        key: "apiSecret",
        label: "API Secret",
        placeholder: "输入 API Secret",
        type: "password",
        helpText: "在 GA4 管理后台的「数据流」→「Measurement Protocol API secrets」中创建",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    description: "使用 Conversions API 发送转化数据",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "123456789012345",
        type: "text",
        helpText: "在 Meta Events Manager 中查找",
      },
      {
        key: "accessToken",
        label: "Access Token",
        placeholder: "输入 Access Token",
        type: "password",
        helpText: "在 Meta Events Manager → Settings → Conversions API 中生成",
      },
      {
        key: "testEventCode",
        label: "Test Event Code (可选)",
        placeholder: "TEST12345",
        type: "text",
        helpText: "用于测试模式，可在 Events Manager 中获取",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    description: "使用 Events API 发送转化数据",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "C1234567890ABCDEF",
        type: "text",
        helpText: "在 TikTok Events Manager 中查找",
      },
      {
        key: "accessToken",
        label: "Access Token",
        placeholder: "输入 Access Token",
        type: "password",
        helpText: "在 TikTok Events Manager → Settings → Web Events 中生成",
      },
    ],
  },
};

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

type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

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
  const timeoutRefs = useRef<Array<NodeJS.Timeout>>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>(draftData?.step || "select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PlatformType>>(
    draftData?.platforms || assetData?.platforms || new Set(initialPlatforms)
  );
  const [platformConfigs, setPlatformConfigs] = useState<
    Partial<Record<PlatformType, PlatformConfig>>
  >(() => {
    const initial = draftData?.configs || assetData?.configs;
    if (initial) return initial as Partial<Record<PlatformType, PlatformConfig>>;
    return {
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
  });
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
const allTemplates: WizardTemplate[] = [
    ...(templates?.presets || PRESET_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      platforms: t.platforms,
      eventMappings: t.eventMappings,
      isPublic: true,
      usageCount: 0,
    }))),
    ...(templates?.custom || []),
  ];
  const isSubmitting = navigation.state === "submitting";
  const saveDraft = useCallback(async () => {
    const draft = {
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
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        ...draft,
        timestamp: Date.now(),
      }));
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[PixelMigrationWizard] Failed to save draft to localStorage:", error);
      }
    }
    if (shopId) {
      try {
        const formData = new FormData();
        formData.append("_action", "saveWizardDraft");
        formData.append("draft", JSON.stringify(draft));
        const response = await fetch("/app/migrate", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[PixelMigrationWizard] Failed to save draft to database");
          }
        }
      } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[PixelMigrationWizard] Failed to save draft to database:", error);
          }
      }
    }
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, shopId]);
  const clearDraft = useCallback(async () => {
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[PixelMigrationWizard] Failed to clear draft from localStorage:", error);
        }
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
          if (process.env.NODE_ENV === "development") {
            console.warn("[PixelMigrationWizard] Failed to clear draft from database:", error);
          }
      }
    }
  }, [shopId]);
  const steps = useMemo<
    Array<{
      id: WizardStep;
      label: string;
      number: number;
      description: string;
      estimatedTime: string;
    }>
  >(
    () => [
      {
        id: "select",
        label: "选择平台",
        number: 1,
        description: "选择需要迁移的广告平台",
        estimatedTime: "1 分钟",
      },
      {
        id: "credentials",
        label: "填写凭证",
        number: 2,
        description: "输入各平台的 API 凭证",
        estimatedTime: "3-5 分钟",
      },
      {
        id: "mappings",
        label: "事件映射",
        number: 3,
        description: "标准事件映射 + 参数完整率检查（Shopify 事件 → 平台事件）",
        estimatedTime: "2-3 分钟",
      },
      {
        id: "review",
        label: "检查配置",
        number: 4,
        description: "检查并确认所有配置信息",
        estimatedTime: "1-2 分钟",
      },
      {
        id: "testing",
        label: "测试验证",
        number: 5,
        description: "在测试环境中验证配置 + 可下载 payload 证据",
        estimatedTime: "2-3 分钟",
      },
    ],
    []
  );
  useEffect(() => {
    if (wizardDraft && wizardDraft.step !== "select") {
      try {
        const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
        const draft = {
          step: wizardDraft.step,
          selectedPlatforms: wizardDraft.selectedPlatforms || [],
          configs: wizardDraft.configs || {},
          selectedTemplate: null,
          timestamp: Date.now(),
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[PixelMigrationWizard] Failed to sync draft to localStorage:", error);
          }
      }
      showSuccess(`检测到未完成的配置（停留在第 ${steps.findIndex(s => s.id === wizardDraft.step) + 1} 步），已自动恢复。您可以继续完成配置。`);
    } else if (initialPlatforms.length > 0 && !wizardDraft) {
      const configs = { ...platformConfigs };
      initialPlatforms.forEach((platform) => {
        const existingConfig = configs[platform];
        if (existingConfig) {
          configs[platform] = {
            ...existingConfig,
            enabled: true,
            platform: existingConfig.platform || platform,
          };
        }
      });
      setPlatformConfigs(configs);
    }
  }, [wizardDraft, shopId, showSuccess, steps, initialPlatforms, platformConfigs, setPlatformConfigs]);
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveDraft();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, saveDraft]);
  useEffect(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    intervalRef.current = setInterval(() => {
      if (currentStep !== "select" || selectedPlatforms.size > 0) {
        saveDraft();
      }
    }, 30000);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentStep, selectedPlatforms, saveDraft]);
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current = [];
    };
  }, []);
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentStep !== "select" || selectedPlatforms.size > 0) {
        try {
          const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
          const draft = {
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
            timestamp: Date.now(),
          };
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        } catch (error) {
            if (process.env.NODE_ENV === "development") {
              console.warn("[PixelMigrationWizard] Failed to save draft before unload:", error);
            }
        }
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, shopId]);
  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;
  const handlePlatformToggle = useCallback(
    (platform: PlatformType, enabled: boolean) => {
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
        },
      }));
    },
    []
  );
  const handleApplyTemplate = useCallback(
    (template: WizardTemplate) => {
      const configs = { ...platformConfigs };
      const platforms = new Set<PlatformType>();
      const v1SupportedPlatforms = ["google", "meta", "tiktok"] as const;
      template.platforms.forEach((platform) => {
        const platformKey = platform as PlatformType;
        if (v1SupportedPlatforms.includes(platformKey as typeof v1SupportedPlatforms[number])) {
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
        }
      });
      setSelectedPlatforms(platforms);
      setPlatformConfigs(configs);
      setSelectedTemplate(template.id);
      setShowTemplateModal(false);
      showSuccess(`已应用模板「${template.name}」`);
    },
    [platformConfigs, showSuccess]
  );
  const handleCredentialUpdate = useCallback(
    (platform: PlatformType, field: string, value: string) => {
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
    },
    []
  );
  const handleEventMappingUpdate = useCallback(
    (platform: PlatformType, shopifyEvent: string, platformEvent: string) => {
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
  const handleEnvironmentToggle = useCallback(
    (platform: PlatformType, environment: "test" | "live") => {
      setPlatformConfigs((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          environment,
        },
      }));
    },
    []
  );
  const validateConfig = useCallback((platform: PlatformType): string[] => {
    const config = platformConfigs[platform];
    const errors: string[] = [];
    const info = PLATFORM_INFO[platform];
    if (!config || !info) return errors;
    if (!config.enabled) return errors;
    info.credentialFields.forEach((field) => {
      if (field.key === "testEventCode") return;
      if (!config.credentials[field.key as keyof typeof config.credentials]) {
        errors.push(`${info.name}: 缺少 ${field.label}`);
      }
    });
    return errors;
  }, [platformConfigs]);
  const canProceedToNextStep = useCallback((): { canProceed: boolean; errors: string[] } => {
    const errors: string[] = [];
    switch (currentStep) {
      case "select":
        if (selectedPlatforms.size === 0) {
          errors.push("请至少选择一个平台");
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
              errors.push(`${info.name}: 缺少 ${field.label}`);
            }
          });
        });
        break;
      case "mappings":
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          if (!config) {
            errors.push(`${PLATFORM_INFO[platform]?.name || platform}: 配置不存在`);
            return;
          }
          if (!config.eventMappings || Object.keys(config.eventMappings).length === 0) {
            errors.push(`${PLATFORM_INFO[platform]?.name || platform}: 至少需要配置一个事件映射`);
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
  }, [currentStep, selectedPlatforms, platformConfigs, validateConfig]);
  const handleSkip = useCallback(() => {
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStep(steps[nextStepIndex].id);
    }
  }, [currentStepIndex, steps]);
  const handleSave = useCallback(async () => {
    const enabledPlatforms = Array.from(selectedPlatforms);
    const allErrors: string[] = [];
    enabledPlatforms.forEach((platform) => {
      const errors = validateConfig(platform);
      allErrors.push(...errors);
    });
    if (allErrors.length > 0) {
      showError(`配置错误：${allErrors.join("; ")}`);
      return;
    }
    const configs = enabledPlatforms.map((platform) => {
      const config = platformConfigs[platform];
      if (!config) {
        throw new Error(`配置不存在: ${platform}`);
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
    showSuccess("配置已保存，正在验证...");
    setCurrentStep("testing");
  }, [selectedPlatforms, platformConfigs, validateConfig, submit, showSuccess, showError, clearDraft]);
  const handleNext = useCallback(() => {
    const validation = canProceedToNextStep();
    if (!validation.canProceed) {
      showError(`请先完成当前步骤：${validation.errors.join("; ")}`);
      return;
    }
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStep(steps[nextStepIndex].id);
    }
  }, [currentStepIndex, steps, canProceedToNextStep, showError]);
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
              像素迁移向导
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">
                {`步骤 ${currentStepIndex + 1} / ${steps.length}`}
              </Badge>
              <Badge>
                {`${String(Math.round(progress))}% 完成`}
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
            取消
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
                上一步
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
                跳过此步
              </Button>
            )}
            {currentStep === "review" ? (
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSubmitting}
                icon={CheckCircleIcon}
              >
                保存配置
              </Button>
            ) : currentStep !== "testing" ? (
              <Button
                variant="primary"
                onClick={handleNext}
                disabled={isSubmitting}
                icon={ArrowRightIcon}
              >
                下一步
              </Button>
            ) : null}
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
function SelectPlatformStep({
  selectedPlatforms,
  platformConfigs: _platformConfigs,
  onPlatformToggle,
  onApplyTemplate,
  showTemplateModal,
  onShowTemplateModal,
  templates,
}: {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onPlatformToggle: (platform: PlatformType, enabled: boolean) => void;
  onApplyTemplate: (template: WizardTemplate) => void;
  showTemplateModal: boolean;
  onShowTemplateModal: (show: boolean) => void;
  templates: WizardTemplate[];
}) {
  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        选择要配置的平台
      </Text>
      <Text as="p" tone="subdued">
        选择您要迁移的广告平台。您可以稍后在设置页面添加更多平台。
      </Text>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm">
            提示：您可以使用预设模板快速配置多个平台，或手动选择平台。
          </Text>
          <Button
            size="slim"
            onClick={() => onShowTemplateModal(true)}
            icon={SettingsIcon}
          >
            查看预设模板
          </Button>
        </BlockStack>
      </Banner>
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            v1 像素迁移核心能力：
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>标准事件映射</strong>：Shopify 事件 → 平台事件（GA4/Meta/TikTok）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>参数完整率检查</strong>：自动验证事件参数是否完整
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>可下载 payload 证据</strong>：用于验证和存档（Test/Live 环境）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>v1 支持平台</strong>：GA4、Meta、TikTok（三选一，Migration $49/月）
          </Text>
          <Text as="p" variant="bodySm">
            • <strong>v1.1+ 规划</strong>：Pinterest、Snapchat 等其他平台将在后续版本支持
          </Text>
          <Divider />
          <Text as="p" variant="bodySm" fontWeight="semibold">
            ⚠️ 技术限制说明：
          </Text>
          <Text as="p" variant="bodySm">
            Web Pixel 运行在 strict sandbox（Web Worker）环境中，很多能力受限（如 DOM 访问、第三方 cookie、localStorage 等）。部分原有脚本功能可能无法完全迁移。
          </Text>
        </BlockStack>
      </Banner>
      <BlockStack gap="300">
        {(Object.keys(PLATFORM_INFO) as PlatformType[]).filter((platform) => {
          return isV1SupportedPlatform(platform);
        }).map((platform) => {
          const info = PLATFORM_INFO[platform];
          if (!info) return null;
          const isSelected = selectedPlatforms.has(platform);
          const isV1Supported = isV1SupportedPlatform(platform);
          const isDisabled = !isV1Supported;
          return (
            <Card key={platform}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="headingLg">
                      {info.icon}
                    </Text>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {info.name}
                        </Text>
                        {isV1Supported && (
                          <Badge tone="success" size="small">v1 支持</Badge>
                        )}
                        {!isV1Supported && (
                          <Badge tone="info" size="small">v1.1+</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {info.description}
                        {!isV1Supported && "（v1.1+ 版本将支持）"}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Checkbox
                    checked={isSelected}
                    onChange={(checked) => {
                      if (!isDisabled) {
                        onPlatformToggle(platform, checked);
                      }
                    }}
                    disabled={isDisabled}
                    label=""
                  />
                </InlineStack>
                {isDisabled && (
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      该平台将在 v1.1+ 版本支持。v1 专注于 GA4、Meta、TikTok 的最小可用迁移。
                    </Text>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
      <Modal
        open={showTemplateModal}
        onClose={() => onShowTemplateModal(false)}
        title="选择预设模板"
        primaryAction={{
          content: "关闭",
          onAction: () => onShowTemplateModal(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              选择一个预设模板快速配置多个平台的事件映射。
            </Text>
            {templates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {template.name}
                        </Text>
                        {template.isPublic && (
                          <Badge tone="info">公开</Badge>
                        )}
                        {template.usageCount > 0 && (
                          <Badge>{`使用 ${String(template.usageCount)} 次`}</Badge>
                        )}
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {template.description}
                      </Text>
                    </BlockStack>
                    <Button
                      size="slim"
                      onClick={() => onApplyTemplate(template)}
                    >
                      应用
                    </Button>
                  </InlineStack>
                  <InlineStack gap="100">
                    {template.platforms.map((p) => {
                      const platformKey = p as PlatformType;
                      return (
                        <Badge key={p}>
                          {PLATFORM_INFO[platformKey]?.name || p}
                        </Badge>
                      );
                    })}
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
function CredentialsStep({
  selectedPlatforms,
  platformConfigs,
  onCredentialUpdate,
  onEnvironmentToggle,
}: {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onCredentialUpdate: (platform: PlatformType, field: string, value: string) => void;
  onEnvironmentToggle: (platform: PlatformType, environment: "test" | "live") => void;
}) {
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        填写平台凭证
      </Text>
      <Text as="p" tone="subdued">
        为每个选中的平台填写 API 凭证。这些凭证将加密存储，仅用于发送转化数据。
      </Text>
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        const info = PLATFORM_INFO[platform];
        if (!config || !info) return null;
        return (
          <Card key={platform}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="headingLg">
                    {info.icon}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {info.name}
                  </Text>
                </InlineStack>
                <BlockStack gap="200" align="end">
                  <Box
                    padding="200"
                    background={config.environment === "live" ? "bg-fill-critical" : "bg-fill-warning"}
                    borderRadius="200"
                  >
                    <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                      {config.environment === "live" ? "🔴 生产模式" : "🟡 测试模式"}
                    </Badge>
                  </Box>
                  <Select
                    label="切换环境"
                    options={[
                      { label: "🟡 测试环境 (Test) - 用于验证配置", value: "test" },
                      { label: "🔴 生产环境 (Live) - 正式发送事件", value: "live" },
                    ]}
                    value={config.environment}
                    onChange={(value) =>
                      onEnvironmentToggle(platform, value as "test" | "live")
                    }
                    helpText={
                      config.environment === "test"
                        ? "测试模式：事件发送到测试端点，不会影响实际广告数据"
                        : "生产模式：事件发送到正式端点，将影响广告归因和优化"
                    }
                  />
                </BlockStack>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                {info.credentialFields.map((field) => (
                  <BlockStack key={field.key} gap="100">
                    <TextField
                    key={field.key}
                    label={field.label}
                    type={field.type}
                    value={
                      config.credentials[
                        field.key as keyof typeof config.credentials
                      ] || ""
                    }
                    onChange={(value) =>
                      onCredentialUpdate(platform, field.key, value)
                    }
                    placeholder={field.placeholder}
                    helpText={field.helpText}
                    autoComplete="off"
                  />
                </BlockStack>
                ))}
              </BlockStack>
              {config.environment === "test" && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    测试模式下，事件将发送到平台的测试端点，不会影响实际广告数据。
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        );
      })}
    </BlockStack>
  );
}
function EventMappingsStep({
  selectedPlatforms,
  platformConfigs,
  onEventMappingUpdate,
}: {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onEventMappingUpdate: (
    platform: PlatformType,
    shopifyEvent: string,
    platformEvent: string
  ) => void;
}) {
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        配置事件映射
      </Text>
      <Text as="p" tone="subdued">
        将 Shopify 事件映射到各平台的事件名称。我们已为您配置了推荐映射。
      </Text>
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        if (!config) return null;
        return (
          <EventMappingEditor
            key={platform}
            platform={platform as "google" | "meta" | "tiktok"}
            mappings={config.eventMappings}
            onMappingChange={(shopifyEvent, platformEvent) =>
              onEventMappingUpdate(platform, shopifyEvent, platformEvent)
            }
          />
        );
      })}
    </BlockStack>
  );
}
function ReviewStep({
  selectedPlatforms,
  platformConfigs,
  onValidate,
  shopId,
  onEnvironmentToggle: _onEnvironmentToggle,
  pixelConfigs,
}: {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onValidate: (platform: PlatformType) => string[];
  shopId?: string;
  onEnvironmentToggle?: (platform: PlatformType, environment: "test" | "live") => void;
  pixelConfigs?: Array<{
    platform: string;
    environment: string;
    configVersion: number;
    previousConfig: unknown;
    rollbackAllowed: boolean;
  }>;
}) {
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const { showSuccess, showError } = useToastContext();
  const submit = useSubmit();
  const allErrors: string[] = [];
  Array.from(selectedPlatforms).forEach((platform) => {
    const errors = onValidate(platform);
    allErrors.push(...errors);
  });
  const handleSaveAsTemplate = useCallback(async () => {
    if (!shopId || !templateName.trim()) {
      showError("请输入模板名称");
      return;
    }
    setIsSavingTemplate(true);
    try {
      const platforms = Array.from(selectedPlatforms);
      const eventMappings: Record<string, Record<string, string>> = {};
      platforms.forEach((platform) => {
        const config = platformConfigs[platform];
        if (config) {
          eventMappings[platform] = config.eventMappings || {};
        }
      });
      const formData = new FormData();
      formData.append("_action", "saveWizardConfigAsTemplate");
      formData.append("name", templateName.trim());
      formData.append("description", templateDescription.trim());
      formData.append("platforms", JSON.stringify(platforms));
      formData.append("eventMappings", JSON.stringify(eventMappings));
      formData.append("isPublic", isPublic ? "true" : "false");
      submit(formData, { method: "post" });
      setShowSaveTemplateModal(false);
      setTemplateName("");
      setTemplateDescription("");
      setIsPublic(false);
      showSuccess("模板已保存！");
    } catch (error) {
      showError("保存模板失败");
      if (process.env.NODE_ENV === "development") {
        console.error("[PixelMigrationWizard] Save template error:", error);
      }
    } finally {
      setIsSavingTemplate(false);
    }
  }, [shopId, templateName, templateDescription, isPublic, selectedPlatforms, platformConfigs, submit, showSuccess, showError]);
  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        检查配置
      </Text>
      <Text as="p" tone="subdued">
        请检查以下配置是否正确。确认无误后点击「保存配置」。您也可以将当前配置保存为模板，方便后续使用。
      </Text>
      {allErrors.length > 0 && (
        <Banner tone="critical" title="配置错误">
          <List type="bullet">
            {allErrors.map((error, index) => (
              <List.Item key={index}>{error}</List.Item>
            ))}
          </List>
        </Banner>
      )}
      {Array.from(selectedPlatforms).map((platform) => {
        const config = platformConfigs[platform];
        const info = PLATFORM_INFO[platform];
        if (!config || !info) return null;
        const errors = onValidate(platform);
        return (
          <Card key={platform}>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="headingLg">
                    {info.icon}
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {info.name}
                  </Text>
                </InlineStack>
                {errors.length === 0 ? (
                  <Badge tone="success">配置完整</Badge>
                ) : (
                  <Badge tone="critical">配置不完整</Badge>
                )}
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    环境
                  </Text>
                  <Badge tone={config.environment === "live" ? "success" : "info"}>
                    {config.environment === "live" ? "生产模式" : "测试模式"}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    平台 ID
                  </Text>
                  <Text as="span" fontWeight="semibold">
                    {config.platformId || "未填写"}
                  </Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    事件映射
                  </Text>
                  <Text as="span" variant="bodySm">
                    {Object.keys(config.eventMappings).length} 个事件
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        );
      })}
      {shopId && Array.from(selectedPlatforms).map((platform) => {
        const existingConfig = platformConfigs[platform];
        let currentVersion = existingConfig?.configVersion;
        if (currentVersion === undefined && pixelConfigs) {
          const pixelConfig = pixelConfigs.find(
            (config: { platform: string; configVersion: number }) => config.platform === platform
          );
          currentVersion = pixelConfig?.configVersion;
        }
        currentVersion = currentVersion ?? 1;
        return (
          <ConfigVersionManager
            key={platform}
            shopId={shopId}
            platform={platform}
            currentVersion={currentVersion}
            onRollbackComplete={() => {
            }}
          />
        );
      })}
      {shopId && (
        <Card>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              保存为模板
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              将当前配置保存为模板，方便后续快速应用到其他店铺或分享给团队成员。
            </Text>
            <Button
              size="slim"
              onClick={() => setShowSaveTemplateModal(true)}
            >
              保存为模板
            </Button>
          </BlockStack>
        </Card>
      )}
      <Modal
        open={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        title="保存为模板"
        primaryAction={{
          content: "保存",
          onAction: handleSaveAsTemplate,
          loading: isSavingTemplate,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowSaveTemplateModal(false),
            disabled: isSavingTemplate,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="模板名称"
              value={templateName}
              onChange={setTemplateName}
              placeholder="例如：标准电商配置"
              helpText="为模板起一个易于识别的名称"
              autoComplete="off"
            />
            <TextField
              label="模板描述"
              value={templateDescription}
              onChange={setTemplateDescription}
              placeholder="描述这个模板的用途和适用场景"
              multiline={3}
              autoComplete="off"
            />
            <Checkbox
              label="公开模板"
              checked={isPublic}
              onChange={setIsPublic}
              helpText="公开模板可以被其他用户查看和使用，适合分享最佳实践"
            />
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                模板将保存以下配置：
              </Text>
              <List type="bullet">
                <List.Item>平台：{Array.from(selectedPlatforms).map(p => PLATFORM_INFO[p]?.name || p).join(", ")}</List.Item>
                <List.Item>事件映射：{Array.from(selectedPlatforms).reduce((acc, p) => {
                  const config = platformConfigs[p];
                  return acc + (config?.eventMappings ? Object.keys(config.eventMappings).length : 0);
                }, 0)} 个事件</List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                注意：模板不会保存凭证信息，仅保存事件映射配置。
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
function TestingStep({
  selectedPlatforms,
  platformConfigs,
  onComplete,
  shopId,
  onEnvironmentToggle,
}: {
  selectedPlatforms: Set<PlatformType>;
  platformConfigs: Partial<Record<PlatformType, PlatformConfig>>;
  onComplete: () => void;
  shopId?: string;
  onEnvironmentToggle?: (platform: PlatformType, environment: "test" | "live") => void;
}) {
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
          if (process.env.NODE_ENV === "development") {
            console.error(`[PixelMigrationWizard] Failed to parse JSON for ${platform}:`, error);
          }
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
      if (process.env.NODE_ENV === "development") {
        console.error("[PixelMigrationWizard] Test environment validation error:", error);
      }
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
            if (process.env.NODE_ENV === "development") {
              console.error(`[PixelMigrationWizard] Failed to parse JSON when switching ${platform} to live:`, error);
            }
            return { success: false, error: "解析响应失败" };
          });
          if (data.success) {
            onEnvironmentToggle(platform, "live");
          }
          return { platform, success: data.success, error: data.error };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          if (process.env.NODE_ENV === "development") {
            console.error(`[PixelMigrationWizard] Failed to switch platform ${platform}:`, error);
          }
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
      if (process.env.NODE_ENV === "development") {
        console.error("[PixelMigrationWizard] Switch to live error:", error);
      }
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
        <Button url="/app/monitor">
          前往监控页面
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
