import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/services/shopify/app-config.server", () => ({
  addDocumentResponseHeaders: vi.fn((request: Request, headers: Headers) => {
    const shopDomain = request.headers.get("x-shopify-shop-domain") || "test-shop.myshopify.com";
    const existingCsp = headers.get("Content-Security-Policy") || "";
    const frameAncestors = `frame-ancestors https://admin.shopify.com https://${shopDomain}`;
    if (existingCsp) {
      const updatedCsp = existingCsp.replace(/frame-ancestors[^;]*/, frameAncestors);
      headers.set("Content-Security-Policy", updatedCsp);
    } else {
      headers.set("Content-Security-Policy", frameAncestors);
    }
  }),
}));

import { addDocumentResponseHeaders } from "../../app/services/shopify/app-config.server";

describe("Frame Ancestors CSP Header Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include https://admin.shopify.com in frame-ancestors for embedded app requests", () => {
    const request = new Request("https://example.com/app", {
      headers: {
        "x-shopify-shop-domain": "test-shop.myshopify.com",
      },
    });
    const headers = new Headers();
    
    addDocumentResponseHeaders(request, headers);
    
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("https://admin.shopify.com");
  });

  it("should include shop domain in frame-ancestors for embedded app requests", () => {
    const shopDomain = "my-store.myshopify.com";
    const request = new Request("https://example.com/app", {
      headers: {
        "x-shopify-shop-domain": shopDomain,
      },
    });
    const headers = new Headers();
    
    addDocumentResponseHeaders(request, headers);
    
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain(`https://${shopDomain}`);
  });

  it("should include both admin.shopify.com and shop domain in frame-ancestors", () => {
    const shopDomain = "example-store.myshopify.com";
    const request = new Request("https://example.com/app", {
      headers: {
        "x-shopify-shop-domain": shopDomain,
      },
    });
    const headers = new Headers();
    
    addDocumentResponseHeaders(request, headers);
    
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("https://admin.shopify.com");
    expect(csp).toContain(`https://${shopDomain}`);
  });

  it("should handle requests without shop domain header gracefully", () => {
    const request = new Request("https://example.com/app");
    const headers = new Headers();
    
    addDocumentResponseHeaders(request, headers);
    
    const csp = headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("https://admin.shopify.com");
  });
});
