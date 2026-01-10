import {
  getPixelEventsCorsHeaders,
  getPixelEventsCorsHeadersForShop,
  jsonWithCors as jsonWithCorsBase,
} from "../../utils/cors";

export const PIXEL_CUSTOM_HEADERS = [
  "X-Tracking-Guardian-Timestamp",
  "X-Tracking-Guardian-Signature",
];

export function getCorsHeadersPreBody(request: Request): HeadersInit {
  return getPixelEventsCorsHeaders(request, { customHeaders: PIXEL_CUSTOM_HEADERS });
}

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

export function optionsResponse(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeadersPreBody(request),
  });
}
