

export const API_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "object-src": ["'none'"],
};

export const WEBHOOK_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "frame-ancestors": ["'none'"],
};

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

export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "on",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Security-Policy": buildCspHeader(API_CSP_DIRECTIVES),
};

export const WEBHOOK_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Content-Security-Policy": buildCspHeader(WEBHOOK_CSP_DIRECTIVES),
};

export const PIXEL_INGESTION_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Access-Control-Max-Age": "86400",
};

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

export function validateSecurityHeaders(): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (EMBEDDED_APP_HEADERS["Content-Security-Policy"]) {
    issues.push(
      "EMBEDDED_APP_HEADERS should NOT include Content-Security-Policy - Shopify handles this"
    );
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

  if (!API_SECURITY_HEADERS["Content-Security-Policy"]) {
    issues.push("API headers should include Content-Security-Policy");
  }
  if (!WEBHOOK_SECURITY_HEADERS["Content-Security-Policy"]) {
    issues.push("Webhook headers should include Content-Security-Policy");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

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

export function getRateLimitExceededHeaders(
  retryAfterSeconds: number
): Record<string, string> {
  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Remaining": "0",
  };
}
