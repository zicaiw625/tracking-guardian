import type { WizardTemplate } from "~/components/migrate/PixelMigrationWizard";

export const SUPPORTED_PLATFORMS = ["google", "meta", "tiktok"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export type SetupStep = "select" | "mappings" | "review";

export interface PlatformConfig {
  platform: SupportedPlatform;
  enabled: boolean;
  platformId: string;
  credentials: Record<string, string>;
  eventMappings: Record<string, string>;
  environment: "test" | "live";
}

export const DEFAULT_EVENT_MAPPINGS: Record<SupportedPlatform, Record<string, string>> = {
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

export const PLATFORM_INFO: Record<
  SupportedPlatform,
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
    description: "用于 Web Pixel 标准事件映射",
    credentialFields: [
      {
        key: "measurementId",
        label: "Measurement ID",
        placeholder: "G-XXXXXXXXXX",
        type: "text",
        helpText: "在 GA4 管理后台的「数据流」中查找",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    description: "用于 Web Pixel 标准事件映射",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "123456789012345",
        type: "text",
        helpText: "在 Meta Events Manager 中查找",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    description: "用于 Web Pixel 标准事件映射",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "C1234567890ABCDEF",
        type: "text",
        helpText: "在 TikTok Events Manager 中查找",
      },
    ],
  },
};

export const PRESET_TEMPLATES: WizardTemplate[] = [
  {
    id: "standard",
    name: "标准配置（v1）",
    description: "适用于大多数电商店铺的标准事件映射（GA4/Meta/TikTok）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: { checkout_completed: "purchase" },
      meta: { checkout_completed: "Purchase" },
      tiktok: { checkout_completed: "CompletePayment" },
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

export const PIXEL_SETUP_STEPS = [
  { id: "select" as const, label: "选择平台" },
  { id: "mappings" as const, label: "事件映射" },
  { id: "review" as const, label: "检查配置" },
];
