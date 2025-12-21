/**
 * P0-1 / P3-2: Tests for security headers configuration
 * 
 * These tests verify that:
 * - CSP does NOT include frame-ancestors (Shopify handles it dynamically)
 * - EMBEDDED_APP_HEADERS does NOT include CSP
 * - Security header validation catches issues
 */

import { describe, it, expect } from "vitest";
import { 
  EMBEDDED_APP_HEADERS, 
  API_SECURITY_HEADERS,
  validateSecurityHeaders,
  getEmbeddedAppCSP,
  buildDynamicCSP,
} from "../../app/utils/security-headers";

describe("P0-1: CSP frame-ancestors compliance", () => {
  describe("EMBEDDED_APP_HEADERS", () => {
    it("should NOT include Content-Security-Policy", () => {
      expect(EMBEDDED_APP_HEADERS["Content-Security-Policy"]).toBeUndefined();
    });

    it("should include other security headers", () => {
      expect(EMBEDDED_APP_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
      expect(EMBEDDED_APP_HEADERS["X-XSS-Protection"]).toBe("1; mode=block");
      expect(EMBEDDED_APP_HEADERS["Referrer-Policy"]).toBeDefined();
    });
  });

  describe("getEmbeddedAppCSP", () => {
    it("should NOT include frame-ancestors directive", () => {
      const csp = getEmbeddedAppCSP();
      expect(csp).not.toContain("frame-ancestors");
    });

    it("should include other CSP directives", () => {
      const csp = getEmbeddedAppCSP();
      expect(csp).toContain("default-src");
      expect(csp).toContain("script-src");
    });
  });

  describe("buildDynamicCSP", () => {
    it("should include shop-specific frame-ancestors", () => {
      const csp = buildDynamicCSP("my-store.myshopify.com");
      expect(csp).toContain("frame-ancestors https://my-store.myshopify.com https://admin.shopify.com");
    });

    it("should include other CSP directives", () => {
      const csp = buildDynamicCSP("test.myshopify.com");
      expect(csp).toContain("default-src");
      expect(csp).toContain("script-src");
    });
  });

  describe("validateSecurityHeaders", () => {
    it("should pass validation (no frame-ancestors in our CSP)", () => {
      const result = validateSecurityHeaders();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});

describe("API_SECURITY_HEADERS", () => {
  it("should set X-Frame-Options to DENY", () => {
    expect(API_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  it("should include cache control headers", () => {
    expect(API_SECURITY_HEADERS["Cache-Control"]).toContain("no-store");
  });
});

