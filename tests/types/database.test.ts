import { describe, it, expect } from "vitest";
import {
  parseCapiInput,
  parseConsentState,
  parsePixelClientConfig,
} from "../../app/types/database";

describe("parseCapiInput", () => {
  it("should parse valid CAPI input", () => {
    const input = {
      orderId: "order123",
      value: 99.99,
      currency: "USD",
      checkoutToken: "token123",
      items: [
        { productId: "p1", variantId: "v1", name: "Product", quantity: 2, price: 29.99 },
      ],
      tax: 5.00,
      shipping: 10.00,
    };
    const result = parseCapiInput(input);
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe("order123");
    expect(result?.value).toBe(99.99);
    expect(result?.checkoutToken).toBe("token123");
    expect(result?.items).toHaveLength(1);
    expect(result?.items?.[0].productId).toBe("p1");
    expect(result?.tax).toBe(5.00);
    expect(result?.shipping).toBe(10.00);
  });
  it("should handle null checkoutToken", () => {
    const input = {
      orderId: "order123",
      value: 99.99,
      checkoutToken: null,
      items: [],
    };
    const result = parseCapiInput(input);
    expect(result?.checkoutToken).toBeNull();
  });
  it("should return null for missing required fields", () => {
    const input = {
      checkoutToken: "token123",
    };
    const result = parseCapiInput(input);
    expect(result).toBeNull();
  });
  it("should return null for completely invalid input", () => {
    const result = parseCapiInput("not an object");
    expect(result).toBeNull();
  });
  it("should return null for empty object (missing required fields)", () => {
    const result = parseCapiInput({});
    expect(result).toBeNull();
  });
  it("should handle undefined/null", () => {
    expect(parseCapiInput(undefined)).toBeNull();
    expect(parseCapiInput(null)).toBeNull();
  });
  it("should default currency to USD if missing", () => {
    const input = {
      orderId: "order123",
      value: 99.99,
    };
    const result = parseCapiInput(input);
    expect(result?.currency).toBe("USD");
  });
});

describe("parseConsentState", () => {
  it("should parse valid consent state", () => {
    const input = {
      marketing: true,
      analytics: false,
      saleOfData: true,
    };
    const result = parseConsentState(input);
    expect(result).not.toBeNull();
    expect(result?.marketing).toBe(true);
    expect(result?.analytics).toBe(false);
    expect(result?.saleOfData).toBe(true);
  });
  it("should handle partial consent state", () => {
    const input = { marketing: true };
    const result = parseConsentState(input);
    expect(result).not.toBeNull();
    expect(result?.marketing).toBe(true);
    expect(result?.analytics).toBeUndefined();
  });
  it("should handle null input", () => {
    const result = parseConsentState(null);
    expect(result).toBeNull();
  });
  it("should handle empty object", () => {
    const result = parseConsentState({});
    expect(result).not.toBeNull();
  });
  it("should filter non-boolean values", () => {
    const input = {
      marketing: "yes",
      analytics: true,
    };
    const result = parseConsentState(input);
    expect(result?.marketing).toBeUndefined();
    expect(result?.analytics).toBe(true);
  });
});

describe("parsePixelClientConfig", () => {
  it("should parse valid client config", () => {
    const input = {
      treatAsMarketing: true,
    };
    const result = parsePixelClientConfig(input);
    expect(result).not.toBeNull();
    expect(result?.treatAsMarketing).toBe(true);
  });
  it("should handle missing treatAsMarketing", () => {
    const result = parsePixelClientConfig({});
    expect(result).not.toBeNull();
    expect(result?.treatAsMarketing).toBeUndefined();
  });
  it("should return null for invalid input", () => {
    const result = parsePixelClientConfig("invalid");
    expect(result).toBeNull();
  });
  it("should handle null input", () => {
    const result = parsePixelClientConfig(null);
    expect(result).toBeNull();
  });
});
