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
  List,
} from "@shopify/polaris";
import { ArrowRightIcon, CheckCircleIcon, SettingsIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";
import { EventMappingEditor } from "~/components/migrate/EventMappingEditor";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { encryptJson } from "~/utils/crypto.server";
import { generateSimpleId } from "~/utils/helpers";
import { safeFireAndForget } from "~/utils/helpers.server";
import { isPlanAtLeast } from "~/utils/plans";
import { normalizePlanId } from "~/services/billing/plans";
import { createWebPixel, getExistingWebPixels, isOurWebPixel, updateWebPixel } from "~/services/migration.server";
import { decryptIngestionSecret, encryptIngestionSecret, isTokenEncrypted } from "~/utils/token-encryption.server";
import { randomBytes } from "crypto";
import { logger } from "~/utils/logger.server";
import type { WizardTemplate } from "~/components/migrate/PixelMigrationWizard";
import { trackEvent } from "~/services/analytics.server";
import { getPixelEventIngestionUrl } from "~/utils/config.server";

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
    isPublic: true,
    usageCount: 0,
  },
];

const SUPPORTED_PLATFORMS = ["google", "meta", "tiktok"] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

const DEFAULT_EVENT_MAPPINGS: Record<SupportedPlatform, Record<string, string>> = {
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

const PLATFORM_INFO: Record<SupportedPlatform, {
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
};

interface PlatformConfig {
  platform: SupportedPlatform;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { session, admin: _admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      ingestionSecret: true,
      webPixelId: true,
      updatedAt: true,
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
      backendUrlInfo: getPixelEventIngestionUrl(),
    });
  }
  const isStarterOrAbove = isPlanAtLeast(shop.plan, "starter");
  const backendUrlInfo = getPixelEventIngestionUrl();
  return json({
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      webPixelId: shop.webPixelId,
      hasIngestionSecret: !!shop.ingestionSecret,
      lastRotatedAt: shop.updatedAt ? shop.updatedAt.toISOString() : null,
    },
    templates: {
      presets: PRESET_TEMPLATES,
      custom: [],
    },
    isStarterOrAbove,
    backendUrlInfo,
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
        const platform = config.platform as SupportedPlatform;
        if (!SUPPORTED_PLATFORMS.includes(platform)) {
          return json({
            success: false,
            error: `平台 ${config.platform} 尚未在 v1 支持，请仅选择 GA4、Meta 或 TikTok。`,
          }, { status: 400 });
        }
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
            serverSideEnabled: false,
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
            serverSideEnabled: false,
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
                const planId = normalizePlanId(shop.plan ?? "free");
        const isAgency = isPlanAtLeast(planId, "agency");
        const firstPlatform = createdPlatforms[0];
                let riskScore: number | undefined;
        let assetCount: number | undefined;
        try {
          const latestScan = await prisma.scanReport.findFirst({
            where: { shopId: shop.id },
            orderBy: { createdAt: "desc" },
            select: { riskScore: true },
          });
          if (latestScan) {
            riskScore = latestScan.riskScore;
            const assets = await prisma.auditAsset.count({
              where: { shopId: shop.id },
            });
            assetCount = assets;
          }
        } catch {
          // no-op: ignore errors when counting assets
        }
        safeFireAndForget(
          trackEvent({
            shopId: shop.id,
            shopDomain: shop.shopDomain,
            event: "cfg_pixel_created",
            metadata: {
              count: createdPlatforms.length,
              platforms: createdPlatforms,
                            plan: shop.plan ?? "free",
              role: isAgency ? "agency" : "merchant",
              destination_type: firstPlatform,
              environment: "test",
              risk_score: riskScore,
              asset_count: assetCount,
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
  const loaderData = useLoaderData<typeof loader>();
  const { shop, templates, isStarterOrAbove, backendUrlInfo } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToastContext();
  
  useEffect(() => {
    if (backendUrlInfo.placeholderDetected) {
      showError("检测到占位符：BACKEND_URL 未在构建时替换，像素扩展将无法工作");
    }
  }, [backendUrlInfo.placeholderDetected, showError]);
  const [currentStep, setCurrentStep] = useState<SetupStep>("select");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<SupportedPlatform>>(new Set());
  const [platformConfigs, setPlatformConfigs] = useState<Partial<Record<SupportedPlatform, PlatformConfig>>>(() => ({
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
  }));
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const steps = useMemo(() => ([
    { id: "select", label: "选择平台" },
    { id: "credentials", label: "填写凭证" },
    { id: "mappings", label: "事件映射" },
    { id: "review", label: "检查配置" },
  ]), []);
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      const configIds = ("configIds" in actionData ? actionData.configIds : []) || [];
      showSuccess("配置已保存，进入测试页面...");
      if (configIds.length === 1) {
        navigate(`/app/pixels/${configIds[0]}/test`);
      } else {
        navigate("/app/pixels");
      }
    } else if (actionData && "error" in actionData && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, navigate, showSuccess, showError]);
  const handlePlatformToggle = useCallback((platform: SupportedPlatform, enabled: boolean) => {
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
    const platforms = new Set<SupportedPlatform>();
    template.platforms.forEach((platform) => {
      if (!SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform)) {
        return;
      }
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
  }, [platformConfigs, showSuccess]);
  const handleCredentialUpdate = useCallback((platform: SupportedPlatform, field: string, value: string) => {
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
  const handleEventMappingUpdate = useCallback((platform: SupportedPlatform, shopifyEvent: string, platformEvent: string) => {
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
  const handleEnvironmentToggle = useCallback((platform: SupportedPlatform, environment: "test" | "live") => {
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
    return [...presetTemplates, ...customTemplates].filter((template) =>
      template && template.platforms && template.platforms.every((platform) =>
        SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform)
      )
    );
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
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ 严重错误：检测到占位符，URL 未在构建时替换
              </Text>
              <Text as="p" variant="bodySm">
                <strong>像素扩展配置中仍包含 __BACKEND_URL_PLACEHOLDER__，这表明构建流程未正确替换占位符。</strong>如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                修复步骤（必须在生产环境部署前完成）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在 CI/CD 流程中，部署前必须运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    验证扩展构建产物中不再包含占位符
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    禁止直接使用 <code>shopify app deploy</code>，必须使用 <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ BACKEND_URL 已正确配置
              </Text>
              <Text as="p" variant="bodySm">
                扩展的 BACKEND_URL 已正确注入。生产环境部署时，请确保始终使用 <code>pnpm deploy:ext</code> 命令，该命令会自动执行 <code>pnpm ext:inject</code> 注入 BACKEND_URL。禁止直接使用 <code>shopify app deploy</code>。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                重要：扩展的 BACKEND_URL 注入是生命线
              </Text>
              <Text as="p" variant="bodySm">
                如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。请在 CI/CD 流程中确保运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>。
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="headingSm" fontWeight="bold">
              ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
            </Text>
            <Text as="p" variant="bodySm">
              Web Pixel Extension 运行在 strict sandbox (Web Worker) 环境中，这是 Shopify 平台的设计限制。以下能力受限：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法访问 DOM 元素、localStorage、sessionStorage、第三方 cookie 等浏览器 API
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  部分事件字段可能为 null 或 undefined（如 buyer.email、buyer.phone、deliveryAddress、shippingAddress、billingAddress 等），这是平台限制，不是故障
                </Text>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    <strong>v1.0 不支持的事件类型（App Review 重要说明）：</strong>
                  </Text>
                  <Text as="span" variant="bodySm">
                    以下事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        退款事件（refund）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单取消（order_cancelled）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单编辑（order_edited）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单创建（subscription_created）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单更新（subscription_updated）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单取消（subscription_cancelled）
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    这些事件将在 v1.1+ 版本中通过订单 webhooks 实现。
                  </Text>
                  <Text as="span" variant="bodySm">
                    在 App Review 时，请向 Shopify 说明这些限制是平台设计（strict sandbox 运行在 Web Worker 环境中，无法访问订单生命周期事件），不是应用缺陷。
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              App Review 说明要点：
            </Text>
            <Text as="p" variant="bodySm">
              这是 Shopify 平台的设计限制，不是应用故障。验收报告中会自动标注所有因 strict sandbox 限制而无法获取的字段和事件。在 App Review 时，请向 Shopify 说明：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  Web Pixel Extension 运行在 strict sandbox (Web Worker) 环境中，这是 Shopify 平台的设计
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  退款、取消、编辑订单、订阅等事件需要订单 webhooks 才能获取，将在 v1.1+ 版本中实现
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  部分字段（如 buyer.email、buyer.phone、deliveryAddress 等）可能为 null，这是平台限制，不是故障
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
        <PageIntroCard
          title="配置流程概览"
          description="使用模板快速完成平台配置，先在 Test 环境验证，再切换 Live。"
          items={[
            "模板包含常用事件映射",
            "凭据支持加密存储",
            "验证通过后再切 Live",
          ]}
          primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
        />
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
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    v1 支持平台：
                  </Text>
                  <Text as="p" variant="bodySm">
                    v1 版本仅支持 GA4、Meta、TikTok 三个平台。其他平台（Pinterest、Snapchat、Twitter 等）将在 v1.1+ 版本支持。
                  </Text>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                {SUPPORTED_PLATFORMS.map((platform) => {
                  const info = PLATFORM_INFO[platform];
                  const isSelected = selectedPlatforms.has(platform);
                  return (
                    <Card key={platform}>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="300" blockAlign="center">
                            <Text as="span" variant="headingLg">{info.icon}</Text>
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" fontWeight="semibold">{info.name}</Text>
                                <Badge tone="success" size="small">v1 支持</Badge>
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {info.description}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <Checkbox
                            checked={isSelected}
                            onChange={(checked) => {
                              handlePlatformToggle(platform, checked);
                            }}
                            label=""
                          />
                        </InlineStack>
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
              {Array.from(selectedPlatforms).some(p => p === "meta" || p === "tiktok") && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>⚠️ 营销平台 Consent 要求：</strong>
                    </Text>
                    <Text as="p" variant="bodySm">
                      您选择了营销平台（Meta 或 TikTok）。这些平台需要客户授予 <strong>marketing consent</strong>，且在客户明确拒绝 <strong>sale of data consent</strong> 时不发送事件。
                      <br />
                      <br />
                      • <strong>Pixel 加载：</strong>只需要 analytics consent（Pixel 即可加载）
                      <br />
                      • <strong>事件发送：</strong>需要 marketing consent，且在 sale of data consent 明确拒绝时不发送到营销平台
                      <br />
                      • <strong>服务端追踪：</strong>v1.0 版本中，服务端转化追踪（Server-side CAPI/MP）默认关闭。默认情况下，我们仅使用客户端 Web Pixel 追踪。如需启用服务端追踪，请在设置页面配置。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      请确保您的店铺已正确配置 Customer Privacy API。在客户未授予 marketing consent 时，事件将被跳过，不会发送到营销平台。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
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
              <Banner tone="warning">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问 DOM 元素
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法使用 localStorage/sessionStorage
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问第三方 cookie
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法执行某些浏览器 API
                      </Text>
                    </List.Item>
                  </List>
                  <Divider />
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    v1.0 支持的事件类型：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ checkout_started（开始结账）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ checkout_completed（完成购买）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ checkout_contact_info_submitted（提交联系信息）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ checkout_shipping_info_submitted（提交配送信息）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ payment_info_submitted（提交支付信息）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ product_added_to_cart（加入购物车）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ product_viewed（商品浏览）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        ✅ page_viewed（页面浏览）
                      </Text>
                    </List.Item>
                  </List>
                  <Divider />
                  <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
                    ❌ v1.0 不支持的事件类型（需要通过订单 webhooks 获取）：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        refund（退款）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        order_cancelled（订单取消）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        order_edited（订单编辑）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        subscription_updated（订阅更新）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        subscription_cancelled（订阅取消）
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 原因：Web Pixel Extension 运行在 strict sandbox 环境，只能订阅 Shopify 标准 checkout 漏斗事件。退款、取消、编辑订单、订阅等事件需要订单 webhooks 或后台定时对账才能获取，将在 v1.1+ 版本中通过订单 webhooks 实现（严格做 PII 最小化）。
                  </Text>
                </BlockStack>
              </Banner>
              {Array.from(selectedPlatforms).map((platform) => {
                const config = platformConfigs[platform];
                if (!config) return null;
                return (
                  <EventMappingEditor
                    key={platform}
                    platform={platform as "google" | "meta" | "tiktok"}
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
              {backendUrlInfo?.placeholderDetected && (
                <Banner tone="critical">
                  <BlockStack gap="300">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      ⚠️ 严重错误：检测到占位符，URL 未在构建时替换
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>像素扩展配置中仍包含 __BACKEND_URL_PLACEHOLDER__，这表明构建流程未正确替换占位符。</strong>如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
                    </Text>
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      修复步骤（必须在生产环境部署前完成）：
                    </Text>
                    <List type="number">
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          在 CI/CD 流程中，部署前必须运行 <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          验证扩展构建产物中不再包含占位符
                        </Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" variant="bodySm">
                          确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置
                        </Text>
                      </List.Item>
                    </List>
                    <Text as="p" variant="bodySm" tone="subdued">
                      💡 提示：如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      ✅ BACKEND_URL 已正确配置
                    </Text>
                    <Text as="p" variant="bodySm">
                      扩展的 BACKEND_URL 已正确注入。生产环境部署时，请确保始终使用 <code>pnpm deploy:ext</code> 命令，该命令会自动执行 <code>pnpm ext:inject</code> 注入 BACKEND_URL。禁止直接使用 <code>shopify app deploy</code>。
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>重要：扩展的 BACKEND_URL 注入是生命线。</strong>如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel 运行在 strict sandbox (Web Worker) 环境中，以下能力受限：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        无法访问 DOM 元素、localStorage、第三方 cookie 等
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        部分事件字段可能为 null 或 undefined（如 buyer.email、buyer.phone、deliveryAddress、shippingAddress、billingAddress 等），这是平台限制，不是故障
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>v1.0 不支持的事件类型：</strong>退款（refund）、订单取消（order_cancelled）、订单编辑（order_edited）、订阅订单（subscription_created、subscription_updated、subscription_cancelled）等事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取。这些事件将在 v1.1+ 版本中通过订单 webhooks 实现
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 提示：这是 Shopify 平台的设计限制，不是应用故障。验收报告中会自动标注所有因 strict sandbox 限制而无法获取的字段和事件。在 App Review 时，请向 Shopify 说明这些限制是平台设计，不是应用缺陷。
                  </Text>
                </BlockStack>
              </Banner>
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
            {availableTemplates.map((template) => {
              if (!template) return null;
              return (
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
              );
            })}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
