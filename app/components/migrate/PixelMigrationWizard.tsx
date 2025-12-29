

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
}

type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

export function PixelMigrationWizard({
  onComplete,
  onCancel,
  initialPlatforms = [],
  canManageMultiple = false,
  shopId,
  templates,
}: PixelMigrationWizardProps) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  const [currentStep, setCurrentStep] = useState<WizardStep>("select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    new Set(initialPlatforms)
  );
  const [platformConfigs, setPlatformConfigs] = useState<
    Record<Platform, PlatformConfig>
  >({
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

  useEffect(() => {
    if (initialPlatforms.length > 0) {
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

  const handleSave = useCallback(() => {
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

    showSuccess("配置已保存，正在验证...");
    setCurrentStep("testing");
  }, [selectedPlatforms, platformConfigs, validateConfig, submit, showSuccess, showError]);

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
          <InlineStack gap="200" wrap>
            {steps.map((step, index) => (
              <InlineStack key={step.id} gap="200" blockAlign="center">
                <Box
                  background={
                    index < currentStepIndex
                      ? "bg-fill-success"
                      : index === currentStepIndex
                        ? "bg-fill-info"
                        : "bg-surface-secondary"
                  }
                  padding="200"
                  borderRadius="full"
                  minWidth="32px"
                  minHeight="32px"
                >
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight="bold"
                    alignment="center"
                  >
                    {index < currentStepIndex ? "✓" : String(step.number)}
                  </Text>
                </Box>
                <BlockStack gap="050">
                  <Text
                    as="span"
                    fontWeight={index === currentStepIndex ? "bold" : "regular"}
                    tone={index <= currentStepIndex ? undefined : "subdued"}
                  >
                    {step.label}
                  </Text>
                  {index === currentStepIndex && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {step.description} · 预计 {step.estimatedTime}
                    </Text>
                  )}
                </BlockStack>
              </InlineStack>
            ))}
          </InlineStack>
        </BlockStack>

        <Divider />

        {}
        {renderStepContent()}

        <Divider />

        {}
        <InlineStack align="space-between">
          <Button onClick={onCancel} disabled={isSubmitting}>
            取消
          </Button>
          <InlineStack gap="200">
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
                onClick={() => {
                  const nextStep = steps[currentStepIndex + 1].id;
                  setCurrentStep(nextStep);
                }}
                disabled={
                  isSubmitting ||
                  (currentStep === "select" && selectedPlatforms.size === 0)
                }
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
  const [validationResults, setValidationResults] = useState<Record<string, { valid: boolean; message: string; details?: { eventSent?: boolean; responseTime?: number; error?: string } }>>({});
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
          details: result.details,
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

  useEffect(() => {
    if (currentStep === "testing" &&
        Object.keys(validationResults).length > 0 &&
        Object.values(validationResults).every(r => r.valid)) {
      const timer = setTimeout(() => {

        if (!isSwitchingToLive) {
          handleGoToVerification();
        }
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [currentStep, validationResults, isSwitchingToLive, handleGoToVerification]);

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
              <Text as="h4" variant="headingSm">
                测试环境验证
              </Text>
              <Button
                size="slim"
                onClick={handleValidateTestEnvironment}
                loading={isValidating}
                disabled={isValidating}
              >
                验证配置
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
                          <BlockStack gap="100">
                            {result.details.eventSent && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                ✓ 测试事件已发送
                                {result.details.responseTime && ` (响应时间: ${result.details.responseTime}ms)`}
                              </Text>
                            )}
                            {result.details.error && (
                              <Text as="span" variant="bodySm" tone="critical">
                                ✗ 错误: {result.details.error}
                              </Text>
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
            onClick={() => {
              onComplete();

              setTimeout(() => {
                window.location.href = "/app/verification";
              }, 500);
            }}
          >
            完成并前往验收
          </Button>
        )}
      </InlineStack>
    </BlockStack>
  );
}
