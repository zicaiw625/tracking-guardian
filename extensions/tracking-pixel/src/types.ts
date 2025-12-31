

export interface CheckoutData {
  order?: {
    id?: string;
  };
  token?: string;
  totalPrice?: {
    amount?: string | number;
  };
  totalTax?: {
    amount?: string | number;
  };
  shippingLine?: {
    price?: {
      amount?: string | number;
    };
  };
  currencyCode?: string;
  lineItems?: Array<{
    id?: string;
    title?: string;
    quantity?: number;
    variant?: {
      price?: {
        amount?: string | number;
      };
    };
  }>;
}

export interface CustomerPrivacyState {
  analyticsProcessingAllowed: boolean;
  marketingAllowed: boolean;
  preferencesProcessingAllowed: boolean;
  saleOfDataAllowed: boolean;
}

export interface VisitorConsentCollectedEvent {
  customerPrivacy: CustomerPrivacyState;
}

export interface CartLine {
  merchandise?: {
    product?: {
      id?: string;
      title?: string;
    };
    price?: {
      amount?: string | number;
    };
  };
  quantity?: number;
}

export interface PixelConfig {

  schema_version: "1";

  mode: "purchase_only" | "full_funnel";

  enabled_platforms: string;

  strictness: "strict" | "balanced";
}

export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }

  try {
    const parsed = JSON.parse(configStr);

    if (parsed.schema_version !== "1") {
      // 生产环境不输出 console，避免在 Shopify 像素沙箱中产生大量日志
      // 只在明确的开发环境（通过 shopDomain 判断）才输出警告
      // 注意：Web Pixel 运行在沙箱中，process.env 可能不可用
      return DEFAULT_PIXEL_CONFIG;
    }

    const mode = parsed.mode === "full_funnel" ? "full_funnel" : "purchase_only";
    const enabled_platforms = typeof parsed.enabled_platforms === "string"
      ? parsed.enabled_platforms
      : DEFAULT_PIXEL_CONFIG.enabled_platforms;
    const strictness = parsed.strictness === "balanced" ? "balanced" : "strict";

    return {
      schema_version: "1",
      mode,
      enabled_platforms,
      strictness,
    };
  } catch (e) {
    // 生产环境不输出 console，避免在 Shopify 像素沙箱中产生大量日志
    // 配置解析失败时静默使用默认配置
    return DEFAULT_PIXEL_CONFIG;
  }
}

export interface PixelSettings {
  ingestion_key?: string;
  shop_domain?: string;

  pixel_config?: string;
}

export interface PixelInit {
  data?: {
    shop?: {
      myshopifyDomain?: string;
    };
  };
  customerPrivacy?: CustomerPrivacyState;
}

