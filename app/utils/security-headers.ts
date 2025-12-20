/**
 * P1-5: Security Headers Configuration
 * 
 * Security headers for Shopify embedded apps with proper configuration.
 * 
 * IMPORTANT: Shopify embedded apps run in iframes, so we use:
 * - frame-ancestors CSP directive (not X-Frame-Options: DENY)
 * - Allow Shopify CDN and admin domains
 * 
 * Headers are split by context:
 * - EMBEDDED_APP_HEADERS: For routes that render in Shopify Admin iframe
 * - API_SECURITY_HEADERS: For public API endpoints (pixel-events, survey, etc.)
 * - WEBHOOK_SECURITY_HEADERS: For webhook endpoints
 */

/**
 * Content-Security-Policy for embedded app pages
 * 
 * This allows the app to be embedded in Shopify Admin while preventing
 * clickjacking and XSS attacks.
 */
const EMBEDDED_CSP_DIRECTIVES = [
  // Only allow HTTPS scripts (except for Shopify's CDN which uses https)
  "default-src 'self'",
  
  // Allow scripts from self, Shopify CDN, and inline scripts (needed for Remix)
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com https://*.shopify.com",
  
  // Allow styles from self and Shopify CDN
  "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
  
  // Allow images from various sources
  "img-src 'self' https://cdn.shopify.com https://*.shopify.com data: blob:",
  
  // Allow fonts from Shopify CDN
  "font-src 'self' https://cdn.shopify.com",
  
  // Allow connections to our API, Shopify, and common analytics
  "connect-src 'self' https://*.shopify.com https://*.myshopify.com wss://*.shopify.com",
  
  // Frame ancestors - allow Shopify Admin to embed our app
  "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
  
  // Don't allow embedding in other frames
  "frame-src 'self' https://*.shopify.com",
  
  // Form actions - only submit to self
  "form-action 'self' https://*.shopify.com",
  
  // Base URI restriction
  "base-uri 'self'",
  
  // Upgrade insecure requests
  "upgrade-insecure-requests",
];

/**
 * Security headers for embedded app pages (rendered in Shopify Admin iframe)
 * 
 * Note: X-Frame-Options is intentionally NOT "DENY" because we're an embedded app.
 * The frame-ancestors CSP directive handles this more precisely.
 */
export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  // CSP with frame-ancestors for embedded app
  "Content-Security-Policy": EMBEDDED_CSP_DIRECTIVES.join("; "),
  
  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",
  
  // XSS protection (legacy browsers)
  "X-XSS-Protection": "1; mode=block",
  
  // Referrer policy
  "Referrer-Policy": "strict-origin-when-cross-origin",
  
  // DNS prefetch control
  "X-DNS-Prefetch-Control": "on",
  
  // Permissions policy (previously Feature-Policy)
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  
  // Note: HSTS is typically set at the load balancer/CDN level
  // Uncomment if your deployment doesn't handle this:
  // "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/**
 * Security headers for public API endpoints
 * 
 * These endpoints are called by browser extensions (Web Pixel) and 
 * checkout extensions (Survey), so CORS is more permissive.
 */
export const API_SECURITY_HEADERS: Record<string, string> = {
  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",
  
  // API responses should not be framed
  "X-Frame-Options": "DENY",
  
  // XSS protection
  "X-XSS-Protection": "1; mode=block",
  
  // Strict referrer for API calls
  "Referrer-Policy": "strict-origin-when-cross-origin",
  
  // No caching for API responses
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * Security headers for webhook endpoints
 * 
 * Webhooks come from Shopify servers, not browsers.
 */
export const WEBHOOK_SECURITY_HEADERS: Record<string, string> = {
  // Prevent MIME type sniffing
  "X-Content-Type-Options": "nosniff",
  
  // Webhooks should never be framed
  "X-Frame-Options": "DENY",
  
  // No caching
  "Cache-Control": "no-store",
};

/**
 * Add security headers to a Headers object
 * Only adds headers that are not already set.
 */
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

/**
 * Add security headers to a Response
 */
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

/**
 * Create headers init with security headers
 */
export function withSecurityHeaders(
  existingHeaders?: HeadersInit,
  securityHeaders: Record<string, string> = API_SECURITY_HEADERS
): Headers {
  const headers = new Headers(existingHeaders);
  addSecurityHeadersToHeaders(headers, securityHeaders);
  return headers;
}

/**
 * HSTS header value for production
 * 
 * Note: This should typically be set at the load balancer/CDN level.
 * Only use this if your deployment doesn't handle HSTS.
 * 
 * max-age: 1 year (31536000 seconds)
 * includeSubDomains: Apply to all subdomains
 * preload: Opt-in for browser preload lists (requires separate submission)
 */
export const HSTS_HEADER = "max-age=31536000; includeSubDomains";

/**
 * Get production-ready security headers with HSTS
 * Use this when deploying to production if your CDN/LB doesn't set HSTS
 */
export function getProductionSecurityHeaders(
  baseHeaders: Record<string, string> = API_SECURITY_HEADERS
): Record<string, string> {
  return {
    ...baseHeaders,
    "Strict-Transport-Security": HSTS_HEADER,
  };
}

/**
 * Validate that security headers are properly configured
 * Call this at startup to ensure headers are set correctly
 */
export function validateSecurityHeaders(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check CSP has frame-ancestors
  if (!EMBEDDED_CSP_DIRECTIVES.some(d => d.includes("frame-ancestors"))) {
    issues.push("CSP missing frame-ancestors directive for embedded app");
  }
  
  // Check API headers don't allow framing
  if (API_SECURITY_HEADERS["X-Frame-Options"] !== "DENY") {
    issues.push("API headers should set X-Frame-Options: DENY");
  }
  
  // Check for X-Content-Type-Options
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

