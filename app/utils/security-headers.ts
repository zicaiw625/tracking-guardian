/**
 * Security headers for embedded app pages.
 * 
 * ## P0-1 CSP 去歧义处理 - 重要说明
 * 
 * Content-Security-Policy 完全由 Shopify SDK 的 addDocumentResponseHeaders 处理：
 * - Shopify 会动态生成 frame-ancestors，精确限定到当前 shop 的域名
 * - 例如：frame-ancestors https://my-store.myshopify.com https://admin.shopify.com
 * - 我们 **不要** 自己设置任何 CSP，否则会覆盖 Shopify 的动态值
 * 
 * 这里只设置与 CSP 无关的安全头。addSecurityHeadersToHeaders 使用 "只在不存在时设置"
 * 的逻辑，所以即使不小心调用，也不会覆盖 Shopify 已设置的 CSP。
 */
export const EMBEDDED_APP_HEADERS: Record<string, string> = {
  // 不包含 Content-Security-Policy - 完全交给 Shopify addDocumentResponseHeaders
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
  
  // P0-1: Verify we're NOT setting CSP in EMBEDDED_APP_HEADERS
  // CSP must be handled by Shopify's addDocumentResponseHeaders for dynamic frame-ancestors
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
