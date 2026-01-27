import { describe, it, expect } from "vitest";
import {
  PixelEventSchema,
  PixelEventNameSchema,
  ConsentSchema,
  validatePixelEvent,
  isPrimaryEvent,
  CheckoutCompletedDataSchema,
} from "../../app/schemas/pixel-event";

describe("PixelEventNameSchema", () => {
  it("should accept valid event names", () => {
    const validNames = [
      "checkout_completed",
      "checkout_started",
      "checkout_contact_info_submitted",
      "checkout_shipping_info_submitted",
      "payment_info_submitted",
      "page_viewed",
      "product_viewed",
      "product_added_to_cart",
    ];
    for (const name of validNames) {
      const result = PixelEventNameSchema.safeParse(name);
      expect(result.success).toBe(true);
    }
  });
  it("should reject invalid event names", () => {
    const invalidNames = [
      "invalid_event",
      "purchase",
      "CHECKOUT_COMPLETED",
      "",
    ];
    for (const name of invalidNames) {
      const result = PixelEventNameSchema.safeParse(name);
      expect(result.success).toBe(false);
    }
  });
});

describe("ConsentSchema", () => {
  it("should accept valid consent objects", () => {
    const validConsents = [
      { marketing: true, analytics: true },
      { marketing: false, analytics: false },
      { marketing: true },
      { analytics: false },
      { saleOfData: true },
      { marketing: true, analytics: true, saleOfData: false },
      {},
    ];
    for (const consent of validConsents) {
      const result = ConsentSchema.safeParse(consent);
      expect(result.success).toBe(true);
    }
  });
  it("should reject extra fields (strict mode)", () => {
    const invalidConsent = {
      marketing: true,
      unknownField: "value"
    };
    const result = ConsentSchema.safeParse(invalidConsent);
    expect(result.success).toBe(false);
  });
});

describe("CheckoutCompletedDataSchema", () => {
  it("should accept data with orderId", () => {
    const data = { orderId: "12345" };
    const result = CheckoutCompletedDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
  it("should accept data with checkoutToken", () => {
    const data = { checkoutToken: "token123" };
    const result = CheckoutCompletedDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
  it("should accept data with both orderId and checkoutToken", () => {
    const data = { orderId: "12345", checkoutToken: "token123" };
    const result = CheckoutCompletedDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
  it("should reject data without orderId or checkoutToken", () => {
    const data = { value: 99.99 };
    const result = CheckoutCompletedDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
  it("should accept null orderId if checkoutToken exists", () => {
    const data = { orderId: null, checkoutToken: "token123" };
    const result = CheckoutCompletedDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("PixelEventSchema", () => {
  const validBasePayload = {
    eventName: "checkout_completed",
    timestamp: Date.now(),
    shopDomain: "test-shop.myshopify.com",
    data: {
      orderId: "gid://shopify/Order/123456",
      checkoutToken: "valid-checkout-token-123",
    },
  };
  it("should accept valid checkout_completed payload", () => {
    const result = PixelEventSchema.safeParse(validBasePayload);
    expect(result.success).toBe(true);
  });
  it("should accept payload with consent", () => {
    const payload = {
      ...validBasePayload,
      consent: {
        marketing: true,
        analytics: true,
      },
    };
    const result = PixelEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
  it("should reject invalid shop domain format", () => {
    const invalidDomains = [
      "invalid-domain.com",
      "test.notshopify.com",
      ".myshopify.com",
    ];
    for (const domain of invalidDomains) {
      const payload = {
        ...validBasePayload,
        shopDomain: domain,
      };
      const result = PixelEventSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });
  it("should accept page_viewed without orderId", () => {
    const payload = {
      eventName: "page_viewed",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      data: {
        url: "https://example.com/product",
        title: "Test Product",
      },
    };
    const result = PixelEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
  it("should accept product_added_to_cart", () => {
    const payload = {
      eventName: "product_added_to_cart",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      data: {
        productId: "12345",
        productTitle: "Test Product",
        price: 29.99,
        quantity: 1,
      },
    };
    const result = PixelEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
  it("should accept product_viewed", () => {
    const payload = {
      eventName: "product_viewed",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      data: {
        productId: "12345",
        productTitle: "Test Product",
        variantId: "67890",
        price: 29.99,
        currency: "USD",
      },
    };
    const result = PixelEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("validatePixelEvent", () => {
  it("should return success for valid payload", () => {
    const payload = {
      eventName: "checkout_completed",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      data: { orderId: "12345" },
    };
    const result = validatePixelEvent(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventName).toBe("checkout_completed");
    }
  });
  it("should return success for page_viewed event", () => {
    const payload = {
      eventName: "page_viewed",
      timestamp: Date.now(),
      shopDomain: "test-shop.myshopify.com",
      data: { url: "https://example.com" },
    };
    const result = validatePixelEvent(payload);
    expect(result.success).toBe(true);
  });
});
describe("isPrimaryEvent", () => {
  it("should return true for checkout_completed", () => {
    expect(isPrimaryEvent("checkout_completed")).toBe(true);
  });
  it("should return false for other events", () => {
    expect(isPrimaryEvent("page_viewed")).toBe(false);
    expect(isPrimaryEvent("product_added_to_cart")).toBe(false);
    expect(isPrimaryEvent("checkout_started")).toBe(false);
  });
});
