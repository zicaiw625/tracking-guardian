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
    description: "Used for event mapping and verification (server-side delivery is planned)",
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
        placeholder: "Enter API Secret",
        type: "password",
        helpText: "Create this in GA4 Admin > Data Streams > Measurement Protocol API secrets",
      },
    ],
  },
  meta: {
    name: "Meta (Facebook) Pixel",
    icon: "📘",
    description: "Used for event mapping and verification (server-side delivery is planned)",
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
        placeholder: "Enter Access Token",
        type: "password",
        helpText: "Generate this in Meta Events Manager > Settings > Conversions API",
      },
      {
        key: "testEventCode",
        label: "Test Event Code (optional)",
        placeholder: "TEST12345",
        type: "text",
        helpText: "Used for test mode; available in Events Manager",
      },
    ],
  },
  tiktok: {
    name: "TikTok Pixel",
    icon: "🎵",
    description: "Used for event mapping and verification (server-side delivery is planned)",
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
        placeholder: "Enter Access Token",
        type: "password",
        helpText: "Generate this in TikTok Events Manager > Settings > Web Events",
      },
    ],
  },
};

export const PRESET_TEMPLATES = [
  {
    id: "standard",
    name: "Standard Configuration (v1)",
    description: "Standard event mapping for most ecommerce stores (GA4/Meta/TikTok)",
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
  },
];
