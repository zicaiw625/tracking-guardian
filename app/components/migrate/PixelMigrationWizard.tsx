/**
 * 像素迁移向导组件
 * 对应设计方案 4.3 Pixels：像素迁移中心
 * 
 * 功能：
 * - 分步骤配置流程
 * - 事件映射可视化
 * - 预设模板库
 */

import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Divider,
  Banner,
  Select,
  TextField,
  Checkbox,
  List,
  Icon,
  Modal,
  ProgressBar,
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
} from "~/components/icons";

// ============================================================
// 类型定义
// ============================================================

export type Platform = "google" | "meta" | "tiktok" | "pinterest";

export interface PlatformConfig {
  platform: Platform;
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

export interface PixelTemplate {
  id: string;
  name: string;
  description: string;
  platforms: Platform[];
  isPublic: boolean;
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
}

// ============================================================
// 预设模板
// ============================================================

const PRESET_TEMPLATES: PixelTemplate[] = [
  {
    id: "standard-ga4",
    name: "标准 GA4 配置",
    description: "包含 purchase、begin_checkout、add_to_cart 等标准事件",
    platforms: ["google"],
    isPublic: true,
  },
  {
    id: "standard-meta",
    name: "标准 Meta Pixel 配置",
    description: "包含 Purchase、ViewContent、AddToCart、InitiateCheckout 等标准事件",
    platforms: ["meta"],
    isPublic: true,
  },
  {
    id: "standard-tiktok",
    name: "标准 TikTok Pixel 配置",
    description: "包含 CompletePayment、ViewContent、AddToCart、InitiateCheckout 等标准事件",
    platforms: ["tiktok"],
    isPublic: true,
  },
  {
    id: "multi-platform",
    name: "多平台标准配置",
    description: "同时配置 GA4、Meta 和 TikTok 的标准事件映射",
    platforms: ["google", "meta", "tiktok"],
    isPublic: true,
  },
];

// 标准事件映射
const STANDARD_EVENT_MAPPINGS: Record<Platform, Record<string, string>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    product_added_to_cart: "add_to_cart",
    product_viewed: "view_item",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    product_added_to_cart: "AddToCart",
    product_viewed: "ViewContent",
  },
  pinterest: {
    checkout_completed: "checkout",
    checkout_started: "checkout",
    product_added_to_cart: "addtocart",
    product_viewed: "pagevisit",
  },
};

// ============================================================
// 组件
// ============================================================

interface PixelMigrationWizardProps {
  onComplete: (configs: PlatformConfig[]) => void;
  onCancel?: () => void;
  initialPlatforms?: Platform[];
  canManageMultiple?: boolean;
}

