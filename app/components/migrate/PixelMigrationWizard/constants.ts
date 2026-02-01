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
}>> = {
  google: {
    name: "Google Analytics 4",
    icon: "🔵",
    description: "pixelMigration.platforms.google.description",
    credentialFields: [
      {
        key: "measurementId",
        label: "pixelMigration.platforms.google.fields.measurementId.label",
        placeholder: "G-XXXXXXXXXX",
        type: "text",
        helpText: "pixelMigration.platforms.google.fields.measurementId.helpText",
      },
      {
        key: "apiSecret",
        label: "pixelMigration.platforms.google.fields.apiSecret.label",
        placeholder: "pixelMigration.platforms.google.fields.apiSecret.placeholder",
        type: "password",
        helpText: "pixelMigration.platforms.google.fields.apiSecret.helpText",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    description: "pixelMigration.platforms.meta.description",
    credentialFields: [
      {
        key: "pixelId",
        label: "pixelMigration.platforms.meta.fields.pixelId.label",
        placeholder: "123456789012345",
        type: "text",
        helpText: "pixelMigration.platforms.meta.fields.pixelId.helpText",
      },
      {
        key: "accessToken",
        label: "pixelMigration.platforms.meta.fields.accessToken.label",
        placeholder: "pixelMigration.platforms.meta.fields.accessToken.placeholder",
        type: "password",
        helpText: "pixelMigration.platforms.meta.fields.accessToken.helpText",
      },
      {
        key: "testEventCode",
        label: "pixelMigration.platforms.meta.fields.testEventCode.label",
        placeholder: "TEST12345",
        type: "text",
        helpText: "pixelMigration.platforms.meta.fields.testEventCode.helpText",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    description: "pixelMigration.platforms.tiktok.description",
    credentialFields: [
      {
        key: "pixelId",
        label: "pixelMigration.platforms.tiktok.fields.pixelId.label",
        placeholder: "C1234567890ABCDEF",
        type: "text",
        helpText: "pixelMigration.platforms.tiktok.fields.pixelId.helpText",
      },
      {
        key: "accessToken",
        label: "pixelMigration.platforms.tiktok.fields.accessToken.label",
        placeholder: "pixelMigration.platforms.tiktok.fields.accessToken.placeholder",
        type: "password",
        helpText: "pixelMigration.platforms.tiktok.fields.accessToken.helpText",
      },
    ],
  },
};

export const PRESET_TEMPLATES = [
  {
    id: "standard",
    name: "pixelMigration.templates.standard.name",
    description: "pixelMigration.templates.standard.description",
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
  },
];
