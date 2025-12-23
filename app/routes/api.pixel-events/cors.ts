/**
 * Pixel Events API - CORS Helpers
 *
 * CORS header handling for the pixel events endpoint.
 */

import {
  getPixelEventsCorsHeaders,
  getPixelEventsCorsHeadersForShop,
  jsonWithCors as jsonWithCorsBase,
} from "../../utils/cors";

// =============================================================================
// Constants
// =============================================================================

export const PIXEL_CUSTOM_HEADERS = [
  "X-Tracking-Guardian-Key",
  "X-Tracking-Guardian-Timestamp",
];

// =============================================================================
// CORS Header Functions
// =============================================================================

/**
 * Get CORS headers for requests before body validation (no shop context).
 */
export function getCorsHeadersPreBody(request: Request): HeadersInit {
  return getPixelEventsCorsHeaders(request, { customHeaders: PIXEL_CUSTOM_HEADERS });
}

/**
 * Get CORS headers for requests with shop context.
 */
export function getCorsHeadersForShop(
  request: Request,
  shopAllowedDomains: string[]
): HeadersInit {
  return getPixelEventsCorsHeadersForShop(
    request,
    shopAllowedDomains,
    PIXEL_CUSTOM_HEADERS
  );
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create JSON response with appropriate CORS headers.
 */
export function jsonWithCors<T>(
  data: T,
  init: ResponseInit & {
    request: Request;
    shopAllowedDomains?: string[];
  }
): Response {
  const { request, shopAllowedDomains, ...responseInit } = init;
  const corsHeaders = shopAllowedDomains
    ? getCorsHeadersForShop(request, shopAllowedDomains)
    : getCorsHeadersPreBody(request);

  return jsonWithCorsBase(data, {
    ...responseInit,
    request,
    headers: {
      ...(responseInit.headers as Record<string, string> | undefined),
      ...corsHeaders,
    },
  });
}

/**
 * Create empty response with CORS headers (for silent drops).
 */
export function emptyResponseWithCors(
  request: Request,
  shopAllowedDomains?: string[]
): Response {
  const headers = shopAllowedDomains
    ? getCorsHeadersForShop(request, shopAllowedDomains)
    : getCorsHeadersPreBody(request);

  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Create OPTIONS preflight response.
 */
export function optionsResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeadersPreBody(request),
  });
}

