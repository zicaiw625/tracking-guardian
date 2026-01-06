

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

  // v1 默认使用 purchase_only（仅收集 checkout_completed），商家可在设置中切换 full_funnel
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

    return DEFAULT_PIXEL_CONFIG;
  }
}

export interface PixelSettings {
  ingestion_key?: string;
  shop_domain?: string;
  config_version?: string; // P1-11: 配置版本号，用于向后兼容
  // P1-11: pixel_config 已移除，不再在 settings 中存储大 JSON
  // 像素端使用默认配置，完整配置由后端根据 shop_domain 提供
  pixel_config?: string; // 保留用于向后兼容，但不再使用
  // P0-4: 默认环境（test 或 live），用于后端按环境过滤配置
  environment?: "test" | "live";
}

export interface PixelInit {
  data?: {
    shop?: {
      myshopifyDomain?: string;
    };
  };
  customerPrivacy?: CustomerPrivacyState;
}
