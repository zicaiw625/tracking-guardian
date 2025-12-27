import { describe, it, expect, vi, beforeEach } from "vitest";
import { action } from "../../app/routes/webhooks";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    webhookLog: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    gDPRJob: {
      create: vi.fn(),
    },
    conversionJob: {
      upsert: vi.fn(),
    },
    conversionLog: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    webhook: vi.fn(),
  },
}));

vi.mock("../../app/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/services/billing.server", () => ({
  checkBillingGate: vi.fn().mockResolvedValue({
    allowed: true,
    usage: { current: 0, limit: 100 }
  }),
  incrementMonthlyUsage: vi.fn(),
}));

vi.mock("../../app/utils/webhook-validation", () => ({
  parseOrderWebhookPayload: vi.fn().mockImplementation((payload) => {
    if (!payload || typeof payload !== "object" || !("id" in payload)) {
      return null;
    }
    return payload;
  }),
  parseGDPRDataRequestPayload: vi.fn().mockReturnValue({
    shop_id: 123456789,
    shop_domain: "test-shop.myshopify.com",
    orders_requested: [1001, 1002],
    customer_id: 987654321,
    data_request_id: 12345,
  }),
  parseGDPRCustomerRedactPayload: vi.fn().mockReturnValue({
    shop_id: 123456789,
    shop_domain: "test-shop.myshopify.com",
    customer_id: 987654321,
    orders_to_redact: [1001, 1002],
  }),
  parseGDPRShopRedactPayload: vi.fn().mockReturnValue({
    shop_id: 123456789,
    shop_domain: "test-shop.myshopify.com",
  }),
}));

import { authenticate } from "../../app/shopify.server";
import prisma from "../../app/db.server";

