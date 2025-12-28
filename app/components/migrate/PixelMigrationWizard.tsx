/**
 * 像素迁移向导组件
 * 对应设计方案 4.3 Pixels：像素迁移中心
 * 
 * 功能：
 * - 分步骤配置流程
 * - 事件映射可视化
 * - 预设模板库
 */

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
  Tabs,
  DataTable,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  SettingsIcon,
  PlayIcon,
  CheckIcon,
} from "~/components/icons";
import { useSubmit, useNavigation } from "@remix-run/react";
import { useToastContext } from "~/components/ui";

// ============================================================
// 类型定义
// ============================================================

type Platform = "google" | "meta" | "tiktok" | "pinterest";

interface PlatformConfig {
  platform: Platform;
  enabled: boolean;
  platformId: string;
  credentials: {
    // GA4
    measurementId?: string;
    apiSecret?: string;
    // Meta
    pixelId?: string;
    accessToken?: string;
    testEventCode?: string;
    // TikTok
    pixelId?: string;
    accessToken?: string;
    // Pinterest
    pixelId?: string;
    accessToken?: string;
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

// ============================================================
// 预设模板
// ============================================================

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

// ============================================================
// 默认事件映射
// ============================================================

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

// ============================================================
// 平台信息
// ============================================================

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

// ============================================================
// 组件
// ============================================================

export interface PixelMigrationWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  initialPlatforms?: Platform[];
  canManageMultiple?: boolean;
}

type WizardStep = "select" | "credentials" | "mappings" | "review" | "testing";

export function PixelMigrationWizard({
  onComplete,
  onCancel,
  initialPlatforms = [],
  canManageMultiple = false,
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

  const isSubmitting = navigation.state === "submitting";

  // 初始化选中的平台
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

  // 步骤配置
  const steps: Array<{ id: WizardStep; label: string; number: number }> = [
    { id: "select", label: "选择平台", number: 1 },
    { id: "credentials", label: "填写凭证", number: 2 },
    { id: "mappings", label: "事件映射", number: 3 },
    { id: "review", label: "检查配置", number: 4 },
    { id: "testing", label: "测试验证", number: 5 },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  // 处理平台选择
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

  // 应用模板
  const handleApplyTemplate = useCallback(
    (template: PixelTemplate) => {
      const configs = { ...platformConfigs };
      const platforms = new Set<Platform>();

      template.platforms.forEach((platform) => {
        platforms.add(platform);
        configs[platform] = {
          ...configs[platform],
          enabled: true,
          eventMappings: template.eventMappings[platform] || {},
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

  // 更新凭证
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

  // 更新事件映射
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

  // 切换环境
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

  // 验证配置
  const validateConfig = useCallback((platform: Platform): string[] => {
    const config = platformConfigs[platform];
    const errors: string[] = [];
    const info = PLATFORM_INFO[platform];

    if (!config.enabled) return errors;

    // 验证凭证字段
    info.credentialFields.forEach((field) => {
      if (field.key === "testEventCode") return; // 可选字段
      if (!config.credentials[field.key as keyof typeof config.credentials]) {
        errors.push(`${info.name}: 缺少 ${field.label}`);
      }
    });

    return errors;
  }, [platformConfigs]);

  // 保存配置
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

    // 构建配置数组
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

    // 提交配置
    const formData = new FormData();
    formData.append("_action", "saveWizardConfigs");
    formData.append("configs", JSON.stringify(configs));

    submit(formData, {
      method: "post",
    });

    showSuccess("配置已保存，正在验证...");
    setCurrentStep("testing");
  }, [selectedPlatforms, platformConfigs, validateConfig, submit, showSuccess, showError]);

  // 渲染步骤内容
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
            onComplete={onComplete}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Card>
      <BlockStack gap="500">
        {/* 步骤指示器 */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              像素迁移向导
            </Text>
            <Badge tone="info">
              步骤 {currentStepIndex + 1} / {steps.length}
            </Badge>
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
                    {index < currentStepIndex ? "✓" : step.number}
                  </Text>
                </Box>
                <Text
                  as="span"
                  fontWeight={index === currentStepIndex ? "bold" : "regular"}
                  tone={index <= currentStepIndex ? undefined : "subdued"}
                >
                  {step.label}
                </Text>
              </InlineStack>
            ))}
          </InlineStack>
        </BlockStack>

        <Divider />

        {/* 步骤内容 */}
        {renderStepContent()}

        <Divider />

        {/* 导航按钮 */}
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
                icon={ArrowLeftIcon}
              >
                上一步
              </Button>
            )}
            {currentStep === "review" ? (
              <Button
                variant="primary"
                onClick={handleSave}
                loading={isSubmitting}
                icon={CheckIcon}
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

// ============================================================
// 步骤组件
// ============================================================

function SelectPlatformStep({
  selectedPlatforms,
  platformConfigs,
  onPlatformToggle,
  onApplyTemplate,
  showTemplateModal,
  onShowTemplateModal,
}: {
  selectedPlatforms: Set<Platform>;
  platformConfigs: Record<Platform, PlatformConfig>;
  onPlatformToggle: (platform: Platform, enabled: boolean) => void;
  onApplyTemplate: (template: PixelTemplate) => void;
  showTemplateModal: boolean;
  onShowTemplateModal: (show: boolean) => void;
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

      {/* 模板选择模态框 */}
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
            {PRESET_TEMPLATES.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {template.name}
                      </Text>
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
                    {template.platforms.map((p) => (
                      <Badge key={p}>{PLATFORM_INFO[p].name}</Badge>
                    ))}
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
  const shopifyEvents = ["checkout_completed"]; // 当前仅支持 checkout_completed

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
        const info = PLATFORM_INFO[platform];

        return (
          <Card key={platform}>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="headingLg">
                  {info.icon}
                </Text>
                <Text as="span" fontWeight="semibold">
                  {info.name}
                </Text>
              </InlineStack>

              <Divider />

              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Shopify 事件", "平台事件"]}
                rows={shopifyEvents.map((shopifyEvent) => [
                  shopifyEvent,
                  <TextField
                    key={shopifyEvent}
                    value={config.eventMappings[shopifyEvent] || ""}
                    onChange={(value) =>
                      onEventMappingUpdate(platform, shopifyEvent, value)
                    }
                    placeholder="输入平台事件名称"
                    autoComplete="off"
                  />,
                ])}
              />
            </BlockStack>
          </Card>
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
  onComplete,
}: {
  selectedPlatforms: Set<Platform>;
  onComplete: () => void;
}) {
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
            <List.Item>创建一个测试订单</List.Item>
            <List.Item>在「监控」页面查看事件是否成功发送</List.Item>
            <List.Item>在「验收」页面运行验收测试</List.Item>
            <List.Item>验证无误后，在设置页面将环境切换为「生产模式」</List.Item>
          </List>
        </BlockStack>
      </Banner>

      <InlineStack gap="200">
        <Button url="/app/monitor" variant="primary">
          前往监控页面
        </Button>
        <Button url="/app/verification">
          运行验收测试
        </Button>
        <Button onClick={onComplete}>完成</Button>
      </InlineStack>
    </BlockStack>
  );
}
