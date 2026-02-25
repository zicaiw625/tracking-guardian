import type { PlatformType } from "~/types/enums";

export const DEFAULT_EVENT_MAPPINGS: Partial<Record<PlatformType, Record<string, string>>> = {
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

export const PLATFORM_INFO: Partial<Record<PlatformType, {
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
}>> = {
  google: {
    nameKey: "platforms.google",
    icon: "🔵",
    descriptionKey: "pixelWizard.platformDescriptions.google",
    credentialFields: [
      {
        key: "measurementId",
        labelKey: "pixelWizard.credentials.google.measurementId.label",
        placeholderKey: "pixelWizard.credentials.google.measurementId.placeholder",
        type: "text",
        helpTextKey: "pixelWizard.credentials.google.measurementId.helpText",
      },
      {
        key: "apiSecret",
        labelKey: "pixelWizard.credentials.google.apiSecret.label",
        placeholderKey: "pixelWizard.credentials.google.apiSecret.placeholder",
        type: "password",
        helpTextKey: "pixelWizard.credentials.google.apiSecret.helpText",
      },
    ],
  },
  meta: {
    nameKey: "platforms.meta",
    icon: "📘",
    descriptionKey: "pixelWizard.platformDescriptions.meta",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "pixelWizard.credentials.meta.pixelId.label",
        placeholderKey: "pixelWizard.credentials.meta.pixelId.placeholder",
        type: "text",
        helpTextKey: "pixelWizard.credentials.meta.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "pixelWizard.credentials.meta.accessToken.label",
        placeholderKey: "pixelWizard.credentials.meta.accessToken.placeholder",
        type: "password",
        helpTextKey: "pixelWizard.credentials.meta.accessToken.helpText",
      },
      {
        key: "testEventCode",
        labelKey: "pixelWizard.credentials.meta.testEventCode.label",
        placeholderKey: "pixelWizard.credentials.meta.testEventCode.placeholder",
        type: "text",
        helpTextKey: "pixelWizard.credentials.meta.testEventCode.helpText",
      },
    ],
  },
  tiktok: {
    nameKey: "platforms.tiktok",
    icon: "🎵",
    descriptionKey: "pixelWizard.platformDescriptions.tiktok",
    credentialFields: [
      {
        key: "pixelId",
        labelKey: "pixelWizard.credentials.tiktok.pixelId.label",
        placeholderKey: "pixelWizard.credentials.tiktok.pixelId.placeholder",
        type: "text",
        helpTextKey: "pixelWizard.credentials.tiktok.pixelId.helpText",
      },
      {
        key: "accessToken",
        labelKey: "pixelWizard.credentials.tiktok.accessToken.label",
        placeholderKey: "pixelWizard.credentials.tiktok.accessToken.placeholder",
        type: "password",
        helpTextKey: "pixelWizard.credentials.tiktok.accessToken.helpText",
      },
    ],
  },
};

export const PRESET_TEMPLATES = [
  {
    id: "standard",
    name: "pixelWizard.templates.presets.standard.name",
    description: "pixelWizard.templates.presets.standard.description",
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
    name: "pixelWizard.templates.presets.advanced.name",
    description: "pixelWizard.templates.presets.advanced.description",
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
  },
];
