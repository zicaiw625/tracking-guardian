import type { WizardTemplate } from "~/components/migrate/PixelMigrationWizard";

export const SUPPORTED_PLATFORMS = ["google", "meta", "tiktok"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export type SetupStep = "select" | "mappings" | "credentials" | "review";

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
    description: "Used for standard Web Pixel event mapping",
    credentialFields: [
      {
        key: "measurementId",
        label: "Measurement ID",
        placeholder: "G-XXXXXXXXXX",
        type: "text",
        helpText: "Find this in GA4 Admin under Data Streams",
      },
      {
        key: "apiSecret",
        label: "API Secret",
        placeholder: "",
        type: "password",
        helpText: "Create this in GA4 Data Stream > Measurement Protocol API secrets",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    description: "Used for standard Web Pixel event mapping",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "123456789012345",
        type: "text",
        helpText: "Find this in Meta Events Manager",
      },
      {
        key: "accessToken",
        label: "Access Token",
        placeholder: "",
        type: "password",
        helpText: "Generate a system user access token in Meta Events Manager",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    description: "Used for standard Web Pixel event mapping",
    credentialFields: [
      {
        key: "pixelId",
        label: "Pixel ID",
        placeholder: "C1234567890ABCDEF",
        type: "text",
        helpText: "Find this in TikTok Events Manager",
      },
      {
        key: "accessToken",
        label: "Access Token",
        placeholder: "",
        type: "password",
        helpText: "Generate this in TikTok Events Manager",
      },
    ],
  },
};

export const PRESET_TEMPLATES: WizardTemplate[] = [
  {
    id: "standard",
    name: "Standard Configuration (v1)",
    description: "Standard event mapping for most ecommerce stores (GA4/Meta/TikTok)",
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
    name: "Advanced Configuration (v1.1+)",
    description: "Full mapping with more event types (v1.1+ will support Pinterest/Snapchat)",
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
  { id: "select" as const, label: "Select Platforms" },
  { id: "mappings" as const, label: "Event Mappings" },
  { id: "credentials" as const, label: "Platform Credentials" },
  { id: "review" as const, label: "Review Configuration" },
];
