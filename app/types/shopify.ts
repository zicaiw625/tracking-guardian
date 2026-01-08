import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface WebhookRegisterResult {
  success: boolean;
  result: {
    message?: string;
    [key: string]: unknown;
  };
}

export type WebhookRegisterResults = Record<string, WebhookRegisterResult[]>;

export interface WebhookSubscriptionEdge {
  node: {
    id: string;
    topic: string;
  };
  cursor: string;
}

export interface WebhookSubscriptionsQueryResponse {
  data?: {
    webhookSubscriptions?: {
      edges?: WebhookSubscriptionEdge[];
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

export interface WebhookDeleteMutationResponse {
  data?: {
    webhookSubscriptionDelete?: {
      deletedWebhookSubscriptionId?: string;
      userErrors?: Array<{
        field?: string;
        message?: string;
      }>;
    };
  };
}

export interface ShopQueryResponse {
  data?: {
    shop?: {
      primaryDomain?: {
        host?: string;
      };
      plan?: {
        displayName?: string;
        partnerDevelopment?: boolean;
        shopifyPlus?: boolean;
      };
      checkoutApiSupported?: boolean;
    };
  };
  errors?: Array<{ message?: string }>;
}

export type ShopTierValue = "plus" | "non_plus" | "unknown";

export interface GraphQLResponse<T = unknown> {
  json: () => Promise<T>;
}

export interface SimpleGraphQLClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> }
  ): Promise<GraphQLResponse>;
}

export type NullableAdminContext = AdminApiContext | null;

export interface ShopifySessionData {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope?: string | null;
  expires?: Date | null;
  accessToken: string;
  userId?: bigint | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  accountOwner?: boolean;
  locale?: string | null;
  collaborator?: boolean | null;
  emailVerified?: boolean | null;
}

export interface WebPixelCreateResponse {
  data?: {
    webPixelCreate?: {
      webPixel?: {
        id: string;
      };
      userErrors?: Array<{
        field?: string[];
        message?: string;
      }>;
    };
  };
}

export interface WebPixelUpdateResponse {
  data?: {
    webPixelUpdate?: {
      webPixel?: {
        id: string;
      };
      userErrors?: Array<{
        field?: string[];
        message?: string;
      }>;
    };
  };
}

export interface WebPixelDeleteResponse {
  data?: {
    webPixelDelete?: {
      deletedWebPixelId?: string;
      userErrors?: Array<{
        field?: string[];
        message?: string;
      }>;
    };
  };
}

export interface CheckoutProfilesQueryResponse {
  data?: {
    checkoutProfiles?: {
      nodes?: Array<{
        id: string;
        name?: string;
        isPublished?: boolean;
        thankYouPageHasOrderStatusExtension?: boolean;
        orderStatusPageHasOrderStatusExtension?: boolean;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
}

export interface ScriptTagData {
  id: string;
  src: string;
  display_scope?: string;
  event?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ScriptTagsQueryResponse {
  data?: {
    scriptTags?: {
      edges?: Array<{
        node: ScriptTagData;
      }>;
    };
  };
}

export interface ShopifyAddress {
  first_name?: string | null;
  last_name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  zip?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
}

export interface ShopifyCustomer {
  id?: number;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  default_address?: ShopifyAddress | null;
}

export interface ShopifyLineItem {
  id?: number;
  product_id?: number | null;
  variant_id?: number | null;
  title?: string;
  name?: string;
  sku?: string | null;
  quantity?: number;
  price?: string;
  grams?: number;
  vendor?: string | null;
  properties?: Array<{
    name: string;
    value: unknown;
  }>;
}

export interface ShopifyMoneySet {
  shop_money?: {
    amount: string;
    currency_code?: string;
  };
  presentment_money?: {
    amount: string;
    currency_code?: string;
  };
}

export interface ShopifyOrder {
  id: number;
  order_number?: number | null;
  name?: string;
  checkout_token?: string | null;
  total_price?: string;
  subtotal_price?: string;
  total_tax?: string;
  total_discounts?: string;
  currency?: string;
  total_shipping_price_set?: ShopifyMoneySet | null;
  financial_status?: string;
  fulfillment_status?: string | null;
  email?: string | null;
  phone?: string | null;
  customer?: ShopifyCustomer | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[];
  created_at?: string;
  updated_at?: string;
  processed_at?: string;
  closed_at?: string | null;
  cancelled_at?: string | null;
  note?: string | null;
  tags?: string;
  test?: boolean;
  gateway?: string | null;
  confirmed?: boolean;
  source_name?: string;
  browser_ip?: string | null;
  landing_site?: string | null;
  referring_site?: string | null;
  discount_codes?: Array<{
    code: string;
    amount: string;
    type: string;
  }>;
}

export function isShopTierValue(value: unknown): value is ShopTierValue {
  return value === "plus" || value === "non_plus" || value === "unknown";
}

export function hasGraphQLErrors(
  response: { errors?: Array<{ message?: string }> } | undefined
): boolean {
  return !!(response?.errors && response.errors.length > 0);
}

export function extractGraphQLErrors(
  response: { errors?: Array<{ message?: string }> } | undefined
): string[] {
  if (!response?.errors) return [];
  return response.errors
    .map((e) => e.message)
    .filter((m): m is string => typeof m === "string");
}
