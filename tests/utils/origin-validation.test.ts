import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validatePixelOriginPreBody,
  validatePixelOriginForShop,
  buildShopAllowedDomains,
} from "../../app/utils/origin-validation";

describe("validatePixelOriginPreBody", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("origin === 'null'", () => {
    it("in dev/test: valid, null_origin_allowed, shouldReject false", () => {
      process.env.NODE_ENV = "test";
      const r = validatePixelOriginPreBody("null", false, true);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("null_origin_allowed");
      expect(r.shouldReject).toBe(false);
    });

    it("in dev with hasSignature: valid, null_origin_allowed_with_signature (signature branch takes precedence)", () => {
      process.env.NODE_ENV = "test";
      const r = validatePixelOriginPreBody("null", true, true);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("null_origin_allowed_with_signature");
      expect(r.shouldReject).toBe(false);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false, no signature: invalid, null_origin_blocked, shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginPreBody("null", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("null_origin_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true, no signature: invalid (allowNull+!sig blocks), shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const r = validatePixelOriginPreBody("null", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("null_origin_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false, hasSignature: invalid, null_origin_blocked, shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginPreBody("null", true, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("null_origin_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true, hasSignature: valid, null_origin_allowed_with_signature, shouldReject false", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const r = validatePixelOriginPreBody("null", true, true);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("null_origin_allowed_with_signature");
      expect(r.shouldReject).toBe(false);
    });
  });

  describe("origin === null (missing) with originHeaderPresent", () => {
    it("in dev, originHeaderPresent false: valid, missing_origin_allowed", () => {
      process.env.NODE_ENV = "test";
      const r = validatePixelOriginPreBody(null, false, false);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("missing_origin_allowed");
      expect(r.shouldReject).toBe(false);
    });

    it("in production, originHeaderPresent false, no allowNull, no sig: invalid, missing_origin, shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginPreBody(null, false, false);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("missing_origin");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false, originHeaderPresent false, hasSignature: invalid, missing_origin, shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginPreBody(null, true, false);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("missing_origin");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true, originHeaderPresent false, hasSignature: valid, missing_origin_allowed_with_signature", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const r = validatePixelOriginPreBody(null, true, false);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("missing_origin_allowed_with_signature");
      expect(r.shouldReject).toBe(false);
    });
  });

  describe("dangerous protocols", () => {
    it("rejects file: protocol", () => {
      const r = validatePixelOriginPreBody("file:///etc/passwd", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("file_protocol_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("rejects chrome-extension: protocol", () => {
      const r = validatePixelOriginPreBody("chrome-extension://xxx", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("chrome_extension_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("rejects data: protocol", () => {
      const r = validatePixelOriginPreBody("data:text/html,<script>", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("data_protocol_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("rejects blob: protocol", () => {
      const r = validatePixelOriginPreBody("blob:https://example.com/xxx", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("blob_protocol_blocked");
      expect(r.shouldReject).toBe(true);
    });
  });

  describe("HTTPS allowed patterns", () => {
    it("accepts https myshopify", () => {
      const r = validatePixelOriginPreBody("https://test.myshopify.com", false, true);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("https_allowed_origin");
      expect(r.shouldReject).toBe(false);
    });

    it("accepts https checkout.shopify.com", () => {
      const r = validatePixelOriginPreBody("https://checkout.shopify.com", false, true);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("https_shopify_origin");
      expect(r.shouldReject).toBe(false);
    });

    it("rejects http (non-localhost) in production", () => {
      process.env.NODE_ENV = "production";
      const r = validatePixelOriginPreBody("http://example.com", false, true);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("http_not_allowed");
      expect(r.shouldReject).toBe(true);
    });
  });
});

describe("validatePixelOriginForShop", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const allowed = buildShopAllowedDomains({
    shopDomain: "test.myshopify.com",
    primaryDomain: "shop.example.com",
    storefrontDomains: ["www.example.com"],
  });

  describe("null / 'null' origin", () => {
    it("in dev: valid, null_origin_allowed, shouldReject false", () => {
      process.env.NODE_ENV = "test";
      const r = validatePixelOriginForShop("null", allowed, { hasSignatureHeaderOrHMAC: false });
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("null_origin_allowed");
      expect(r.shouldReject).toBe(false);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false, no sig: invalid, null_origin_blocked, shouldReject true", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginForShop("null", allowed, { hasSignatureHeaderOrHMAC: false });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("null_origin_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false, hasSignature: invalid, null_origin_blocked", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "false";
      const r = validatePixelOriginForShop("null", allowed, { hasSignatureHeaderOrHMAC: true });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("null_origin_blocked");
      expect(r.shouldReject).toBe(true);
    });

    it("in production, PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true, hasSignature: valid, null_origin_allowed_with_signature", () => {
      process.env.NODE_ENV = "production";
      process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY = "true";
      const r = validatePixelOriginForShop("null", allowed, { hasSignatureHeaderOrHMAC: true });
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("null_origin_allowed_with_signature");
      expect(r.shouldReject).toBe(false);
    });
  });

  describe("shop allowlist", () => {
    it("exact match on shop domain: valid, exact_match", () => {
      const r = validatePixelOriginForShop("https://test.myshopify.com", allowed);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("exact_match");
      expect(r.matched).toBeDefined();
      expect(r.shouldReject).toBe(false);
    });

    it("exact match on primaryDomain: valid, exact_match", () => {
      const r = validatePixelOriginForShop("https://shop.example.com", allowed);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("exact_match");
      expect(r.shouldReject).toBe(false);
    });

    it("Shopify platform host: valid, shopify_platform_domain", () => {
      const r = validatePixelOriginForShop("https://checkout.shopify.com", allowed);
      expect(r.valid).toBe(true);
      expect(r.reason).toBe("shopify_platform_domain");
      expect(r.matched).toBe("checkout.shopify.com");
      expect(r.shouldReject).toBe(false);
    });

    it("random origin not in allowlist: invalid, origin_not_allowlisted, shouldReject true", () => {
      const r = validatePixelOriginForShop("https://evil.com", allowed);
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/^origin_not_allowlisted:/);
      expect(r.shouldReject).toBe(true);
    });
  });
});
