const EMBEDDED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.shopify.com https://*.shopify.com",
  "style-src 'self' 'unsafe-inline' https://cdn.shopify.com",
  "img-src 'self' https://cdn.shopify.com https://*.shopify.com data: blob:",
  "font-src 'self' https://cdn.shopify.com",
  "connect-src 'self' https://*.shopify.com https://*.myshopify.com wss://*.shopify.com",
  "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
  "frame-src 'self' https://*.shopify.com",
  "form-action 'self' https://*.shopify.com",
  "base-uri 'self'",
  "upgrade-insecure-requests",
];

export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  "Content-Security-Policy": EMBEDDED_CSP_DIRECTIVES.join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "on",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

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
  
  if (!EMBEDDED_CSP_DIRECTIVES.some(d => d.includes("frame-ancestors"))) {
    issues.push("CSP missing frame-ancestors directive for embedded app");
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
