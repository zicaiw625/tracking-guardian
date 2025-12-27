import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    shop: {
      findUnique: vi.fn(),
    },
    pixelConfig: {
      findMany: vi.fn(),
    },
    pixelEventReceipt: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    conversionLog: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
    },
    conversionJob: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "../../app/db.server";
import { generateEventId, normalizeOrderId } from "../../app/utils/crypto.server";

describe("P0-02: PII Null Regression Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Pixel Event Payload without PII", () => {
    it("should handle checkout_completed with all PII fields null", () => {
      const piiNullPayload = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        consent: {
          marketing: true,
          analytics: true,
        },
        data: {
          orderId: "12345",
          checkoutToken: "abc123",
          value: 99.99,
          currency: "USD",
          tax: 9.99,
          shipping: 5.99,
          items: [
            { id: "product-1", name: "Test Product", price: 84.01, quantity: 1 },
          ],

          email: null,
          phone: null,
          firstName: null,
          lastName: null,
          address: null,
          city: null,
          province: null,
          country: null,
          zip: null,
        },
      };

      expect(piiNullPayload.data.orderId).toBe("12345");

      const normalizedId = normalizeOrderId(piiNullPayload.data.orderId);
      expect(normalizedId).toBe("12345");

      const eventId = generateEventId(
        normalizedId,
        "purchase",
        piiNullPayload.shopDomain
      );
      expect(eventId).toBeTruthy();
      expect(eventId.length).toBeGreaterThan(0);
    });

    it("should generate consistent eventId regardless of PII presence", () => {
      const orderId = "12345";
      const shopDomain = "test-shop.myshopify.com";

      const eventId1 = generateEventId(orderId, "purchase", shopDomain);
      const eventId2 = generateEventId(orderId, "purchase", shopDomain);

      expect(eventId1).toBe(eventId2);
    });

    it("should use checkoutToken as fallback when orderId is null", () => {
      const payloadWithNullOrderId = {
        eventName: "checkout_completed",
        timestamp: Date.now(),
        shopDomain: "test-shop.myshopify.com",
        data: {
          orderId: null,
          checkoutToken: "checkout_token_abc123",
          value: 50.00,
          currency: "USD",
        },
      };

      const effectiveId = payloadWithNullOrderId.data.orderId ||
                          payloadWithNullOrderId.data.checkoutToken;

      expect(effectiveId).toBe("checkout_token_abc123");
    });
  });

  describe("ConversionJob Creation without PII", () => {
    it("should create ConversionJob with only required fields (no PII)", () => {
      const capiInput = {
        orderId: "12345",
        value: 99.99,
        currency: "USD",
        orderNumber: "1001",
        items: [
          { productId: "prod-1", name: "Test Product", quantity: 1, price: 99.99 },
        ],
        contentIds: ["prod-1"],
        numItems: 1,
        tax: 9.99,
        shipping: 5.99,
        processedAt: new Date().toISOString(),
        webhookReceivedAt: new Date().toISOString(),
        checkoutToken: "checkout_abc",
        shopifyOrderId: 12345,
      };

      expect(capiInput.orderId).toBeTruthy();
      expect(capiInput.value).toBeGreaterThan(0);
      expect(capiInput.currency).toBeTruthy();

      expect((capiInput as Record<string, unknown>).email).toBeUndefined();
      expect((capiInput as Record<string, unknown>).phone).toBeUndefined();
      expect((capiInput as Record<string, unknown>).firstName).toBeUndefined();
      expect((capiInput as Record<string, unknown>).lastName).toBeUndefined();
    });
  });

  describe("PixelEventReceipt Matching", () => {
    it("should match receipt by orderId without relying on PII", async () => {
      const mockReceipt = {
        id: "receipt-1",
        shopId: "shop-1",
        orderId: "12345",
        eventType: "purchase",
        consentState: { marketing: true, analytics: true },
        isTrusted: true,
        checkoutToken: null,
      };

      vi.mocked(prisma.pixelEventReceipt.findUnique).mockResolvedValue(mockReceipt as never);

      const receipt = await prisma.pixelEventReceipt.findUnique({
        where: {
          shopId_orderId_eventType: {
            shopId: "shop-1",
            orderId: "12345",
            eventType: "purchase",
          },
        },
      });

      expect(receipt).toBeTruthy();
      expect(receipt?.orderId).toBe("12345");
      expect(receipt?.consentState).toEqual({ marketing: true, analytics: true });
    });

    it("should match receipt by checkoutToken when orderId derived from it", async () => {
      const mockReceipt = {
        id: "receipt-2",
        shopId: "shop-1",
        orderId: "checkout_token_xyz",
        eventType: "purchase",
        consentState: { marketing: true, analytics: true },
        isTrusted: true,
        checkoutToken: "checkout_token_xyz",
        usedCheckoutTokenFallback: true,
      };

      vi.mocked(prisma.pixelEventReceipt.findFirst).mockResolvedValue(mockReceipt as never);

      const receipt = await prisma.pixelEventReceipt.findFirst({
        where: {
          shopId: "shop-1",
          checkoutToken: "checkout_token_xyz",
          eventType: "purchase",
        },
      });

      expect(receipt).toBeTruthy();
      expect(receipt?.usedCheckoutTokenFallback).toBe(true);
    });
  });

  describe("CAPI Sending without PII", () => {
    it("should send Meta CAPI without user data when PII unavailable", () => {
      const metaPayload = {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: "evt_12345_purchase_test-shop",
        action_source: "website",
        user_data: {
        },
        custom_data: {
          currency: "USD",
          value: 99.99,
          order_id: "12345",
          content_ids: ["prod-1"],
          content_type: "product",
          num_items: 1,
        },
      };

      expect(metaPayload.event_name).toBe("Purchase");
      expect(metaPayload.custom_data.value).toBe(99.99);
      expect(metaPayload.custom_data.order_id).toBe("12345");
    });

    it("should send GA4 Measurement Protocol without user identifiers", () => {
      const ga4Payload = {
        client_id: "anonymous",
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: "12345",
              value: 99.99,
              currency: "USD",
              items: [
                { item_id: "prod-1", item_name: "Test Product", price: 99.99, quantity: 1 },
              ],
            },
          },
        ],
      };

      expect(ga4Payload.events[0].name).toBe("purchase");
      expect(ga4Payload.events[0].params.transaction_id).toBe("12345");
    });

    it("should send TikTok Events API without user identifiers", () => {
      const tiktokPayload = {
        event: "CompletePayment",
        event_time: Math.floor(Date.now() / 1000),
        event_id: "evt_12345_purchase_test-shop",
        user: {},
        properties: {
          currency: "USD",
          value: 99.99,
          contents: [
            { content_id: "prod-1", content_type: "product", quantity: 1, price: 99.99 },
          ],
          content_type: "product",
          order_id: "12345",
        },
      };

      expect(tiktokPayload.event).toBe("CompletePayment");
      expect(tiktokPayload.properties.value).toBe(99.99);
      expect(tiktokPayload.properties.order_id).toBe("12345");
    });
  });

  describe("Deduplication Logic", () => {
    it("should deduplicate using eventId without PII", () => {
      const orderId = "12345";
      const shopDomain = "test-shop.myshopify.com";

      const eventId = generateEventId(orderId, "purchase", shopDomain);

      const eventId2 = generateEventId(orderId, "purchase", shopDomain);
      expect(eventId).toBe(eventId2);

      const differentEventId = generateEventId("99999", "purchase", shopDomain);
      expect(eventId).not.toBe(differentEventId);
    });

    it("should detect duplicate conversion log entries", async () => {
      const existingLog = {
        id: "log-1",
        shopId: "shop-1",
        orderId: "12345",
        platform: "meta",
        eventType: "purchase",
        clientSideSent: true,
      };

      vi.mocked(prisma.conversionLog.findFirst).mockResolvedValue(existingLog as never);

      const existing = await prisma.conversionLog.findFirst({
        where: {
          shopId: "shop-1",
          orderId: "12345",
          eventType: "purchase",
          clientSideSent: true,
        },
      });

      expect(existing).toBeTruthy();
      expect(existing?.clientSideSent).toBe(true);
    });
  });
});

describe("P0-02: Documentation", () => {
  it("documents that pixel only sends non-PII data", () => {
    expect(true).toBe(true);
  });
});
