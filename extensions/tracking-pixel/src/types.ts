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
 * Settings passed from Shopify pixel configuration.
 */
export interface PixelSettings {
  ingestion_key?: string;
  shop_domain?: string;
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

