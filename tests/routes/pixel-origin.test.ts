import { describe, it, expect } from "vitest";
import { isValidPixelOrigin } from "../../app/utils/origin-validation";

describe("isValidPixelOrigin", () => {
  describe("should accept valid HTTPS origins", () => {
    it("accepts custom domain origin", () => {
      const result = isValidPixelOrigin("https://brand.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts myshopify.com origin", () => {
      const result = isValidPixelOrigin("https://my-store.myshopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts checkout.shopify.com origin", () => {
      const result = isValidPixelOrigin("https://checkout.shopify.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts subdomain custom domain", () => {
      const result = isValidPixelOrigin("https://shop.example.co.uk");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });
  });

  describe("should handle sandbox/null origins", () => {
    it("accepts string 'null' origin", () => {
      const result = isValidPixelOrigin("null");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("sandbox_or_null_origin");
    });

    it("accepts null value", () => {
      const result = isValidPixelOrigin(null);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("sandbox_or_null_origin");
    });

    it("accepts empty string (no origin header)", () => {
      const result = isValidPixelOrigin("");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("no_origin_header");
    });
  });

  describe("should reject HTTP origins", () => {
    it("rejects plain HTTP", () => {
      const result = isValidPixelOrigin("http://brand.com");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("http_not_allowed");
    });

    it("rejects HTTP myshopify domain", () => {
      const result = isValidPixelOrigin("http://store.myshopify.com");
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
      expect(result.reason).toBe("malformed_origin");
    });

    it("rejects data: protocol", () => {
      const result = isValidPixelOrigin("data:text/html,test");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("malformed_origin");
    });
  });
});

