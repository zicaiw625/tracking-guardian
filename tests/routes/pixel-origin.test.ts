import { describe, it, expect } from "vitest";
import { isValidPixelOrigin } from "../../app/utils/origin-validation";

describe("isValidPixelOrigin", () => {
  describe("should accept valid HTTPS origins", () => {
    it("accepts myshopify.com origin", () => {
      const result = isValidPixelOrigin("https://test-shop.myshopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_shopify_origin");
    });
    it("accepts checkout.shopify.com origin", () => {
      const result = isValidPixelOrigin("https://checkout.shopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_shopify_origin");
    });
    it("accepts shopify.com subdomain origin", () => {
      const result = isValidPixelOrigin("https://admin.shopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_allowed_origin");
    });
    it("accepts custom domain origin matching allowed pattern", () => {
      const result = isValidPixelOrigin("https://example.myshopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_shopify_origin");
    });
  });
  describe("should handle sandbox/null origins", () => {
    it("accepts string 'null' origin", () => {
      const result = isValidPixelOrigin("null");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("null_origin_allowed");
    });
    it("accepts null value", () => {
      const result = isValidPixelOrigin(null);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("null_origin_allowed");
    });
    it("accepts empty string (no origin header)", () => {
      const result = isValidPixelOrigin("");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("no_origin_dev");
    });
  });
  describe("should reject HTTP origins", () => {
    it("rejects plain HTTP", () => {
      const result = isValidPixelOrigin("http://example.com");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("http_not_allowed");
    });
    it("rejects HTTP myshopify domain", () => {
      const result = isValidPixelOrigin("http://example.com");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("http_not_allowed");
    });
  });
  describe("should reject malformed origins", () => {
    it("rejects non-URL string", () => {
      const result = isValidPixelOrigin("not-a-url");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("malformed_origin");
    });
    it("rejects javascript: protocol", () => {
      const result = isValidPixelOrigin("javascript:alert(1)");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_protocol");
    });
    it("rejects data: protocol", () => {
      const result = isValidPixelOrigin("data:text/html,test");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("data_protocol_blocked");
    });
  });
});
