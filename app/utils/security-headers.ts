/**
 * Security Headers Configuration
 *
 * Comprehensive security headers for different contexts within the Shopify app.
 */

// =============================================================================
// CSP Directives
// =============================================================================

/**
 * Content Security Policy directives for API endpoints.
 * Note: Embedded app CSP is managed by Shopify.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "https://cdn.shopify.com"],
  "style-src": ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
  "img-src": ["'self'", "data:", "https:", "blob:"],
  "font-src": ["'self'", "https://cdn.shopify.com"],
  "connect-src": [
    "'self'",
    "https://*.shopify.com",
    "https://*.myshopify.com",
  ],
  "frame-ancestors": ["https://admin.shopify.com", "https://*.myshopify.com"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "upgrade-insecure-requests": [],
};

/**
 * Build CSP header value from directives
 */
export function buildCspHeader(
  directives: Record<string, string[]> = CSP_DIRECTIVES
): string {
  return Object.entries(directives)
    .map(([directive, sources]) => {
      if (sources.length === 0) {
        return directive;
      }
      return `${directive} ${sources.join(" ")}`;
    })
    .join("; ");
}

// =============================================================================
// Header Collections
// =============================================================================

/**
 * Headers for embedded app pages (rendered inside Shopify Admin).
 * Note: CSP is NOT included here as Shopify manages it for embedded apps.
 */
export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "on",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

/**
 * Headers for API endpoints (JSON responses).
 */
export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * Headers for webhook endpoints.
 */
export const WEBHOOK_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

/**
 * Headers for pixel event ingestion endpoints.
 * More permissive CORS for cross-origin pixel events.
 */
export const PIXEL_INGESTION_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Access-Control-Max-Age": "86400",
};

/**
 * Headers for health check endpoints.
 * Allows caching for reduced load.
 */
export const HEALTH_CHECK_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "max-age=10, must-revalidate",
};
export function addSecurityHeadersToHeaders(headers: Headers, securityHeaders: Record<string, string>): void {
    for (const [key, value] of Object.entries(securityHeaders)) {
        if (!headers.has(key)) {
            headers.set(key, value);
        }
    }
}
export function addSecurityHeaders(response: Response, securityHeaders: Record<string, string> = API_SECURITY_HEADERS): Response {
    const headers = new Headers(response.headers);
    addSecurityHeadersToHeaders(headers, securityHeaders);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
export function withSecurityHeaders(existingHeaders?: HeadersInit, securityHeaders: Record<string, string> = API_SECURITY_HEADERS): Headers {
    const headers = new Headers(existingHeaders);
    addSecurityHeadersToHeaders(headers, securityHeaders);
    return headers;
}
export const HSTS_HEADER = "max-age=31536000; includeSubDomains";
export function getProductionSecurityHeaders(baseHeaders: Record<string, string> = API_SECURITY_HEADERS): Record<string, string> {
    return {
        ...baseHeaders,
        "Strict-Transport-Security": HSTS_HEADER,
    };
}
/**
 * Validate security headers configuration
 */
export function validateSecurityHeaders(): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check that embedded app headers don't include CSP
  if (EMBEDDED_APP_HEADERS["Content-Security-Policy"]) {
    issues.push(
      "EMBEDDED_APP_HEADERS should NOT include Content-Security-Policy - Shopify handles this"
    );
  }

  // Check X-Frame-Options for API endpoints
  if (API_SECURITY_HEADERS["X-Frame-Options"] !== "DENY") {
    issues.push("API headers should set X-Frame-Options: DENY");
  }

  // Check all headers have X-Content-Type-Options
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

// =============================================================================
// CORS Helpers
// =============================================================================

/**
 * CORS headers for preflight responses
 */
export function getCorsPreflightHeaders(
  origin: string,
  allowedOrigins: string[] = []
): Record<string, string> {
  const isAllowed =
    allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  if (!isAllowed) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * CORS headers for actual responses
 */
export function getCorsResponseHeaders(
  origin: string,
  allowedOrigins: string[] = []
): Record<string, string> {
  const isAllowed =
    allowedOrigins.length === 0 || allowedOrigins.includes(origin);

  if (!isAllowed) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  };
}

// =============================================================================
// Rate Limiting Headers
// =============================================================================

/**
 * Rate limiting response headers
 */
export function getRateLimitHeaders(
  limit: number,
  remaining: number,
  resetAt: Date
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(Math.floor(resetAt.getTime() / 1000)),
  };
}

/**
 * Rate limit exceeded response headers
 */
export function getRateLimitExceededHeaders(
  retryAfterSeconds: number
): Record<string, string> {
  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Remaining": "0",
  };
}
