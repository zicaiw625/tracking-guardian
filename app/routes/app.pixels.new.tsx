import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  Select,
  TextField,
  Modal,
  Checkbox,
} from "@shopify/polaris";
import { ArrowRightIcon, CheckCircleIcon, SettingsIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { EventMappingEditor } from "~/components/migrate/EventMappingEditor";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { getWizardTemplates } from "~/services/pixel-template.server";
import { encryptJson } from "~/utils/crypto.server";
import { generateSimpleId, safeFireAndForget } from "~/utils/helpers";
import { isPlanAtLeast } from "~/utils/plans";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, updateWebPixel } from "~/services/migration.server";
import { decryptIngestionSecret, encryptIngestionSecret, isTokenEncrypted } from "~/utils/token-encryption";
import { randomBytes } from "crypto";
import { logger } from "~/utils/logger.server";
import type { PlatformType } from "~/types/enums";
import type { WizardTemplate } from "~/components/migrate/PixelMigrationWizard";
import { trackEvent } from "~/services/analytics.server";

const PRESET_TEMPLATES: WizardTemplate[] = [
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
    isPublic: true,
    usageCount: 0,
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
    },
    isPublic: true,
    usageCount: 0,
  },
];

const DEFAULT_EVENT_MAPPINGS: Partial<Record<PlatformType, Record<string, string>>> = {
  google: {
    checkout_completed: "purchase",
    checkout_started: "begin_checkout",
    add_to_cart: "add_to_cart",
    view_item: "view_item",
    search: "search",
  },
  meta: {
    checkout_completed: "Purchase",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_content: "ViewContent",
    search: "Search",
  },
  tiktok: {
    checkout_completed: "CompletePayment",
    checkout_started: "InitiateCheckout",
    add_to_cart: "AddToCart",
    view_content: "ViewContent",
    search: "Search",
  },
  pinterest: {
    checkout_completed: "checkout",
    checkout_started: "checkout",
    add_to_cart: "addtocart",
    view_content: "pagevisit",
    search: "search",
  },
  snapchat: {
    checkout_completed: "PURCHASE",
    checkout_started: "START_CHECKOUT",
    add_to_cart: "ADD_CART",
    view_content: "VIEW_CONTENT",
    search: "SEARCH",
  },
};

const PLATFORM_INFO: Record<PlatformType, {
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
}> = {
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
  snapchat: {
    name: "Snapchat Pixel",
    icon: "👻",
    description: "使用 Conversions API 发送转化数据",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "text",
        helpText: "在 Snapchat Ads Manager → Pixels 中查找",
      },
      {
        key: "accessToken",
        label: "Conversions API Token",
        placeholder: "输入 Conversions API Token",
        type: "password",
        helpText: "在 Snapchat Ads Manager → Pixels → Settings 中生成",
      },
    ],
  },
};

interface PlatformConfig {
  platform: PlatformType;
  enabled: boolean;
  platformId: string;
  credentials: Record<string, string>;
  eventMappings: Record<string, string>;
  environment: "test" | "live";
}

type SetupStep = "select" | "credentials" | "mappings" | "review";

