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
    descriptionKey: string;
    credentialFields: Array<{
      key: string;
      labelKey: string;
      placeholderKey: string;
      type: "text" | "password";
      helpTextKey?: string;
    }>;
  }
> = {
  google: {
    name: "Google Analytics 4",
    icon: "🔵",
    descriptionKey: "pixelMigration.platforms.google.description",
    credentialFields: [
      {
        key: "measurementId",
        labelKey: "pixelMigration.platforms.google.fields.measurementId.label",
        placeholderKey: "pixelMigration.platforms.google.fields.measurementId.placeholder",
        type: "text",
        helpTextKey: "pixelMigration.platforms.google.fields.measurementId.helpText",
      },
      {
        key: "apiSecret",
        labelKey: "pixelMigration.platforms.google.fields.apiSecret.label",
        placeholderKey: "pixelMigration.platforms.google.fields.apiSecret.placeholder",
        type: "password",
        helpTextKey: "pixelMigration.platforms.google.fields.apiSecret.helpText",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    descriptionKey: "pixelMigration.platforms.meta.description",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "pixelMigration.platforms.meta.fields.pixelId.label",
        placeholderKey: "pixelMigration.platforms.meta.fields.pixelId.placeholder",
        type: "text",
        helpTextKey: "pixelMigration.platforms.meta.fields.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "pixelMigration.platforms.meta.fields.accessToken.label",
        placeholderKey: "pixelMigration.platforms.meta.fields.accessToken.placeholder",
        type: "password",
        helpTextKey: "pixelMigration.platforms.meta.fields.accessToken.helpText",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    descriptionKey: "pixelMigration.platforms.tiktok.description",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "pixelMigration.platforms.tiktok.fields.pixelId.label",
        placeholderKey: "pixelMigration.platforms.tiktok.fields.pixelId.placeholder",
        type: "text",
        helpTextKey: "pixelMigration.platforms.tiktok.fields.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "pixelMigration.platforms.tiktok.fields.accessToken.label",
        placeholderKey: "pixelMigration.platforms.tiktok.fields.accessToken.placeholder",
        type: "password",
        helpTextKey: "pixelMigration.platforms.tiktok.fields.accessToken.helpText",
      },
    ],
  },
};

export const PRESET_TEMPLATES: WizardTemplate[] = [
  {
    id: "standard",
    name: "pixelMigration.templates.standard.name",
    description: "pixelMigration.templates.standard.description",
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
    name: "pixelMigration.templates.advanced.name",
    description: "pixelMigration.templates.advanced.description",
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
  { id: "select" as const, label: "pixelMigration.steps.select" },
  { id: "mappings" as const, label: "pixelMigration.steps.mappings" },
  { id: "credentials" as const, label: "pixelMigration.steps.credentials" },
  { id: "review" as const, label: "pixelMigration.steps.review" },
];
