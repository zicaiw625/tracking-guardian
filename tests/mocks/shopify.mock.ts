import { vi, type Mock } from "vitest";

export interface MockSession {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope?: string;
  expires?: Date;
  accessToken: string;
}

export interface MockAdminContext {
  session: MockSession;
  admin: MockAdminApi;
}

export interface MockAdminApi {
  graphql: Mock;
  rest: MockRestApi;
}

export interface MockRestApi {
  get: Mock;
  post: Mock;
  put: Mock;
  delete: Mock;
}

export interface MockWebhookContext {
  topic: string;
  shop: string;
  payload: unknown;
  webhookId: string | null;
  admin?: MockAdminApi;
}

export function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    id: `offline_test-shop.myshopify.com`,
    shop: "test-shop.myshopify.com",
    state: "mock_state",
    isOnline: false,
    scope: "read_products,write_products",
    accessToken: "mock_access_token",
    ...overrides,
  };
}

export function createMockGraphQLResponse<T>(data: T, errors?: Array<{ message: string }>): {
  json: () => Promise<{ data: T; errors?: Array<{ message: string }> }>;
} {
  return {
    json: () => Promise.resolve({ data, errors }),
  };
}

export function createMockAdminApi(): MockAdminApi {
  const graphql = vi.fn().mockResolvedValue(
    createMockGraphQLResponse({
      shop: {
        primaryDomain: { host: "test-shop.com" },
        plan: { displayName: "Development", shopifyPlus: false },
      },
    })
  );
  return {
    graphql,
    rest: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
}

export function createMockAdminContext(overrides: Partial<MockAdminContext> = {}): MockAdminContext {
  return {
    session: createMockSession(overrides.session),
    admin: overrides.admin || createMockAdminApi(),
  };
}

export function createMockWebhookContext(
  topic: string,
  payload: unknown,
  overrides: Partial<MockWebhookContext> = {}
): MockWebhookContext {
  return {
    topic,
    shop: "test-shop.myshopify.com",
    payload,
    webhookId: `webhook_${Date.now()}`,
    ...overrides,
  };
}

export function createMockOrderPayload(overrides: Partial<MockOrderPayload> = {}): MockOrderPayload {
  return {
    id: 12345678901234,
    order_number: 1001,
    name: "#1001",
    checkout_token: "mock_checkout_token_abc123",
    total_price: "99.99",
    subtotal_price: "89.99",
    total_tax: "5.00",
    total_discounts: "0.00",
    currency: "USD",
    total_shipping_price_set: {
      shop_money: { amount: "5.00", currency_code: "USD" },
      presentment_money: { amount: "5.00", currency_code: "USD" },
    },
    financial_status: "paid",
    fulfillment_status: null,
    email: "customer@example.com",
    phone: "+1234567890",
    customer: {
      id: 987654321,
      email: "customer@example.com",
      phone: "+1234567890",
      first_name: "John",
      last_name: "Doe",
      default_address: {
        first_name: "John",
        last_name: "Doe",
        address1: "123 Main St",
        city: "New York",
        province: "NY",
        province_code: "NY",
        country: "United States",
        country_code: "US",
        zip: "10001",
      },
    },
    billing_address: {
      first_name: "John",
      last_name: "Doe",
      address1: "123 Main St",
      city: "New York",
      province: "NY",
      province_code: "NY",
      country: "United States",
      country_code: "US",
      zip: "10001",
    },
    shipping_address: {
      first_name: "John",
      last_name: "Doe",
      address1: "123 Main St",
      city: "New York",
      province: "NY",
      province_code: "NY",
      country: "United States",
      country_code: "US",
      zip: "10001",
    },
    line_items: [
      {
        id: 111111,
        product_id: 222222,
        variant_id: 333333,
        title: "Test Product",
        name: "Test Product - Small",
        sku: "TEST-001",
        quantity: 1,
        price: "89.99",
      },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    test: false,
    gateway: "shopify_payments",
    confirmed: true,
    source_name: "web",
    ...overrides,
  };
}

export interface MockOrderPayload {
  id: number;
  order_number: number;
  name: string;
  checkout_token: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  total_discounts: string;
  currency: string;
  total_shipping_price_set: {
    shop_money: { amount: string; currency_code: string };
    presentment_money: { amount: string; currency_code: string };
  } | null;
  financial_status: string;
  fulfillment_status: string | null;
  email: string | null;
  phone: string | null;
  customer: {
    id: number;
    email: string | null;
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    default_address: MockAddress | null;
  } | null;
  billing_address: MockAddress | null;
  shipping_address: MockAddress | null;
  line_items: MockLineItem[];
  created_at: string;
  updated_at: string;
  processed_at: string;
  test: boolean;
  gateway: string | null;
  confirmed: boolean;
  source_name: string;
}

export interface MockAddress {
  first_name: string | null;
  last_name: string | null;
  address1: string | null;
  address2?: string | null;
  city: string | null;
  province: string | null;
  province_code: string | null;
  country: string | null;
  country_code: string | null;
  zip: string | null;
  phone?: string | null;
  company?: string | null;
}

export interface MockLineItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  name: string;
  sku: string | null;
  quantity: number;
  price: string;
}

export function createMockGDPRDataRequestPayload(): {
  shop_id: number;
  shop_domain: string;
  customer: { id: number; email: string };
  orders_requested: number[];
} {
  return {
    shop_id: 12345,
    shop_domain: "test-shop.myshopify.com",
    customer: {
      id: 987654321,
      email: "customer@example.com",
    },
    orders_requested: [1001, 1002],
  };
}

export function createMockGDPRCustomerRedactPayload(): {
  shop_id: number;
  shop_domain: string;
  customer: { id: number; email: string };
  orders_to_redact: number[];
} {
  return {
    shop_id: 12345,
    shop_domain: "test-shop.myshopify.com",
    customer: {
      id: 987654321,
      email: "customer@example.com",
    },
    orders_to_redact: [1001, 1002],
  };
}

export function createMockGDPRShopRedactPayload(): {
  shop_id: number;
  shop_domain: string;
} {
  return {
    shop_id: 12345,
    shop_domain: "test-shop.myshopify.com",
  };
}

export function createMockShopQueryResponse(options: {
  shopifyPlus?: boolean;
  primaryDomain?: string;
} = {}): ReturnType<typeof createMockGraphQLResponse> {
  return createMockGraphQLResponse({
    shop: {
      primaryDomain: { host: options.primaryDomain || "test-shop.com" },
      plan: {
        displayName: options.shopifyPlus ? "Shopify Plus" : "Development",
        shopifyPlus: options.shopifyPlus || false,
        partnerDevelopment: !options.shopifyPlus,
      },
      checkoutApiSupported: true,
    },
  });
}

export function createMockWebhookSubscriptionResponse(
  topics: string[] = []
): ReturnType<typeof createMockGraphQLResponse> {
  return createMockGraphQLResponse({
    webhookSubscriptions: {
      edges: topics.map((topic, i) => ({
        node: {
          id: `gid://shopify/WebhookSubscription/${i + 1}`,
          topic,
        },
        cursor: `cursor_${i}`,
      })),
      pageInfo: {
        hasNextPage: false,
        endCursor: topics.length > 0 ? `cursor_${topics.length - 1}` : null,
      },
    },
  });
}

export function createMockWebPixelCreateResponse(
  success: boolean,
  pixelId?: string
): ReturnType<typeof createMockGraphQLResponse> {
  if (success) {
    return createMockGraphQLResponse({
      webPixelCreate: {
        webPixel: { id: pixelId || "gid://shopify/WebPixel/12345" },
        userErrors: [],
      },
    });
  }
  return createMockGraphQLResponse({
    webPixelCreate: {
      webPixel: null,
      userErrors: [{ field: ["settings"], message: "Invalid settings" }],
    },
  });
}
let mockAuthenticate: {
  admin: Mock;
  webhook: Mock;
  public: { appProxy: Mock };
} | null = null;
export function createMockAuthenticate(): typeof mockAuthenticate {
  mockAuthenticate = {
    admin: vi.fn().mockResolvedValue(createMockAdminContext()),
    webhook: vi.fn().mockImplementation(async (request: Request) => {
      const topic = request.headers.get("X-Shopify-Topic") || "app/uninstalled";
      const shop = request.headers.get("X-Shopify-Shop-Domain") || "test-shop.myshopify.com";
      const payload = await request.json();
      return { topic, shop, payload, admin: createMockAdminApi() };
    }),
    public: {
      appProxy: vi.fn().mockResolvedValue({
        session: null,
      }),
    },
  };
  return mockAuthenticate;
}
export function getMockAuthenticate(): NonNullable<typeof mockAuthenticate> {
  if (!mockAuthenticate) {
    createMockAuthenticate();
  }
  return mockAuthenticate!;
}
export function resetMockAuthenticate(): void {
  if (mockAuthenticate) {
    mockAuthenticate.admin.mockReset();
    mockAuthenticate.webhook.mockReset();
    mockAuthenticate.public.appProxy.mockReset();
  }
}
