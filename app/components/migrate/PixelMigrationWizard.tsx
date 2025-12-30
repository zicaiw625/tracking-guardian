

import { useState, useCallback, useEffect } from "react";
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
  DataTable,
  Tooltip,
  Link,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  SettingsIcon,
} from "~/components/icons";
import { useSubmit, useNavigation } from "@remix-run/react";
import { useToastContext } from "~/components/ui";
import { EventMappingEditor } from "./EventMappingEditor";

type Platform = "google" | "meta" | "tiktok" | "pinterest";

interface PlatformConfig {
  platform: Platform;
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
}

interface EventMapping {
  shopifyEvent: string;
  platformEvent: string;
  enabled: boolean;
}

interface PixelTemplate {
  id: string;
  name: string;
  description: string;
  platforms: Platform[];
  eventMappings: Record<string, Record<string, string>>;
}

const PRESET_TEMPLATES: PixelTemplate[] = [
  {
    id: "standard",
    name: "标准配置",
    description: "适用于大多数电商店铺的标准事件映射",
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
    name: "高级配置",
    description: "包含更多事件类型的完整映射",
    platforms: ["google", "meta", "tiktok", "pinterest"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        checkout_started: "begin_checkout",
        add_to_cart: "add_to_cart",
      },
      meta: {
        checkout_completed: "Purchase",
        checkout_started: "InitiateCheckout",
        add_to_cart: "AddToCart",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
        checkout_started: "InitiateCheckout",
        add_to_cart: "AddToCart",
      },
      pinterest: {
        checkout_completed: "checkout",
      },
    },
  },
];

const DEFAULT_EVENT_MAPPINGS: Record<Platform, Record<string, string>> = {
  google: {
    checkout_completed: "purchase",
  },
  meta: {
    checkout_completed: "Purchase",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
  },
  pinterest: {
    checkout_completed: "checkout",
  },
};

const PLATFORM_INFO: Record<
  Platform,
  {
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
  }