function generateIngestionSecret(): string {
  return randomBytes(32).toString("hex");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      ingestionSecret: true,
      webPixelId: true,
    },
  });

  if (!shop) {
    return json({
      shop: null,
      templates: {
        presets: PRESET_TEMPLATES,
        custom: [],
      },
      isStarterOrAbove: false,
    });
  }

  const templates = await getWizardTemplates(shop.id);
  const isStarterOrAbove = isPlanAtLeast(shop.plan, "starter");

  return json({
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      webPixelId: shop.webPixelId,
      ingestionSecret: shop.ingestionSecret,
    },
    templates,
    isStarterOrAbove,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      ingestionSecret: true,
      webPixelId: true,
      plan: true,
    },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  if (actionType === "savePixelConfigs") {
    const configsJson = formData.get("configs") as string;

    if (!configsJson) {
      return json({ error: "缺少配置数据" }, { status: 400 });
    }

    if (!isPlanAtLeast(shop.plan, "starter")) {
      return json({
        success: false,
        error: "启用像素迁移需要 Migration ($49/月) 及以上套餐。请先升级套餐。",
      }, { status: 403 });
    }

    try {
      const configs = JSON.parse(configsJson) as Array<{
        platform: string;
        platformId: string;
        credentials: Record<string, string>;
        eventMappings: Record<string, string>;
        environment: "test" | "live";
      }>;

      const configIds: string[] = [];
      const createdPlatforms: string[] = [];

      for (const config of configs) {
        const platform = config.platform as "google" | "meta" | "tiktok" | "pinterest" | "snapchat";

        let credentials: Record<string, string> = {};
        if (platform === "google") {
          credentials = {
            measurementId: config.credentials.measurementId || "",
            apiSecret: config.credentials.apiSecret || "",
          };
        } else {
          credentials = {
            pixelId: config.credentials.pixelId || "",
            accessToken: config.credentials.accessToken || "",
            ...(config.credentials.testEventCode && { testEventCode: config.credentials.testEventCode }),
          };
        }

        const encryptedCredentials = encryptJson(credentials);
        const platformIdValue = config.platformId?.trim() || null;
        const existingConfig = await prisma.pixelConfig.findFirst({
          where: {
            shopId: shop.id,
            platform,
            environment: config.environment,
            ...(platformIdValue
              ? { platformId: platformIdValue }
              : {
                  OR: [
                    { platformId: null },
                    { platformId: "" },
                  ],
                }),
          },
          select: { id: true },
        });

        const fullFunnelEvents = ["page_viewed", "product_viewed", "product_added_to_cart", "checkout_started"];
        const hasFullFunnelEvents = Object.keys(config.eventMappings || {}).some(eventName =>
          fullFunnelEvents.includes(eventName)
        );
        const mode: "purchase_only" | "full_funnel" = hasFullFunnelEvents ? "full_funnel" : "purchase_only";
        const clientConfig = { mode };

        const savedConfig = await prisma.pixelConfig.upsert({
          where: {
            shopId_platform_environment_platformId: {
              shopId: shop.id,
              platform,
              environment: config.environment,
              platformId: platformIdValue || "",
            },
          },
          update: {
            platformId: platformIdValue as string | null,
            credentialsEncrypted: encryptedCredentials,
            serverSideEnabled: true,
            eventMappings: config.eventMappings as object,
            clientConfig: clientConfig as object,
            environment: config.environment,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
          },
          create: {
            id: generateSimpleId("pixel-config"),
            shopId: shop.id,
            platform,
            platformId: (config.platformId && config.platformId.trim()) ? config.platformId : null,
            credentialsEncrypted: encryptedCredentials,
            serverSideEnabled: true,
            eventMappings: config.eventMappings as object,
            clientConfig: clientConfig as object,
            environment: config.environment,
            migrationStatus: "in_progress",
            updatedAt: new Date(),
          },
          select: { id: true },
        });

        configIds.push(savedConfig.id);
        if (!existingConfig) {
          createdPlatforms.push(platform);
        }
      }

      let ingestionSecret: string | undefined = undefined;
      if (shop.ingestionSecret) {
        try {
          if (isTokenEncrypted(shop.ingestionSecret)) {
            ingestionSecret = decryptIngestionSecret(shop.ingestionSecret);
          } else {
            ingestionSecret = shop.ingestionSecret;
            const encryptedSecret = encryptIngestionSecret(ingestionSecret as string);
            await prisma.shop.update({
              where: { id: shop.id },
              data: { ingestionSecret: encryptedSecret },
            });
          }
        } catch (error) {
          logger.error(`[PixelsNew] Failed to decrypt ingestionSecret for ${shopDomain}`, error);
        }
      }

      if (!ingestionSecret) {
        ingestionSecret = generateIngestionSecret();
        const encryptedSecret = encryptIngestionSecret(ingestionSecret);
        await prisma.shop.update({
          where: { id: shop.id },
          data: { ingestionSecret: encryptedSecret },
        });
      }

      let ourPixelId = shop.webPixelId;
      if (!ourPixelId) {
        const existingPixels = await getExistingWebPixels(admin);
        const ourPixel = existingPixels.find((p) => {
          if (!p.settings) return false;
          try {
            const settings = JSON.parse(p.settings);
            return isOurWebPixel(settings, shopDomain);
          } catch {
            return false;
          }
        });
        ourPixelId = ourPixel?.id ?? null;
      }

      if (ourPixelId) {
        await updateWebPixel(admin, ourPixelId, ingestionSecret, shopDomain);
      } else {
        const result = await createWebPixel(admin, ingestionSecret, shopDomain);
        if (result.success && result.webPixelId) {
          await prisma.shop.update({
            where: { id: shop.id },
            data: { webPixelId: result.webPixelId },
          });
        }
      }

      if (createdPlatforms.length > 0) {
        safeFireAndForget(
          trackEvent({
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            event: "cfg_pixel_created",
            metadata: {
              count: createdPlatforms.length,
              platforms: createdPlatforms,
            },
          })
        );
      }

      return json({ success: true, configIds });
    } catch (error) {
      logger.error("Failed to save pixel configs", error);
      return json({
        success: false,
        error: error instanceof Error ? error.message : "保存配置失败",
      }, { status: 500 });
    }
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function PixelsNewPage() {
  const { shop, templates, isStarterOrAbove } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToastContext();

  const [currentStep, setCurrentStep] = useState<SetupStep>("select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<PlatformType>>(new Set());
  const [platformConfigs, setPlatformConfigs] = useState<Partial<Record<PlatformType, PlatformConfig>>>(() => ({
    google: {
      platform: "google",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.google || {},
      environment: "test",
    },
    meta: {
      platform: "meta",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.meta || {},
      environment: "test",
    },
    tiktok: {
      platform: "tiktok",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.tiktok || {},
      environment: "test",
    },
    pinterest: {
      platform: "pinterest",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.pinterest || {},
      environment: "test",
    },
    snapchat: {
      platform: "snapchat",
      enabled: false,
      platformId: "",
      credentials: {},
      eventMappings: DEFAULT_EVENT_MAPPINGS.snapchat || {},
      environment: "test",
    },
  }));
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const steps = useMemo(() => ([
    { id: "select", label: "选择平台" },
    { id: "credentials", label: "填写凭证" },
    { id: "mappings", label: "事件映射" },
    { id: "review", label: "检查配置" },
  ]), []);

  useEffect(() => {
    if (actionData && actionData.success) {
      const configIds = actionData.configIds || [];
      showSuccess("配置已保存，进入测试页面...");
      if (configIds.length === 1) {
        navigate(`/app/pixels/${configIds[0]}/test`);
      } else {
        navigate("/app/pixels");
      }
    } else if (actionData && actionData.success === false && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, navigate, showSuccess, showError]);

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

  const handleApplyTemplate = useCallback((template: WizardTemplate) => {
    const configs = { ...platformConfigs };
    const platforms = new Set<PlatformType>();

    template.platforms.forEach((platform) => {
      const platformKey = platform as PlatformType;
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
  }, [platformConfigs, showSuccess]);

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

  const validateStep = useCallback((step: SetupStep) => {
    const errors: string[] = [];
    if (step === "select" && selectedPlatforms.size === 0) {
      errors.push("请至少选择一个平台");
    }

    if (step === "credentials") {
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
  }, [platformConfigs, selectedPlatforms]);

  const handleNext = useCallback(() => {
    const errors = validateStep(currentStep);
    if (errors.length > 0) {
      showError(`请先完成当前步骤：${errors.join("; ")}`);
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1].id as SetupStep);
    }
  }, [currentStep, steps, validateStep, showError]);

  const handleSave = useCallback(() => {
    const errors = validateStep("credentials").concat(validateStep("mappings"));
    if (errors.length > 0) {
      showError(`配置错误：${errors.join("; ")}`);
      return;
    }

    const enabledPlatforms = Array.from(selectedPlatforms);
    const configs = enabledPlatforms.map((platform) => {
      const config = platformConfigs[platform] as PlatformConfig;
      return {
        platform,
        platformId: config.platformId,
        credentials: config.credentials,
        eventMappings: config.eventMappings,
        environment: config.environment,
      };
    });

    const formData = new FormData();
    formData.append("_action", "savePixelConfigs");
    formData.append("configs", JSON.stringify(configs));
    submit(formData, { method: "post" });
  }, [platformConfigs, selectedPlatforms, submit, validateStep, showError]);

  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const isSubmitting = navigation.state === "submitting";

  const availableTemplates = useMemo(() => {
    const presetTemplates = templates?.presets?.length ? templates.presets : PRESET_TEMPLATES;
    const customTemplates = templates?.custom || [];
    return [...presetTemplates, ...customTemplates];
  }, [templates]);

  if (!shop) {
    return (
      <Page title="新建 Pixel">
        <Banner tone="critical" title="店铺信息未找到">
          <Text as="p">未找到店铺信息，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="新建 Pixel 配置"
      subtitle="模板选择 / 凭据 / 映射 / 环境"
      backAction={{ content: "返回 Pixels", url: "/app/pixels" }}
    >
      <BlockStack gap="500">
        {!isStarterOrAbove && (
          <Banner tone="warning" title="需要升级套餐">
            <Text as="p">
              启用像素迁移需要 Migration ($49/月) 及以上套餐。请先升级后再配置。
            </Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">配置进度</Text>
              <Badge tone="info">{`步骤 ${currentIndex + 1} / ${steps.length}`}</Badge>
            </InlineStack>
            <InlineStack gap="300" wrap>
              {steps.map((step, index) => (
                <Badge
                  key={step.id}
                  tone={index === currentIndex ? "success" : index < currentIndex ? "info" : undefined}
                >
                  {step.label}
                </Badge>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        {currentStep === "select" && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">选择要配置的平台</Text>
                <Button size="slim" icon={SettingsIcon} onClick={() => setShowTemplateModal(true)}>
                  查看模板
                </Button>
              </InlineStack>
              <Text as="p" tone="subdued">
                选择您要迁移的广告平台，可使用预设模板快速配置事件映射。
              </Text>

              <BlockStack gap="300">
                {(Object.keys(PLATFORM_INFO) as PlatformType[]).map((platform) => {
                  const info = PLATFORM_INFO[platform];
                  const isSelected = selectedPlatforms.has(platform);
                  const isV1Supported = platform === "google" || platform === "meta" || platform === "tiktok";
                  const isDisabled = !isV1Supported;

                  return (
                    <Card key={platform}>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <Text as="span" variant="headingLg">{info.icon}</Text>
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" fontWeight="semibold">{info.name}</Text>
                                {isV1Supported ? (
                                  <Badge tone="success" size="small">v1 支持</Badge>
                                ) : (
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
                                handlePlatformToggle(platform, checked);
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
            </BlockStack>
          </Card>
        )}

        {currentStep === "credentials" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">填写平台凭证</Text>
              <Text as="p" tone="subdued">
                为每个选中的平台填写 API 凭证，并设置环境。
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
                          <Text as="span" variant="headingLg">{info.icon}</Text>
                          <Text as="span" fontWeight="semibold">{info.name}</Text>
                        </InlineStack>
                        <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                          {config.environment === "live" ? "🔴 生产模式" : "🟡 测试模式"}
                        </Badge>
                      </InlineStack>

                      <Select
                        label="切换环境"
                        options={[
                          { label: "🟡 测试环境 (Test) - 用于验证配置", value: "test" },
                          { label: "🔴 生产环境 (Live) - 正式发送事件", value: "live" },
                        ]}
                        value={config.environment}
                        onChange={(value) => handleEnvironmentToggle(platform, value as "test" | "live")}
                        helpText={
                          config.environment === "test"
                            ? "测试模式：事件发送到测试端点，不会影响实际广告数据"
                            : "生产模式：事件发送到正式端点，将影响广告归因和优化"
                        }
                      />

                      <Divider />

                      <BlockStack gap="300">
                        {info.credentialFields.map((field) => (
                          <TextField
                            key={field.key}
                            label={field.label}
                            type={field.type}
                            value={config.credentials[field.key] || ""}
                            onChange={(value) => handleCredentialUpdate(platform, field.key, value)}
                            placeholder={field.placeholder}
                            helpText={field.helpText}
                            autoComplete="off"
                          />
                        ))}
                      </BlockStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Card>
        )}

        {currentStep === "mappings" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">配置事件映射</Text>
              <Text as="p" tone="subdued">
                将 Shopify 事件映射到各平台事件。您可以基于推荐映射进行调整。
              </Text>
              {Array.from(selectedPlatforms).map((platform) => {
                const config = platformConfigs[platform];
                if (!config) return null;
                return (
                  <EventMappingEditor
                    key={platform}
                    platform={platform as "google" | "meta" | "tiktok" | "pinterest"}
                    mappings={config.eventMappings}
                    onMappingChange={(shopifyEvent, platformEvent) =>
                      handleEventMappingUpdate(platform, shopifyEvent, platformEvent)
                    }
                  />
                );
              })}
            </BlockStack>
          </Card>
        )}

        {currentStep === "review" && (
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">检查配置</Text>
              <Text as="p" tone="subdued">
                确认平台、凭证与事件映射无误后保存配置。
              </Text>

              {Array.from(selectedPlatforms).map((platform) => {
                const config = platformConfigs[platform];
                const info = PLATFORM_INFO[platform];
                if (!config || !info) return null;

                return (
                  <Card key={platform}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="headingLg">{info.icon}</Text>
                          <Text as="span" fontWeight="semibold">{info.name}</Text>
                        </InlineStack>
                        <Badge tone={config.environment === "live" ? "critical" : "warning"}>
                          {config.environment === "live" ? "生产" : "测试"}
                        </Badge>
                      </InlineStack>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">平台 ID</Text>
                        <Text as="span" fontWeight="semibold">{config.platformId || "未填写"}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" tone="subdued">事件映射</Text>
                        <Text as="span">{Object.keys(config.eventMappings || {}).length} 个事件</Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Card>
        )}

        <Card>
          <InlineStack align="space-between" wrap>
            <Button url="/app/pixels" disabled={isSubmitting}>
              取消
            </Button>
            <InlineStack gap="200" wrap>
              {currentIndex > 0 && (
                <Button
                  onClick={() => setCurrentStep(steps[currentIndex - 1].id as SetupStep)}
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
      </BlockStack>

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
            {availableTemplates.map((template) => (
              <Card key={template.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">{template.name}</Text>
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
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
