/**
 * Type definitions for the Web Pixel extension.
 */

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

/**
 * P1-5: Pixel configuration structure (stored as JSON string in pixel_config field)
 * 
 * This allows runtime behavior changes without redeploying the pixel extension.
 */
export interface PixelConfig {
  /** Schema version for forward compatibility */
  schema_version: "1";
  /** Event tracking mode */
  mode: "purchase_only" | "full_funnel";
  /** Enabled platforms (comma-separated: "meta,tiktok,ga4") */
  enabled_platforms: string;
  /** Consent strictness level */
  strictness: "strict" | "balanced";
}

/**
 * Default pixel configuration
 */
export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

/**
 * Parse pixel_config JSON string with fallback to defaults
 */
export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }
  
  try {
    const parsed = JSON.parse(configStr);
    
    // Validate schema version
    if (parsed.schema_version !== "1") {
      console.warn("[PixelConfig] Unknown schema version, using defaults");
      return DEFAULT_PIXEL_CONFIG;
    }
    
    return {
      schema_version: "1",
      mode: parsed.mode === "full_funnel" ? "full_funnel" : "purchase_only",
      enabled_platforms: typeof parsed.enabled_platforms === "string" 
        ? parsed.enabled_platforms 
        : DEFAULT_PIXEL_CONFIG.enabled_platforms,
      strictness: parsed.strictness === "balanced" ? "balanced" : "strict",
    };
  } catch (e) {
    console.warn("[PixelConfig] Failed to parse config, using defaults:", e);
    return DEFAULT_PIXEL_CONFIG;
  }
}

/**
 * Settings passed from Shopify pixel configuration.
 * 
 * P0-01/P0-02: These fields MUST exactly match shopify.extension.toml [settings.fields.*] keys.
 * Only include fields declared in the toml schema.
 * 
 * P1-5: Added pixel_config for runtime behavior configuration.
 * 
 * Note: backend_url is NOT in settings - it's a build-time constant (BACKEND_URL).
 */
export interface PixelSettings {
  ingestion_key?: string;
  shop_domain?: string;
  /** P1-5: JSON string containing PixelConfig */
  pixel_config?: string;
}

/**
 * Init data from Shopify.
 */
export interface PixelInit {
  data?: {
    shop?: {
      myshopifyDomain?: string;
    };
  };
  customerPrivacy?: CustomerPrivacyState;
}

