import { describe, it, expect } from "vitest";
import { 
  EMBEDDED_APP_HEADERS, 
  API_SECURITY_HEADERS,
  validateSecurityHeaders,
} from "../../app/utils/security-headers";

describe("P0-1: CSP frame-ancestors compliance", () => {
  describe("EMBEDDED_APP_HEADERS", () => {
    it("should NOT include Content-Security-Policy (Shopify handles it)", () => {
      expect(EMBEDDED_APP_HEADERS["Content-Security-Policy"]).toBeUndefined();
    });

    it("should include other security headers", () => {
      expect(EMBEDDED_APP_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
      expect(EMBEDDED_APP_HEADERS["X-XSS-Protection"]).toBe("1; mode=block");
      expect(EMBEDDED_APP_HEADERS["Referrer-Policy"]).toBeDefined();
    });

    it("should have Permissions-Policy for security", () => {
      expect(EMBEDDED_APP_HEADERS["Permissions-Policy"]).toBeDefined();
    });
  });

  describe("validateSecurityHeaders", () => {
    it("should pass validation (no CSP in our headers)", () => {
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

  it("should include nosniff header", () => {
    expect(API_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });
});
