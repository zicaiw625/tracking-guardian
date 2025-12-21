/**
 * Shared CORS utilities for API endpoints.
 * 
 * This module provides consistent CORS handling across all API routes,
 * with support for both dynamic (origin-based) and static CORS configurations.
 */

import { json } from "@remix-run/node";
import { 
  isValidShopifyOrigin, 
  isValidDevOrigin, 
  isDevMode 
} from "./origin-validation";

/**
 * Security headers applied to all API responses.
 */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
} as const;

/**
 * Static CORS headers for endpoints that allow all origins.
 * Use for public endpoints like survey submissions.
 */
export const STATIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Access-Control-Max-Age": "86400",
  ...SECURITY_HEADERS,
} as const;

/**
 * Generates dynamic CORS headers based on the request origin.
 * 
 * This function validates origins against allowed patterns:
 * - Shopify domains (*.myshopify.com, *.myshopify.io, etc.)
 * - Development origins (localhost, 127.0.0.1) when in dev mode
 * 
 * @param request - The incoming request
 * @param customHeaders - Additional allowed headers beyond the defaults
 * @returns Headers object for the response
 */
export function getDynamicCorsHeaders(
  request: Request,
  customHeaders?: string[]
): HeadersInit {
  const origin = request.headers.get("Origin");
  
  const allowedHeaders = [
    "Content-Type",
    ...(customHeaders || []),
  ].join(", ");

  const baseSecurityHeaders = { ...SECURITY_HEADERS };

  // Special case: null origin (sandboxed iframes, file://, etc.)
  if (origin === "null") {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": allowedHeaders,
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // No origin header (same-origin requests, curl, etc.)
  if (!origin) {
    return {
      ...baseSecurityHeaders,
      "Vary": "Origin",
    };
  }

  // Valid Shopify origin
  if (isValidShopifyOrigin(origin)) {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": allowedHeaders,
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // Development mode with valid dev origin
  if (isDevMode() && isValidDevOrigin(origin)) {
    return {
      ...baseSecurityHeaders,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": allowedHeaders,
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  // Origin not allowed
  return {
    ...baseSecurityHeaders,
    "Vary": "Origin",
  };
}

/**
 * Options for jsonWithCors response helper.
 */
export interface CorsResponseInit extends Omit<ResponseInit, "headers"> {
  /** The incoming request (required for dynamic CORS) */
  request?: Request;
  /** Use static CORS headers (allow all origins) */
  staticCors?: boolean;
  /** Additional headers to include */
  headers?: HeadersInit;
}

/**
 * Creates a JSON response with appropriate CORS headers.
 * 
 * @param data - The data to return as JSON
 * @param init - Response options including CORS configuration
 * @returns Response with CORS headers
 * 
 * @example
 * // Dynamic CORS based on origin validation
 * return jsonWithCors({ success: true }, { request });
 * 
 * @example
 * // Static CORS (allow all origins)
 * return jsonWithCors({ success: true }, { staticCors: true });
 * 
 * @example
 * // With additional headers
 * return jsonWithCors(
 *   { success: true },
 *   { request, headers: { "Cache-Control": "no-cache" } }
 * );
 */
export function jsonWithCors<T>(
  data: T,
  init?: CorsResponseInit
): Response {
  const { request, staticCors, headers: additionalHeaders, ...responseInit } = init || {};
  
  // Determine which CORS headers to use
  let corsHeaders: HeadersInit;
  if (staticCors) {
    corsHeaders = STATIC_CORS_HEADERS;
  } else if (request) {
    corsHeaders = getDynamicCorsHeaders(request);
  } else {
    // Default to security headers only if no request provided
    corsHeaders = SECURITY_HEADERS;
  }

  // Merge headers
  const mergedHeaders = new Headers(corsHeaders as Record<string, string>);
  
  if (additionalHeaders) {
    const headersToAdd = additionalHeaders instanceof Headers 
      ? additionalHeaders 
      : new Headers(additionalHeaders as Record<string, string>);
    
    headersToAdd.forEach((value, key) => {
      mergedHeaders.set(key, value);
    });
  }

  return json(data, {
    ...responseInit,
    headers: mergedHeaders,
  });
}

/**
 * Creates an OPTIONS response for CORS preflight requests.
 * 
 * @param request - The incoming request (for dynamic CORS)
 * @param staticCors - Whether to use static CORS headers
 * @returns 204 No Content response with CORS headers
 */
export function handleCorsPreFlight(
  request?: Request,
  staticCors = false
): Response {
  const headers = staticCors 
    ? STATIC_CORS_HEADERS 
    : (request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS);
  
  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Adds CORS headers to an existing response.
 * 
 * @param response - The response to add headers to
 * @param request - The incoming request (for dynamic CORS)
 * @param staticCors - Whether to use static CORS headers
 * @returns New response with CORS headers added
 */
export function addCorsHeaders(
  response: Response,
  request?: Request,
  staticCors = false
): Response {
  const headers = staticCors 
    ? STATIC_CORS_HEADERS 
    : (request ? getDynamicCorsHeaders(request) : SECURITY_HEADERS);
  
  const newHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

