import { describe, it, expect } from "vitest";
import { isValidPixelOrigin } from "../../app/utils/origin-validation";

describe("isValidPixelOrigin", () => {
  describe("should accept valid HTTPS origins", () => {
    it("accepts custom domain origin", () => {
      const result = isValidPixelOrigin("https://example.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts myshopify.com origin", () => {
      const result = isValidPixelOrigin("https://example.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts checkout.shopify.com origin", () => {
      const result = isValidPixelOrigin("https://example.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
    });

    it("accepts subdomain custom domain", () => {
      const result = isValidPixelOrigin("https://example.com");
      expect(result.valid).toBe(true);
      expect(result.reason).toBe("https_origin");
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