export function PixelMigrationWizard({
  onComplete,
  onCancel,
  initialPlatforms = [],
  canManageMultiple = false,
}: PixelMigrationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(initialPlatforms);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Map<Platform, PlatformConfig>>(new Map());
  const [showEventMapping, setShowEventMapping] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);

  const steps: WizardStep[] = [
    {
      id: "select-platforms",
      title: "选择平台",
      description: "选择需要配置的广告平台",
    },
    {
      id: "select-template",
      title: "选择模板",
      description: "选择预设模板或自定义配置",
    },
    {
      id: "configure-credentials",
      title: "配置凭证",
      description: "输入各平台的 API 凭证",
    },
    {
      id: "review",
      title: "检查配置",
      description: "确认配置信息无误",
    },
  ];

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // 完成配置
      const configsArray = Array.from(configs.values());
      onComplete(configsArray);
    }
  }, [currentStep, steps.length, configs, onComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handlePlatformToggle = useCallback(
    (platform: Platform) => {
      setSelectedPlatforms((prev) => {
        if (prev.includes(platform)) {
          return prev.filter((p) => p !== platform);
        }
        return [...prev, platform];
      });
    },
    []
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      setSelectedTemplate(templateId);
      const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
      if (template) {
        // 应用模板的事件映射
        const newConfigs = new Map(configs);
        template.platforms.forEach((platform) => {
          if (!newConfigs.has(platform)) {
            newConfigs.set(platform, {
              platform,
              platformId: "",
              credentials: {},
              eventMappings: STANDARD_EVENT_MAPPINGS[platform] || {},
              environment: "test",
            });
          } else {
            const existing = newConfigs.get(platform)!;
            newConfigs.set(platform, {
              ...existing,
              eventMappings: STANDARD_EVENT_MAPPINGS[platform] || existing.eventMappings,
            });
          }
        });
        setConfigs(newConfigs);
      }
    },
    [configs]
  );

  const handleConfigUpdate = useCallback(
    (platform: Platform, updates: Partial<PlatformConfig>) => {
      setConfigs((prev) => {
        const newConfigs = new Map(prev);
        const existing = newConfigs.get(platform) || {
          platform,
          platformId: "",
          credentials: {},
          eventMappings: STANDARD_EVENT_MAPPINGS[platform] || {},
          environment: "test",
        };
        newConfigs.set(platform, { ...existing, ...updates });
        return newConfigs;
      });
    },
    []
  );

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return selectedPlatforms.length > 0;
      case 1:
        return selectedTemplate !== null || selectedPlatforms.length > 0;
      case 2:
        // 检查所有选中的平台是否都配置了必要的凭证
        return selectedPlatforms.every((platform) => {
          const config = configs.get(platform);
          if (!config) return false;
          if (platform === "google") {
            return !!(config.credentials.measurementId && config.credentials.apiSecret);
          }
          if (platform === "meta" || platform === "tiktok" || platform === "pinterest") {
            return !!(config.credentials.pixelId && config.credentials.accessToken);
          }
          return false;
        });
      case 3:
        return true;
      default:
        return false;
    }
  };

  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <Card>
      <BlockStack gap="500">
        {/* 进度条 */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              像素迁移向导
            </Text>
            <Badge tone="info">{currentStep + 1} / {steps.length}</Badge>
          </InlineStack>
          <ProgressBar progress={progress} tone="primary" size="small" />
          <Text as="p" variant="bodySm" tone="subdued">
            {steps[currentStep].title}: {steps[currentStep].description}
          </Text>
        </BlockStack>

        <Divider />

        {/* 步骤 1: 选择平台 */}
        {currentStep === 0 && (
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              选择需要配置的广告平台
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                您可以选择一个或多个平台。配置完成后，Tracking Guardian 将自动将转化事件发送到这些平台。
              </Text>
            </Banner>

            <BlockStack gap="300">
              {(["google", "meta", "tiktok", "pinterest"] as Platform[]).map((platform) => (
                <Box
                  key={platform}
                  background={
                    selectedPlatforms.includes(platform)
                      ? "bg-fill-info-secondary"
                      : "bg-surface-secondary"
                  }
                  padding="400"
                  borderRadius="200"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Checkbox
                        checked={selectedPlatforms.includes(platform)}
                        onChange={() => handlePlatformToggle(platform)}
                        label={getPlatformName(platform)}
                      />
                      <Text as="span" variant="bodySm" tone="subdued">
                        {getPlatformDescription(platform)}
                      </Text>
                    </InlineStack>
                    {selectedPlatforms.includes(platform) && (
                      <Icon source={CheckCircleIcon} tone="success" />
                    )}
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        )}

        {/* 步骤 2: 选择模板 */}
        {currentStep === 1 && (
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              选择配置模板
            </Text>
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                选择预设模板可以快速应用标准事件映射。您也可以稍后自定义事件映射。
              </Text>
            </Banner>

            <Tabs
              tabs={[
                { id: "preset", content: "预设模板" },
                { id: "custom", content: "自定义" },
              ]}
              selected={selectedTemplate ? "preset" : "custom"}
              onSelect={(tabId) => {
                if (tabId === "custom") {
                  setSelectedTemplate(null);
                }
              }}
            >
              <Box paddingBlockStart="400">
                {selectedTemplate || (
                  <BlockStack gap="300">
                    {PRESET_TEMPLATES.filter((t) =>
                      t.platforms.some((p) => selectedPlatforms.includes(p))
                    ).map((template) => (
                      <Box
                        key={template.id}
                        background={
                          selectedTemplate === template.id
                            ? "bg-fill-info-secondary"
                            : "bg-surface-secondary"
                        }
                        padding="400"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="start">
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" fontWeight="semibold">
                                {template.name}
                              </Text>
                              <Badge>
                                {template.platforms.map(getPlatformName).join(", ")}
                              </Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {template.description}
                            </Text>
                          </BlockStack>
                          <Button
                            size="slim"
                            variant={selectedTemplate === template.id ? "primary" : "secondary"}
                            onClick={() => handleTemplateSelect(template.id)}
                          >
                            {selectedTemplate === template.id ? "已选择" : "选择"}
                          </Button>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </Box>
            </Tabs>
          </BlockStack>
        )}

        {/* 步骤 3: 配置凭证 */}
        {currentStep === 2 && (
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              配置平台凭证
            </Text>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                请确保凭证正确，错误的凭证将导致事件发送失败。建议先在测试模式下验证。
              </Text>
            </Banner>

            <BlockStack gap="500">
              {selectedPlatforms.map((platform) => {
                const config = configs.get(platform) || {
                  platform,
                  platformId: "",
                  credentials: {},
                  eventMappings: STANDARD_EVENT_MAPPINGS[platform] || {},
                  environment: "test",
                };

                return (
                  <Card key={platform}>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h4" variant="headingSm">
                          {getPlatformName(platform)}
                        </Text>
                        <Button
                          size="slim"
                          icon={SettingsIcon}
                          onClick={() => {
                            setEditingPlatform(platform);
                            setShowEventMapping(true);
                          }}
                        >
                          编辑事件映射
                        </Button>
                      </InlineStack>

                      <Divider />

                      {platform === "google" && (
                        <BlockStack gap="300">
                          <TextField
                            label="GA4 Measurement ID"
                            value={config.credentials.measurementId || ""}
                            onChange={(value) =>
                              handleConfigUpdate(platform, {
                                platformId: value,
                                credentials: {
                                  ...config.credentials,
                                  measurementId: value,
                                },
                              })
                            }
                            placeholder="G-XXXXXXXXXX"
                            helpText="在 GA4 管理后台的「管理」→「数据流」中查找"
                            autoComplete="off"
                          />
                          <TextField
                            label="API Secret"
                            type="password"
                            value={config.credentials.apiSecret || ""}
                            onChange={(value) =>
                              handleConfigUpdate(platform, {
                                credentials: {
                                  ...config.credentials,
                                  apiSecret: value,
                                },
                              })
                            }
                            placeholder="输入 API Secret"
                            helpText="在 GA4 管理后台的「管理」→「数据流」→「Measurement Protocol API secrets」中创建"
                            autoComplete="off"
                          />
                        </BlockStack>
                      )}

                      {(platform === "meta" || platform === "tiktok" || platform === "pinterest") && (
                        <BlockStack gap="300">
                          <TextField
                            label={`${getPlatformName(platform)} Pixel ID`}
                            value={config.credentials.pixelId || ""}
                            onChange={(value) =>
                              handleConfigUpdate(platform, {
                                platformId: value,
                                credentials: {
                                  ...config.credentials,
                                  pixelId: value,
                                },
                              })
                            }
                            placeholder={platform === "meta" ? "15-16 位数字" : "输入 Pixel ID"}
                            helpText={`在 ${getPlatformName(platform)} 的 Events Manager 中查找`}
                            autoComplete="off"
                          />
                          <TextField
                            label="Access Token"
                            type="password"
                            value={config.credentials.accessToken || ""}
                            onChange={(value) =>
                              handleConfigUpdate(platform, {
                                credentials: {
                                  ...config.credentials,
                                  accessToken: value,
                                },
                              })
                            }
                            placeholder="输入 Access Token"
                            helpText="在 Events Manager 中生成"
                            autoComplete="off"
                          />
                          {platform === "meta" && (
                            <TextField
                              label="Test Event Code (可选)"
                              value={config.credentials.testEventCode || ""}
                              onChange={(value) =>
                                handleConfigUpdate(platform, {
                                  credentials: {
                                    ...config.credentials,
                                    testEventCode: value,
                                  },
                                })
                              }
                              placeholder="输入测试事件代码"
                              helpText="用于在 Meta Events Manager 中测试事件"
                              autoComplete="off"
                            />
                          )}
                        </BlockStack>
                      )}

                      <Select
                        label="环境"
                        options={[
                          { label: "测试模式", value: "test" },
                          { label: "生产模式", value: "live" },
                        ]}
                        value={config.environment}
                        onChange={(value) =>
                          handleConfigUpdate(platform, {
                            environment: value as "test" | "live",
                          })
                        }
                        helpText="测试模式仅发送到测试端点，生产模式发送到正式端点"
                      />
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </BlockStack>
        )}

        {/* 步骤 4: 检查配置 */}
        {currentStep === 3 && (
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              检查配置
            </Text>
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                请确认以下配置信息无误。配置完成后，系统将自动创建像素配置并开始追踪。
              </Text>
            </Banner>

            <BlockStack gap="300">
              {selectedPlatforms.map((platform) => {
                const config = configs.get(platform);
                const hasCredentials =
                  platform === "google"
                    ? !!(config?.credentials.measurementId && config?.credentials.apiSecret)
                    : !!(config?.credentials.pixelId && config?.credentials.accessToken);
                const eventCount = Object.keys(config?.eventMappings || {}).length;
                const mappedEvents = Object.entries(config?.eventMappings || {})
                  .filter(([_, value]) => value !== "")
                  .map(([key, value]) => ({ shopify: key, platform: value }));

                return (
                  <Card key={platform}>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h4" variant="headingSm">
                          {getPlatformName(platform)}
                        </Text>
                        <InlineStack gap="200">
                          {hasCredentials ? (
                            <Badge tone="success">凭证已配置</Badge>
                          ) : (
                            <Badge tone="critical">凭证未配置</Badge>
                          )}
                          {config?.environment === "live" ? (
                            <Badge tone="success">生产环境</Badge>
                          ) : (
                            <Badge tone="info">测试环境</Badge>
                          )}
                        </InlineStack>
                      </InlineStack>

                      <Divider />

                      <BlockStack gap="300">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          凭证信息
                        </Text>
                        {platform === "google" && (
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm">
                              Measurement ID: <code>{config?.credentials.measurementId || "未设置"}</code>
                            </Text>
                            <Text as="p" variant="bodySm">
                              API Secret: <code>{config?.credentials.apiSecret ? "••••••••" : "未设置"}</code>
                            </Text>
                          </BlockStack>
                        )}
                        {(platform === "meta" || platform === "tiktok" || platform === "pinterest") && (
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm">
                              Pixel ID: <code>{config?.credentials.pixelId || "未设置"}</code>
                            </Text>
                            <Text as="p" variant="bodySm">
                              Access Token: <code>{config?.credentials.accessToken ? "••••••••" : "未设置"}</code>
                            </Text>
                            {platform === "meta" && config?.credentials.testEventCode && (
                              <Text as="p" variant="bodySm">
                                Test Event Code: <code>{config.credentials.testEventCode}</code>
                              </Text>
                            )}
                          </BlockStack>
                        )}
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            事件映射 ({eventCount} 个)
                          </Text>
                          <Button
                            size="slim"
                            icon={SettingsIcon}
                            onClick={() => {
                              setEditingPlatform(platform);
                              setShowEventMapping(true);
                            }}
                          >
                            编辑映射
                          </Button>
                        </InlineStack>
                        {mappedEvents.length > 0 ? (
                          <DataTable
                            columnContentTypes={["text", "text", "text"]}
                            headings={["Shopify 事件", "→", "平台事件"]}
                            rows={mappedEvents.map(({ shopify, platform: platformEvent }) => [
                              <code key={`${shopify}-shopify`}>{shopify}</code>,
                              <Icon key={`${shopify}-arrow`} source={ArrowRightIcon} tone="subdued" />,
                              <code key={`${shopify}-platform`}>{platformEvent}</code>,
                            ])}
                          />
                        ) : (
                          <Banner tone="warning">
                            <Text as="p" variant="bodySm">
                              尚未配置事件映射。请点击"编辑映射"按钮进行配置。
                            </Text>
                          </Banner>
                        )}
                      </BlockStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="p" fontWeight="semibold">
                  下一步操作：
                </Text>
                <List type="number">
                  <List.Item>系统将创建像素配置</List.Item>
                  <List.Item>在测试模式下创建一笔测试订单</List.Item>
                  <List.Item>在监控页面验证事件是否正常发送</List.Item>
                  <List.Item>确认无误后切换到生产模式</List.Item>
                </List>
              </BlockStack>
            </Box>
          </BlockStack>
        )}

        <Divider />

        {/* 操作按钮 */}
        <InlineStack align="space-between">
          <Button
            onClick={currentStep === 0 ? onCancel : handleBack}
            disabled={currentStep === 0 && !onCancel}
          >
            {currentStep === 0 ? "取消" : "上一步"}
          </Button>
          <InlineStack gap="200">
            {currentStep < steps.length - 1 ? (
              <Button variant="primary" onClick={handleNext} disabled={!canProceed()}>
                下一步
                <Icon source={ArrowRightIcon} />
              </Button>
            ) : (
              <Button variant="primary" onClick={handleNext} disabled={!canProceed()}>
                完成配置
                <Icon source={CheckCircleIcon} />
              </Button>
            )}
          </InlineStack>
        </InlineStack>
      </BlockStack>

      {/* 事件映射编辑模态框 */}
      <Modal
        open={showEventMapping && editingPlatform !== null}
        onClose={() => {
          setShowEventMapping(false);
          setEditingPlatform(null);
        }}
        title={`编辑 ${editingPlatform ? getPlatformName(editingPlatform) : ""} 事件映射`}
        primaryAction={{
          content: "保存",
          onAction: () => {
            setShowEventMapping(false);
            setEditingPlatform(null);
          },
        }}
        secondaryActions={[
          {
            content: "重置为默认",
            onAction: () => {
              if (editingPlatform) {
                handleConfigUpdate(editingPlatform, {
                  eventMappings: STANDARD_EVENT_MAPPINGS[editingPlatform] || {},
                });
              }
            },
          },
          {
            content: "取消",
            onAction: () => {
              setShowEventMapping(false);
              setEditingPlatform(null);
            },
          },
        ]}
        size="large"
      >
        <Modal.Section>
          {editingPlatform && (
            <EventMappingEditor
              platform={editingPlatform}
              mappings={configs.get(editingPlatform)?.eventMappings || {}}
              onChange={(mappings) =>
                handleConfigUpdate(editingPlatform, { eventMappings: mappings })
              }
            />
          )}
        </Modal.Section>
      </Modal>
    </Card>
  );
}

// ============================================================
// 事件映射编辑器
// ============================================================

interface EventMappingEditorProps {
  platform: Platform;
  mappings: Record<string, string>;
  onChange: (mappings: Record<string, string>) => void;
}

function EventMappingEditor({ platform, mappings, onChange }: EventMappingEditorProps) {
  const shopifyEvents = [
    { value: "checkout_completed", label: "结账完成", description: "顾客完成订单支付时触发", icon: "✓" },
    { value: "checkout_started", label: "开始结账", description: "顾客进入结账流程时触发", icon: "🛒" },
    { value: "product_added_to_cart", label: "加入购物车", description: "商品被添加到购物车时触发", icon: "➕" },
    { value: "product_viewed", label: "查看商品", description: "顾客查看商品详情页时触发", icon: "👁️" },
  ];

  const platformEvents = getPlatformEventOptions(platform);

  const handleMappingChange = (shopifyEvent: string, platformEvent: string) => {
    onChange({
      ...mappings,
      [shopifyEvent]: platformEvent,
    });
  };

  // 使用表格展示映射关系，更直观
  const tableRows = shopifyEvents.map((event) => {
    const mappedEvent = mappings[event.value] || "";
    const isMapped = mappedEvent !== "";
    
    return [
      <InlineStack key={`${event.value}-icon`} gap="200" blockAlign="center">
        <Text as="span" variant="headingSm">{event.icon}</Text>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">{event.label}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{event.description}</Text>
        </BlockStack>
      </InlineStack>,
      <Text key={`${event.value}-shopify`} as="span" variant="bodySm" tone="subdued">
        <code>{event.value}</code>
      </Text>,
      <Box key={`${event.value}-arrow`} minWidth="40px" paddingInlineStart="200">
        <Icon source={ArrowRightIcon} tone="subdued" />
      </Box>,
      <Box key={`${event.value}-select`} minWidth="250px">
        <Select
          options={[
            { label: "未映射", value: "" },
            ...platformEvents,
          ]}
          value={mappedEvent}
          onChange={(value) => handleMappingChange(event.value, value)}
        />
      </Box>,
      isMapped ? (
        <Badge key={`${event.value}-badge`} tone="success">已映射</Badge>
      ) : (
        <Badge key={`${event.value}-badge`} tone="attention">未映射</Badge>
      ),
    ];
  });

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            将 Shopify 标准事件映射到 {getPlatformName(platform)} 的事件名称
          </Text>
          <Text as="p" variant="bodySm">
            每个 Shopify 事件需要映射到对应的平台事件。建议使用标准映射以确保最佳追踪效果。
          </Text>
        </BlockStack>
      </Banner>

      <DataTable
        columnContentTypes={["text", "text", "text", "text", "text"]}
        headings={["Shopify 事件", "事件代码", "", "平台事件", "状态"]}
        rows={tableRows}
      />

      <Divider />

      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
        <BlockStack gap="200">
          <Text as="p" fontWeight="semibold">
            💡 映射建议
          </Text>
          <List type="bullet">
            <List.Item>
              <strong>checkout_completed</strong> 是最重要的事件，建议映射到平台的购买/转化事件
            </List.Item>
            <List.Item>
              其他事件（如查看商品、加入购物车）有助于优化广告投放和归因分析
            </List.Item>
            <List.Item>
              如果某个事件未映射，该事件将不会被发送到平台
            </List.Item>
          </List>
        </BlockStack>
      </Box>
    </BlockStack>
  );
}

// ============================================================
// 工具函数
// ============================================================

function getPlatformName(platform: Platform): string {
  const names: Record<Platform, string> = {
    google: "Google Analytics 4",
    meta: "Meta (Facebook)",
    tiktok: "TikTok",
    pinterest: "Pinterest",
  };
  return names[platform] || platform;
}

function getPlatformDescription(platform: Platform): string {
  const descriptions: Record<Platform, string> = {
    google: "使用 Measurement Protocol 发送转化数据",
    meta: "使用 Conversions API 发送转化数据",
    tiktok: "使用 Events API 发送转化数据",
    pinterest: "使用 Conversions API 发送转化数据",
  };
  return descriptions[platform] || "";
}

function getPlatformEventOptions(platform: Platform): Array<{ label: string; value: string }> {
  const options: Record<Platform, Array<{ label: string; value: string }>> = {
    google: [
      { label: "purchase", value: "purchase" },
      { label: "begin_checkout", value: "begin_checkout" },
      { label: "add_to_cart", value: "add_to_cart" },
      { label: "view_item", value: "view_item" },
    ],
    meta: [
      { label: "Purchase", value: "Purchase" },
      { label: "InitiateCheckout", value: "InitiateCheckout" },
      { label: "AddToCart", value: "AddToCart" },
      { label: "ViewContent", value: "ViewContent" },
    ],
    tiktok: [
      { label: "CompletePayment", value: "CompletePayment" },
      { label: "InitiateCheckout", value: "InitiateCheckout" },
      { label: "AddToCart", value: "AddToCart" },
      { label: "ViewContent", value: "ViewContent" },
    ],
    pinterest: [
      { label: "checkout", value: "checkout" },
      { label: "addtocart", value: "addtocart" },
      { label: "pagevisit", value: "pagevisit" },
    ],
  };
  return options[platform] || [];
}

