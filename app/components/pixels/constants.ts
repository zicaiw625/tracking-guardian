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
    nameKey: string;
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
    nameKey: "platforms.google",
    icon: "🔵",
    descriptionKey: "newPixelWizard.platforms.google.description",
    credentialFields: [
      {
        key: "measurementId",
        labelKey: "newPixelWizard.credentials.google.measurementId.label",
        placeholderKey: "newPixelWizard.credentials.google.measurementId.placeholder",
        type: "text",
        helpTextKey: "newPixelWizard.credentials.google.measurementId.helpText",
      },
      {
        key: "apiSecret",
        labelKey: "newPixelWizard.credentials.google.apiSecret.label",
        placeholderKey: "newPixelWizard.credentials.google.apiSecret.placeholder",
        type: "password",
        helpTextKey: "newPixelWizard.credentials.google.apiSecret.helpText",
      },
    ],
  },
  meta: {
    nameKey: "platforms.meta",
    icon: "📘",
    descriptionKey: "newPixelWizard.platforms.meta.description",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "newPixelWizard.credentials.meta.pixelId.label",
        placeholderKey: "newPixelWizard.credentials.meta.pixelId.placeholder",
        type: "text",
        helpTextKey: "newPixelWizard.credentials.meta.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "newPixelWizard.credentials.meta.accessToken.label",
        placeholderKey: "newPixelWizard.credentials.meta.accessToken.placeholder",
        type: "password",
        helpTextKey: "newPixelWizard.credentials.meta.accessToken.helpText",
      },
    ],
  },
  tiktok: {
    nameKey: "platforms.tiktok",
    icon: "🎵",
    descriptionKey: "newPixelWizard.platforms.tiktok.description",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "newPixelWizard.credentials.tiktok.pixelId.label",
        placeholderKey: "newPixelWizard.credentials.tiktok.pixelId.placeholder",
        type: "text",
        helpTextKey: "newPixelWizard.credentials.tiktok.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "newPixelWizard.credentials.tiktok.accessToken.label",
        placeholderKey: "newPixelWizard.credentials.tiktok.accessToken.placeholder",
        type: "password",
        helpTextKey: "newPixelWizard.credentials.tiktok.accessToken.helpText",
      },
    ],
  },
};

export const PRESET_TEMPLATES: WizardTemplate[] = [
  {
    id: "standard",
    name: "newPixelWizard.templates.presets.standard.name",
    description: "newPixelWizard.templates.presets.standard.description",
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
    name: "newPixelWizard.templates.presets.advanced.name",
    description: "newPixelWizard.templates.presets.advanced.description",
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
  { id: "select" as const, label: "newPixelWizard.steps.select" },
  { id: "mappings" as const, label: "newPixelWizard.steps.mappings" },
  { id: "credentials" as const, label: "newPixelWizard.steps.credentials" },
  { id: "review" as const, label: "newPixelWizard.steps.review" },
];
