import {
  getPixelEventsCorsHeaders,
  getPixelEventsCorsHeadersForShop,
  jsonWithCors as jsonWithCorsBase,
} from "../../utils/cors";
import { PIXEL_INGESTION_HEADERS } from "../../utils/security-headers";


export const PIXEL_CUSTOM_HEADERS = [
  "X-Tracking-Guardian-Timestamp",
  "X-Tracking-Guardian-Signature",
];

export function getCorsHeadersPreBody(request: Request): HeadersInit {
  const corsHeaders = getPixelEventsCorsHeaders(request, { customHeaders: PIXEL_CUSTOM_HEADERS });
  return {
    ...PIXEL_INGESTION_HEADERS,
    ...corsHeaders,
  };
}

export function getCorsHeadersForShop(
  request: Request,
  shopAllowedDomains: string[]
): HeadersInit {
  const corsHeaders = getPixelEventsCorsHeadersForShop(
    request,
    shopAllowedDomains,
    PIXEL_CUSTOM_HEADERS
  );
  return {
    ...PIXEL_INGESTION_HEADERS,
    ...corsHeaders,
  };
}

export function jsonWithCors<T>(
  data: T,
  init: ResponseInit & {
    request: Request;
    shopAllowedDomains?: string[];
    requestId?: string;
  }
): Response {
  const { request, shopAllowedDomains, requestId, ...responseInit } = init;
  const corsHeaders = shopAllowedDomains
    ? getCorsHeadersForShop(request, shopAllowedDomains)
    : getCorsHeadersPreBody(request);
  const headers: HeadersInit = {
    ...(responseInit.headers as HeadersInit | undefined),
    ...corsHeaders,
  };
  if (requestId) {
    const headersObj = headers as Record<string, string>;
    headersObj["X-Request-Id"] = requestId;
  }
  return jsonWithCorsBase(data, {
    ...responseInit,
    request,
    headers,
  });
}

export function emptyResponseWithCors(
  request: Request,
  shopAllowedDomains?: string[],
  requestId?: string
): Response {
  const headers = shopAllowedDomains
    ? getCorsHeadersForShop(request, shopAllowedDomains)
    : getCorsHeadersPreBody(request);
  if (requestId) {
    (headers as Record<string, string>)["X-Request-Id"] = requestId;
  }
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