describe("P0-2: Webhook HMAC Signature Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Invalid HMAC Signature → 401 Unauthorized", () => {
    it("returns 401 when HMAC signature is invalid", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Response("Unauthorized", { status: 401 })
      );

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "invalid-hmac-signature",
        },
        body: JSON.stringify({
          id: 12345,
          email: "test@example.com",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized: Invalid HMAC");
    });

    it("returns 401 when HMAC header is missing", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Response("Unauthorized", { status: 401 })
      );

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
        },
        body: JSON.stringify({
          id: 12345,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
    });

    it("returns 401 when HMAC is forged (tampering attempt)", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Response("Unauthorized", { status: 401 })
      );

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/redact",
          "X-Shopify-Shop-Domain": "attacker-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=",
        },
        body: JSON.stringify({
          shop_domain: "victim-shop.myshopify.com",
          customer: { id: 12345 },
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(401);
      expect(authenticate.webhook).toHaveBeenCalled();
    });
  });

  describe("Valid HMAC Signature → 200 OK", () => {
    it("returns 200 for CUSTOMERS_DATA_REQUEST with valid HMAC", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "CUSTOMERS_DATA_REQUEST",
        shop: "test-shop.myshopify.com",
        session: null,
        admin: null,
        payload: {
          shop_id: 123456789,
          shop_domain: "test-shop.myshopify.com",
          customer: { id: 987654321 },
          orders_requested: [1001, 1002],
          data_request: { id: 12345 },
        },
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
        pixelConfigs: [],
      } as any);

      vi.mocked(prisma.gDPRJob.create).mockResolvedValue({
        id: "gdpr-job-id",
      } as any);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/data_request",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
        },
        body: JSON.stringify({
          shop_domain: "test-shop.myshopify.com",
          customer: { id: 987654321 },
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const text = await response.text();

      expect(["OK", "GDPR data request queued"]).toContain(text);
    });

    it("returns 200 for CUSTOMERS_REDACT with valid HMAC", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "CUSTOMERS_REDACT",
        shop: "test-shop.myshopify.com",
        session: null,
        admin: null,
        payload: {
          shop_id: 123456789,
          shop_domain: "test-shop.myshopify.com",
          customer: { id: 987654321 },
          orders_to_redact: [1001, 1002],
        },
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
        pixelConfigs: [],
      } as any);

      vi.mocked(prisma.gDPRJob.create).mockResolvedValue({
        id: "gdpr-job-id",
      } as any);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "customers/redact",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
        },
        body: JSON.stringify({
          shop_domain: "test-shop.myshopify.com",
          customer: { id: 987654321 },
          orders_to_redact: [1001],
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const text = await response.text();

      expect(["OK", "GDPR customer redact queued"]).toContain(text);
    });

    it("returns 200 for SHOP_REDACT with valid HMAC", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "SHOP_REDACT",
        shop: "test-shop.myshopify.com",
        session: null,
        admin: null,
        payload: {
          shop_id: 123456789,
          shop_domain: "test-shop.myshopify.com",
        },
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: false,
        pixelConfigs: [],
      } as any);

      vi.mocked(prisma.gDPRJob.create).mockResolvedValue({
        id: "gdpr-job-id",
      } as any);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "shop/redact",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
        },
        body: JSON.stringify({
          shop_domain: "test-shop.myshopify.com",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      const text = await response.text();

      expect(["OK", "GDPR shop redact queued"]).toContain(text);
    });
  });

  describe("Malformed Requests", () => {
    it("returns 400 for invalid JSON body", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new SyntaxError("Unexpected token")
      );

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "some-hmac",
        },
        body: "not valid json{{{",
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(400);
    });

    it("returns 500 for unexpected authentication errors", async () => {
      vi.mocked(authenticate.webhook).mockRejectedValue(
        new Error("Unexpected server error")
      );

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "some-hmac",
        },
        body: JSON.stringify({ id: 12345 }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(500);
    });
  });

  describe("Business Webhooks with HMAC", () => {
    it("returns 200 for ORDERS_PAID with valid HMAC and valid shop", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "ORDERS_PAID",
        shop: "test-shop.myshopify.com",
        session: { shop: "test-shop.myshopify.com" },
        admin: { graphql: vi.fn() },
        payload: {
          id: 12345678901234,
          order_number: "1001",
          total_price: "99.99",
          currency: "USD",
          line_items: [],
        },
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
        plan: "starter",
        pixelConfigs: [
          { platform: "meta", isActive: true, serverSideEnabled: true },
        ],
      } as any);

      vi.mocked(prisma.webhookLog.create).mockResolvedValue({
        id: "log-id",
      } as any);

      vi.mocked(prisma.conversionJob.upsert).mockResolvedValue({
        id: "job-id",
      } as any);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
          "X-Shopify-Webhook-Id": "unique-webhook-id-123",
        },
        body: JSON.stringify({
          id: 12345678901234,
          order_number: "1001",
          total_price: "99.99",
          currency: "USD",
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
    });

    it("returns 200 for APP_UNINSTALLED with valid HMAC", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "APP_UNINSTALLED",
        shop: "test-shop.myshopify.com",
        session: { shop: "test-shop.myshopify.com" },
        admin: null,
        payload: {},
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
        pixelConfigs: [],
      } as any);

      vi.mocked(prisma.session.deleteMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.shop.update).mockResolvedValue({} as any);

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "app/uninstalled",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
          "X-Shopify-Webhook-Id": "unique-webhook-id-456",
        },
        body: JSON.stringify({}),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
    });
  });

  describe("Idempotency with Webhook-Id", () => {
    it("returns 200 OK for duplicate webhook (idempotent)", async () => {
      vi.mocked(authenticate.webhook).mockResolvedValue({
        topic: "ORDERS_PAID",
        shop: "test-shop.myshopify.com",
        session: { shop: "test-shop.myshopify.com" },
        admin: { graphql: vi.fn() },
        payload: {
          id: 12345678901234,
          order_number: "1001",
          total_price: "99.99",
          currency: "USD",
        },
      } as any);

      vi.mocked(prisma.shop.findUnique).mockResolvedValue({
        id: "shop-id",
        shopDomain: "test-shop.myshopify.com",
        isActive: true,
        plan: "starter",
        pixelConfigs: [],
      } as any);

      vi.mocked(prisma.webhookLog.create).mockRejectedValue({
        code: "P2002",
        message: "Unique constraint failed",
      });

      const request = new Request("https://example.com/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/paid",
          "X-Shopify-Shop-Domain": "test-shop.myshopify.com",
          "X-Shopify-Hmac-Sha256": "valid-hmac-signature",
          "X-Shopify-Webhook-Id": "duplicate-webhook-id",
        },
        body: JSON.stringify({
          id: 12345678901234,
        }),
      });

      const response = await action({ request, params: {}, context: {} });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("OK");
    });
  });
});

describe("HMAC Validation Implementation", () => {
  it("should call authenticate.webhook for all incoming webhooks", async () => {
    vi.mocked(authenticate.webhook).mockResolvedValue({
      topic: "ORDERS_PAID",
      shop: "test-shop.myshopify.com",
      session: { shop: "test-shop.myshopify.com" },
      admin: { graphql: vi.fn() },
      payload: { id: 123 },
    } as any);

    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      id: "shop-id",
      shopDomain: "test-shop.myshopify.com",
      isActive: true,
      plan: "free",
      pixelConfigs: [],
    } as any);

    const request = new Request("https://example.com/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: 123 }),
    });

    await action({ request, params: {}, context: {} });

    expect(authenticate.webhook).toHaveBeenCalledWith(request);
  });
});
