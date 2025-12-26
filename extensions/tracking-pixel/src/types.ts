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
 * P1-3: Pixel configuration structure (stored as JSON string in pixel_config field)
 * 
 * IMPORTANT: This schema MUST be kept in sync with app/schemas/settings.ts
 * The backend uses Zod for validation; this is the client-side equivalent.
 * 
 * Schema version is explicit to support future migrations without breaking
 * existing deployments.
 */
export interface PixelConfig {
  /** Schema version for forward compatibility. Must match backend. */
  schema_version: "1";
  /** Event tracking mode: purchase_only = checkout_completed only */
  mode: "purchase_only" | "full_funnel";
  /** Enabled platforms (comma-separated: "meta,tiktok,google") */
  enabled_platforms: string;
  /** Consent strictness level */
  strictness: "strict" | "balanced";
}

/**
 * P1-3: Default pixel configuration
 * 
 * IMPORTANT: Must match DEFAULT_PIXEL_CONFIG in app/schemas/settings.ts
 */
export const DEFAULT_PIXEL_CONFIG: PixelConfig = {
  schema_version: "1",
  mode: "purchase_only",
  enabled_platforms: "meta,tiktok,google",
  strictness: "strict",
};

/**
 * P1-3: Parse and validate pixel_config JSON string
 * 
 * This function mirrors parseAndValidatePixelConfig from app/schemas/settings.ts
 * but runs in the browser/worker context without Zod dependency.
 * 
 * Returns validated config or defaults on parse/validation failure.
 * Never throws - uses fail-closed strategy.
 */
export function parsePixelConfig(configStr?: string): PixelConfig {
  if (!configStr) {
    return DEFAULT_PIXEL_CONFIG;
  }
  
  try {
    const parsed = JSON.parse(configStr);
    
    // Validate schema version - fail closed on unknown versions
    if (parsed.schema_version !== "1") {
      console.warn("[PixelConfig] Unknown schema version, using defaults:", parsed.schema_version);
      return DEFAULT_PIXEL_CONFIG;
    }
    
    // Validate and normalize each field
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