> = {
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
  pinterest: {
    name: "Pinterest Tag",
    icon: "📌",
    description: "使用 Conversions API 发送转化数据",
    credentialFields: [
      {
        key: "pixelId",
        label: "Tag ID",
        placeholder: "1234567890123",
        type: "text",
        helpText: "在 Pinterest Ads Manager 中查找",
      },
      {
        key: "accessToken",
        label: "Access Token",
        placeholder: "输入 Access Token",
        type: "password",
        helpText: "在 Pinterest Ads Manager → Settings → Conversions 中生成",
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

export interface PixelMigrationWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  initialPlatforms?: Platform[];
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
}

type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

export function PixelMigrationWizard({
  onComplete,
  onCancel,
  initialPlatforms = [],
  canManageMultiple = false,
  shopId,
  templates,
  wizardDraft,
}: PixelMigrationWizardProps) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  // 从数据库草稿或初始状态初始化
  const initializeFromDraft = useCallback(() => {
    if (wizardDraft) {
      const draftPlatforms = new Set<Platform>(wizardDraft.selectedPlatforms as Platform[]);
      const draftConfigs: Record<Platform, PlatformConfig> = {
        google: {
          platform: "google",
          enabled: draftPlatforms.has("google"),
          platformId: wizardDraft.configs.google?.platformId || "",
          credentials: wizardDraft.configs.google?.credentials || {},
          eventMappings: wizardDraft.configs.google?.eventMappings || DEFAULT_EVENT_MAPPINGS.google,
          environment: wizardDraft.configs.google?.environment || "test",
        },
        meta: {
          platform: "meta",
          enabled: draftPlatforms.has("meta"),
          platformId: wizardDraft.configs.meta?.platformId || "",
          credentials: wizardDraft.configs.meta?.credentials || {},
          eventMappings: wizardDraft.configs.meta?.eventMappings || DEFAULT_EVENT_MAPPINGS.meta,
          environment: wizardDraft.configs.meta?.environment || "test",
        },
        tiktok: {
          platform: "tiktok",
          enabled: draftPlatforms.has("tiktok"),
          platformId: wizardDraft.configs.tiktok?.platformId || "",
          credentials: wizardDraft.configs.tiktok?.credentials || {},
          eventMappings: wizardDraft.configs.tiktok?.eventMappings || DEFAULT_EVENT_MAPPINGS.tiktok,
          environment: wizardDraft.configs.tiktok?.environment || "test",
        },
        pinterest: {
          platform: "pinterest",
          enabled: draftPlatforms.has("pinterest"),
          platformId: wizardDraft.configs.pinterest?.platformId || "",
          credentials: wizardDraft.configs.pinterest?.credentials || {},
          eventMappings: wizardDraft.configs.pinterest?.eventMappings || DEFAULT_EVENT_MAPPINGS.pinterest,
          environment: wizardDraft.configs.pinterest?.environment || "test",
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
  const [currentStep, setCurrentStep] = useState<WizardStep>(draftData?.step || "select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    draftData?.platforms || new Set(initialPlatforms)
  );
  const [platformConfigs, setPlatformConfigs] = useState<
    Record<Platform, PlatformConfig>
  >(draftData?.configs || {
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
    pinterest: {
      platform: "pinterest",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.pinterest,
      environment: "test",
    },
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

  // 保存草稿到数据库（优先）和 localStorage（备用）
  const saveDraft = useCallback(async () => {
    const draft = {
      step: currentStep,
      selectedPlatforms: Array.from(selectedPlatforms),
      platformConfigs: Object.fromEntries(
        Array.from(selectedPlatforms).map((platform) => [
          platform,
          {
            platformId: platformConfigs[platform].platformId,
            credentials: platformConfigs[platform].credentials,
            eventMappings: platformConfigs[platform].eventMappings,
            environment: platformConfigs[platform].environment,
          },
        ])
      ),
      selectedTemplate,
    };

    // 保存到 localStorage（备用）
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        ...draft,
        timestamp: Date.now(),
      }));
    } catch (error) {
      console.warn("Failed to save draft to localStorage:", error);
    }

    // 保存到数据库（如果 shopId 存在）
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
          console.warn("Failed to save draft to database");
        }
      } catch (error) {
        console.warn("Failed to save draft to database:", error);
      }
    }
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, shopId]);

  // 清除草稿
  const clearDraft = useCallback(async () => {
    // 清除 localStorage
    try {
      const DRAFT_STORAGE_KEY = shopId ? `pixel-wizard-draft-${shopId}` : "pixel-wizard-draft";
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear draft from localStorage:", error);
    }

    // 清除数据库草稿
    if (shopId) {
      try {
        const formData = new FormData();
        formData.append("_action", "clearWizardDraft");
        
        await fetch("/app/migrate", {
          method: "POST",
          body: formData,
        });
      } catch (error) {
        console.warn("Failed to clear draft from database:", error);
      }
    }
  }, [shopId]);

  // 组件加载时，如果数据库有草稿，显示提示
  useEffect(() => {
    if (wizardDraft && wizardDraft.step !== "select") {
      showSuccess("检测到未完成的配置，已自动恢复。");
    } else if (initialPlatforms.length > 0 && !wizardDraft) {
      const configs = { ...platformConfigs };
      initialPlatforms.forEach((platform) => {
        configs[platform] = {
          ...configs[platform],
          enabled: true,
        };
      });
      setPlatformConfigs(configs);
    }
  }, []);

  // 步骤切换时自动保存草稿（防抖）
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveDraft();
    }, 500); // 500ms 防抖

    return () => clearTimeout(timeoutId);
  }, [currentStep, selectedPlatforms, platformConfigs, selectedTemplate, saveDraft]);

  const steps: Array<{
    id: WizardStep;
    label: string;
    number: number;
    description: string;
    estimatedTime: string;
  }> = [
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
      description: "配置 Shopify 事件到平台事件的映射",
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
      description: "在测试环境中验证配置是否正确",
      estimatedTime: "2-3 分钟",
    },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handlePlatformToggle = useCallback(
    (platform: Platform, enabled: boolean) => {
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
      const platforms = new Set<Platform>();

      template.platforms.forEach((platform) => {
        const platformKey = platform as Platform;
        platforms.add(platformKey);
        configs[platformKey] = {
          ...configs[platformKey],
          enabled: true,
          eventMappings: template.eventMappings[platform] || configs[platformKey].eventMappings,
        };
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
    (platform: Platform, field: string, value: string) => {
      setPlatformConfigs((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          credentials: {
            ...prev[platform].credentials,
            [field]: value,
          },
          platformId:
            field === "measurementId" || field === "pixelId"
              ? value
              : prev[platform].platformId,
        },
      }));
    },
    []
  );

  const handleEventMappingUpdate = useCallback(
    (platform: Platform, shopifyEvent: string, platformEvent: string) => {
      setPlatformConfigs((prev) => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          eventMappings: {
            ...prev[platform].eventMappings,
            [shopifyEvent]: platformEvent,
          },
        },
      }));
    },
    []
  );

  const handleEnvironmentToggle = useCallback(
    (platform: Platform, environment: "test" | "live") => {
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

  const validateConfig = useCallback((platform: Platform): string[] => {
    const config = platformConfigs[platform];
    const errors: string[] = [];
    const info = PLATFORM_INFO[platform];

    if (!config.enabled) return errors;

    info.credentialFields.forEach((field) => {
      if (field.key === "testEventCode") return;
      if (!config.credentials[field.key as keyof typeof config.credentials]) {
        errors.push(`${info.name}: 缺少 ${field.label}`);
      }
    });

    return errors;
  }, [platformConfigs]);

  // 验证当前步骤是否可以前进
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
          
          info.credentialFields.forEach((field) => {
            if (field.key === "testEventCode") return; // 可选字段
            if (!config.credentials[field.key as keyof typeof config.credentials]) {
              errors.push(`${info.name}: 缺少 ${field.label}`);
            }
          });
        });
        break;
      case "mappings":
        Array.from(selectedPlatforms).forEach((platform) => {
          const config = platformConfigs[platform];
          if (!config.eventMappings || Object.keys(config.eventMappings).length === 0) {
            errors.push(`${PLATFORM_INFO[platform].name}: 至少需要配置一个事件映射`);
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
        // 测试步骤不需要验证
        break;
    }

    return {
      canProceed: errors.length === 0,
      errors,
    };
  }, [currentStep, selectedPlatforms, platformConfigs, validateConfig]);

  // 跳过当前步骤
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

    // 保存成功后清除草稿
    await clearDraft();
    showSuccess("配置已保存，正在验证...");
    setCurrentStep("testing");
  }, [selectedPlatforms, platformConfigs, validateConfig, submit, showSuccess, showError, clearDraft]);

  // 处理下一步按钮点击
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
        {}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              像素迁移向导
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">
                {`步骤 ${currentStepIndex + 1} / ${steps.length}`}
              </Badge>
              <Badge tone="subdued">
                {Math.round(progress)}% 完成
              </Badge>
            </InlineStack>
          </InlineStack>
          <ProgressBar progress={progress} tone="primary" size="small" />
          {/* 移动端优化的步骤指示器 */}
          <Box
            paddingBlockStart="300"
            paddingBlockEnd="200"
            style={{
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
                    <Box
                      key={step.id}
                      minWidth="100px"
                      maxWidth="180px"
                      padding="200"
                      style={{
                        flexShrink: 0,
                        position: "relative",
                      }}
                    >
                      <BlockStack gap="200" align="center">
                      <Box
                        background={
                          isCompleted
                            ? "bg-fill-success"
                            : isCurrent
                              ? "bg-fill-info"
                              : "bg-surface-secondary"
                        }
                        padding="200"
                        borderRadius="full"
                        minWidth="36px"
                        minHeight="36px"
                        style={{
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
                        </Box>
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
                      {/* 连接线 */}
                      {index < steps.length - 1 && (
                        <Box
                          position="absolute"
                          left="calc(50% + 18px)"
                          top="18px"
                          style={{
                            width: "calc(100% - 36px)",
                            height: "2px",
                            background: isCompleted 
                              ? "var(--p-color-bg-success)" 
                              : "var(--p-color-bg-surface-secondary)",
                            zIndex: 0,
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
              </InlineStack>
            </Box>
          </Box>
        </BlockStack>

        <Divider />

        {}
        {renderStepContent()}

        <Divider />

        {}
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
            {/* 跳过按钮 - 仅在非必需步骤显示 */}
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
  platformConfigs,
  onPlatformToggle,
  onApplyTemplate,
  showTemplateModal,
  onShowTemplateModal,
  templates,
}: {
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onPlatformToggle: (platform: Platform, enabled: boolean) => void;
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

      <BlockStack gap="300">
        {(Object.keys(PLATFORM_INFO) as Platform[]).map((platform) => {
          const info = PLATFORM_INFO[platform];
          const isSelected = selectedPlatforms.has(platform);

          return (
            <Card key={platform}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="headingLg">
                      {info.icon}
                    </Text>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {info.name}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {info.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Checkbox
                    checked={isSelected}
                    onChange={(checked) => onPlatformToggle(platform, checked)}
                    label=""
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>

      {}
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
                          <Badge tone="subdued">使用 {template.usageCount} 次</Badge>
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
                      const platformKey = p as Platform;
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
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onCredentialUpdate: (platform: Platform, field: string, value: string) => void;
  onEnvironmentToggle: (platform: Platform, environment: "test" | "live") => void;
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
                <Select
                  label="环境"
                  options={[
                    { label: "测试模式", value: "test" },
                    { label: "生产模式", value: "live" },
                  ]}
                  value={config.environment}
                  onChange={(value) =>
                    onEnvironmentToggle(platform, value as "test" | "live")
                  }
                />
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
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onEventMappingUpdate: (
    platform: Platform,
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

        return (
          <EventMappingEditor
            key={platform}
            platform={platform}
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
}: {
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onValidate: (platform: Platform) => string[];
}) {
  const allErrors: string[] = [];
  Array.from(selectedPlatforms).forEach((platform) => {
    const errors = onValidate(platform);
    allErrors.push(...errors);
  });

  return (
    <BlockStack gap="500">
      <Text as="h3" variant="headingMd">
        检查配置
      </Text>
      <Text as="p" tone="subdued">
        请检查以下配置是否正确。确认无误后点击「保存配置」。
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
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onComplete: () => void;
  shopId?: string;
  onEnvironmentToggle?: (platform: Platform, environment: "test" | "live") => void;
}) {
  const [isValidating, setIsValidating] = useState(false);
  const [isSwitchingToLive, setIsSwitchingToLive] = useState(false);
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
  const submit = useSubmit();

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

        const data = await response.json();
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
          .map(([p]) => PLATFORM_INFO[p as Platform]?.name || p)
          .join(", ");
        showError(`部分平台配置验证失败: ${failedPlatforms}。请检查配置和凭证。`);
      }
    } catch (error) {
      showError("验证过程中发生错误");
      console.error("Test environment validation error", error);
    } finally {
      setIsValidating(false);
    }
  }, [shopId, selectedPlatforms, showSuccess, showError]);

  const handleSwitchToLive = useCallback(async () => {
    if (!shopId || !onEnvironmentToggle) return;

    setIsSwitchingToLive(true);
    try {

      const switchPromises = Array.from(selectedPlatforms).map(async (platform) => {
        const formData = new FormData();
        formData.append("_action", "switchEnvironment");
        formData.append("platform", platform);
        formData.append("environment", "live");

        const response = await fetch("/app/actions/pixel-config", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        if (data.success) {
          onEnvironmentToggle(platform, "live");
        }
        return { platform, success: data.success, error: data.error };
      });

      const results = await Promise.all(switchPromises);
      const allSuccess = results.every((r) => r.success);

      if (allSuccess) {
        showSuccess("所有平台已切换到生产模式！");

        setTimeout(() => {
          window.location.href = "/app/verification";
        }, 1500);
      } else {
        const failedPlatforms = results
          .filter((r) => !r.success)
          .map((r) => PLATFORM_INFO[r.platform as Platform]?.name || r.platform)
          .join(", ");
        showError(`部分平台切换失败: ${failedPlatforms}。请稍后重试。`);
      }
    } catch (error) {
      showError("切换环境时发生错误");
      console.error("Switch to live error", error);
    } finally {
      setIsSwitchingToLive(false);
    }
  }, [shopId, selectedPlatforms, onEnvironmentToggle, showSuccess, showError]);

  const handleGoToVerification = useCallback(() => {
    window.location.href = "/app/verification";
  }, []);

  // 自动跳转到验收页面的逻辑
  useEffect(() => {
    // 仅在测试步骤、验证通过、且不在切换环境过程中时自动跳转
    const allValid = Object.keys(validationResults).length > 0 && 
                     Object.values(validationResults).every(r => r.valid);
    
    if (
      currentStep === "testing" &&
      allValid &&
      !isSwitchingToLive
    ) {
      // 如果所有平台都在测试模式，不自动跳转（需要手动切换到生产模式）
      if (allInTestMode) {
        return;
      }
      
      // 如果至少有一个平台在生产模式，3秒后自动跳转
      const timer = setTimeout(() => {
        showSuccess("配置验证通过！正在跳转到验收页面...");
        handleGoToVerification();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [currentStep, validationResults, isSwitchingToLive, allInTestMode, handleGoToVerification, showSuccess]);

  const allInTestMode = Array.from(selectedPlatforms).every(
    (platform) => platformConfigs[platform]?.environment === "test"
  );

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

      {}
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
                            {PLATFORM_INFO[platform].name}: {result.message}
                          </Text>
                        </InlineStack>
                        {result.details && (
                          <BlockStack gap="300">
                            {/* 测试事件发送状态 */}
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
                            
                            {/* Meta Test Event Code */}
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
                                    url={`https://business.facebook.com/events_manager2/list/test_events?asset_id=${platformConfigs[platform]?.platformId || ""}`}
                                    external
                                  >
                                    打开 Meta Events Manager
                                  </Link>
                                </BlockStack>
                              </Banner>
                            )}
                            
                            {/* GA4 DebugView */}
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
                            
                            {/* 验证说明 */}
                            {result.details.verificationInstructions && (
                              <Banner tone="info">
                                <Text as="span" variant="bodySm">
                                  💡 {result.details.verificationInstructions}
                                </Text>
                              </Banner>
                            )}
                            
                            {/* 错误信息 */}
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
                            
                            {/* 测试事件详情查看 */}
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

      {}
      {allInTestMode && Object.keys(validationResults).length > 0 &&
       Object.values(validationResults).every(r => r.valid) && (
        <Card>
          <BlockStack gap="300">
            <Text as="h4" variant="headingSm">
              切换到生产模式
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                测试验证通过后，您可以切换到生产模式。切换后，事件将发送到实际广告平台。
              </Text>
            </Banner>
            <Button
              variant="primary"
              onClick={handleSwitchToLive}
              loading={isSwitchingToLive}
              disabled={isSwitchingToLive}
            >
              切换到生产模式并前往验收
            </Button>
          </BlockStack>
        </Card>
      )}

      {}
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
              // 立即跳转到验收页面
              setTimeout(() => {
                window.location.href = "/app/verification";
              }, 300);
            }}
          >
            ✅ 完成并前往验收
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );
}
