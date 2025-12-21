/**
 * CSP directives for embedded app - EXCLUDES frame-ancestors
 * 
 * P0-1: frame-ancestors MUST be dynamically set by Shopify's addDocumentResponseHeaders
 * to include only the specific shop domain (https://{shop}.myshopify.com) + admin.shopify.com
 * 
 * Using wildcards like *.myshopify.com is NOT allowed for Shopify App Store approval.
 * Shopify's framework handles this correctly - we must not override it.
 */
const EMBEDDED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com https://*.shopify.com",
  "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
  "img-src 'self' https://cdn.shopify.com https://*.shopify.com data: blob:",
  "font-src 'self' https://cdn.shopify.com",
  "connect-src 'self' https://*.shopify.com https://*.myshopify.com wss://*.shopify.com",
  // NOTE: frame-ancestors is intentionally OMITTED - Shopify's addDocumentResponseHeaders sets it dynamically
  "frame-src 'self' https://*.shopify.com",
  "form-action 'self' https://*.shopify.com",
  "base-uri 'self'",
  "upgrade-insecure-requests",
];

/**
 * Security headers for embedded app pages.
 * 
 * IMPORTANT (P0-1): Content-Security-Policy is NOT included here.
 * Shopify's addDocumentResponseHeaders MUST set CSP with dynamic frame-ancestors
 * that includes the specific shop domain. Our job is to NOT override that.
 * 
 * If you need to add CSP directives, use getEmbeddedAppCSP() which can be merged
 * with Shopify's CSP, but never override frame-ancestors.
 */
export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  // CSP is intentionally NOT set here - let Shopify's addDocumentResponseHeaders handle it
  // This ensures frame-ancestors is dynamically set per-shop as required
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "on",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

/**
 * Get CSP directives that can be safely merged with Shopify's CSP.
 * Does NOT include frame-ancestors which must be set by Shopify.
 */
export function getEmbeddedAppCSP(): string {
  return EMBEDDED_CSP_DIRECTIVES.join("; ");
}

/**
 * Build dynamic CSP with shop-specific frame-ancestors.
 * Use this ONLY if you need to completely override Shopify's CSP.
 * Prefer letting Shopify handle CSP via addDocumentResponseHeaders.
 */
export function buildDynamicCSP(shopDomain: string): string {
  const dynamicDirectives = [
    ...EMBEDDED_CSP_DIRECTIVES,
    `frame-ancestors https://${shopDomain} https://admin.shopify.com`,
  ];
  return dynamicDirectives.join("; ");
}

export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

export const WEBHOOK_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

export function addSecurityHeadersToHeaders(
  headers: Headers,
  securityHeaders: Record<string, string>
): void {
  for (const [key, value] of Object.entries(securityHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
}

export function addSecurityHeaders(
  response: Response,
  securityHeaders: Record<string, string> = API_SECURITY_HEADERS
): Response {
  const headers = new Headers(response.headers);
  addSecurityHeadersToHeaders(headers, securityHeaders);
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withSecurityHeaders(
  existingHeaders?: HeadersInit,
  securityHeaders: Record<string, string> = API_SECURITY_HEADERS
): Headers {
  const headers = new Headers(existingHeaders);
  addSecurityHeadersToHeaders(headers, securityHeaders);
  return headers;
}

export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

export function getProductionSecurityHeaders(
  baseHeaders: Record<string, string> = API_SECURITY_HEADERS
): Record<string, string> {
  return {
    ...baseHeaders,
    "Strict-Transport-Security": HSTS_HEADER,
  };
}

export function validateSecurityHeaders(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // P0-1: frame-ancestors should NOT be in our CSP directives
  // It must be set dynamically by Shopify's addDocumentResponseHeaders
  if (EMBEDDED_CSP_DIRECTIVES.some(d => d.includes("frame-ancestors"))) {
    issues.push("CSP should NOT include frame-ancestors - let Shopify set it dynamically per-shop");
  }
  
  // Verify we're NOT overriding Shopify's CSP in EMBEDDED_APP_HEADERS
  if (EMBEDDED_APP_HEADERS["Content-Security-Policy"]) {
    issues.push("EMBEDDED_APP_HEADERS should NOT include Content-Security-Policy - Shopify handles this");
  }
  
  if (API_SECURITY_HEADERS["X-Frame-Options"] !== "DENY") {
    issues.push("API headers should set X-Frame-Options: DENY");
  }
  
  const allHeaders = [
    EMBEDDED_APP_HEADERS,
    API_SECURITY_HEADERS,
    WEBHOOK_SECURITY_HEADERS,
  ];
  
  for (const headers of allHeaders) {
    if (headers["X-Content-Type-Options"] !== "nosniff") {
      issues.push("Missing X-Content-Type-Options: nosniff");
      break;
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}
