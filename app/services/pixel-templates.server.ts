
export interface PixelTemplate {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  eventMappings: Record<string, Record<string, string>>;
  defaultCredentials: Record<string, {
    required: string[];
    optional?: string[];
  }>;
}

export const PRESET_TEMPLATES: PixelTemplate[] = [
  {
    id: "ga4-basic",
    name: "GA4 基础配置",
    description: "Google Analytics 4 基础事件追踪",
    platforms: ["google"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        product_added_to_cart: "add_to_cart",
        product_viewed: "view_item",
        checkout_started: "begin_checkout",
        search_submitted: "search",
      },
    },
    defaultCredentials: {
      google: {
        required: ["measurement_id"],
        optional: ["api_secret"],
      },
    },
  },
  {
    id: "meta-basic",
    name: "Meta Pixel 基础配置",
    description: "Meta (Facebook/Instagram) Pixel 基础事件追踪",
    platforms: ["meta"],
    eventMappings: {
      meta: {
        checkout_completed: "Purchase",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
        page_viewed: "PageView",
      },
    },
    defaultCredentials: {
      meta: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
    },
  },
  {
    id: "tiktok-basic",
    name: "TikTok Pixel 基础配置",
    description: "TikTok Pixel 基础事件追踪",
    platforms: ["tiktok"],
    eventMappings: {
      tiktok: {
        checkout_completed: "CompletePayment",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
        page_viewed: "ViewContent",
      },
    },
    defaultCredentials: {
      tiktok: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
    },
  },
  {
    id: "pinterest-basic",
    name: "Pinterest Tag 基础配置",
    description: "Pinterest Tag 基础事件追踪",
    platforms: ["pinterest"],
    eventMappings: {
      pinterest: {
        checkout_completed: "checkout",
        product_added_to_cart: "addtocart",
        product_viewed: "pagevisit",
        checkout_started: "initiatecheckout",
        page_viewed: "pagevisit",
      },
    },
    defaultCredentials: {
      pinterest: {
        required: ["tag_id"],
        optional: ["access_token"],
      },
    },
  },
  {
    id: "snapchat-basic",
    name: "Snapchat Pixel 基础配置",
    description: "Snapchat Pixel 基础事件追踪",
    platforms: ["snapchat"],
    eventMappings: {
      snapchat: {
        checkout_completed: "PURCHASE",
        product_added_to_cart: "ADD_CART",
        product_viewed: "VIEW_CONTENT",
        checkout_started: "START_CHECKOUT",
        page_viewed: "PAGE_VIEW",
      },
    },
    defaultCredentials: {
      snapchat: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
    },
  },
  {
    id: "multi-platform",
    name: "多平台追踪套件",
    description: "包含 GA4、Meta、TikTok 的完整配置",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        product_added_to_cart: "add_to_cart",
        product_viewed: "view_item",
        checkout_started: "begin_checkout",
      },
      meta: {
        checkout_completed: "Purchase",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
      },
    },
    defaultCredentials: {
      google: {
        required: ["measurement_id"],
        optional: ["api_secret"],
      },
      meta: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
      tiktok: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
    },
  },
  {
    id: "all-platforms",
    name: "全平台追踪套件 (v1)",
    description: "包含 GA4、Meta、TikTok 的完整配置（v1.0 支持的所有平台）",
    platforms: ["google", "meta", "tiktok"],
    eventMappings: {
      google: {
        checkout_completed: "purchase",
        product_added_to_cart: "add_to_cart",
        product_viewed: "view_item",
        checkout_started: "begin_checkout",
      },
      meta: {
        checkout_completed: "Purchase",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
      },
      tiktok: {
        checkout_completed: "CompletePayment",
        product_added_to_cart: "AddToCart",
        product_viewed: "ViewContent",
        checkout_started: "InitiateCheckout",
      },
    },
    defaultCredentials: {
      google: {
        required: ["measurement_id"],
        optional: ["api_secret"],
      },
      meta: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
      tiktok: {
        required: ["pixel_id"],
        optional: ["access_token"],
      },
    },
  },
];

const V1_TEMPLATE_IDS = new Set(["ga4-basic", "meta-basic", "tiktok-basic", "multi-platform", "all-platforms"]);

export function getTemplates(): PixelTemplate[] {
  return PRESET_TEMPLATES.filter((t) => V1_TEMPLATE_IDS.has(t.id));
}

export function getTemplateById(id: string): PixelTemplate | null {
  return PRESET_TEMPLATES.find(t => t.id === id) || null;
}

export function getTemplatesByPlatform(platform: string): PixelTemplate[] {
  return PRESET_TEMPLATES.filter((t) => V1_TEMPLATE_IDS.has(t.id) && t.platforms.includes(platform));
}

export function validateTemplateConfig(
  template: PixelTemplate,
  credentials: Record<string, Record<string, string>>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const platform of template.platforms) {
    const platformCreds = credentials[platform];
    if (!platformCreds) {
      errors.push(`缺少 ${platform} 平台的凭证`);
      continue;
    }
    const required = template.defaultCredentials[platform]?.required || [];
    for (const field of required) {
      if (!platformCreds[field] || platformCreds[field].trim() === "") {
        errors.push(`${platform} 平台缺少必需字段: ${field}`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
