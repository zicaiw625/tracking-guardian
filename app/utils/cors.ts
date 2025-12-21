import { json } from "@remix-run/node";
import { 
  isValidShopifyOrigin, 
  isValidDevOrigin, 
  isDevMode 
} from "./origin-validation";

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
} as const;

export const STATIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Shop-Domain",
  "Access-Control-Max-Age": "86400",
  ...SECURITY_HEADERS,
} as const;

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

  if (!origin) {
    return {
      ...baseSecurityHeaders,
      "Vary": "Origin",
    };
  }

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

  return {
    ...baseSecurityHeaders,
    "Vary": "Origin",
  };
}

export interface CorsResponseInit extends Omit<ResponseInit, "headers"> {
  request?: Request;
  staticCors?: boolean;
  headers?: HeadersInit;
}

export function jsonWithCors<T>(
  data: T,
  init?: CorsResponseInit
): Response {
  const { request, staticCors, headers: additionalHeaders, ...responseInit } = init || {};
  
  let corsHeaders: HeadersInit;
  if (staticCors) {
    corsHeaders = STATIC_CORS_HEADERS;
  } else if (request) {
    corsHeaders = getDynamicCorsHeaders(request);
  } else {
    corsHeaders = SECURITY_HEADERS;
  }

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
