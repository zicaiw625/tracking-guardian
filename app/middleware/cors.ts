import type { Middleware, MiddlewareContext, CorsOptions } from "./types";
import { getPixelEventsCorsHeaders, SECURITY_HEADERS } from "../utils/cors";
import { isValidShopifyOrigin, isValidDevOrigin, isDevMode, extractOriginHost } from "../utils/origin-validation.server";


const DEFAULT_CORS_OPTIONS: Required<CorsOptions> = {
  origin: (origin: string | null) => {
    if (!origin || origin === "null") {
      return null;
    }
    if (isValidShopifyOrigin(origin)) {
      return origin;
    }
    if (isDevMode() && isValidDevOrigin(origin)) {
      return origin;
    }
    return null;
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Shopify-Shop-Domain"],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400,
  customHeaders: [],
};

export function buildCorsHeaders(
  request: Request,
  options: CorsOptions = {}
): Record<string, string> {
  const opts = { ...DEFAULT_CORS_OPTIONS, ...options };
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {};
  let allowedOrigin: string | null = null;
  if (typeof opts.origin === "function") {
    allowedOrigin = opts.origin(origin);
  } else if (Array.isArray(opts.origin)) {
    if (origin && opts.origin.includes(origin)) {
      allowedOrigin = origin;
    }
  } else if (opts.origin === "*") {
    if (isDevMode()) {
      allowedOrigin = "*";
    } else {
      allowedOrigin = null;
    }
  } else if (typeof opts.origin === "string") {
    allowedOrigin = opts.origin;
  }
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  if (typeof opts.origin === "function" || Array.isArray(opts.origin)) {
    headers["Vary"] = "Origin";
  }
  if (opts.methods.length > 0) {
    headers["Access-Control-Allow-Methods"] = opts.methods.join(", ");
  }
  const allHeaders = [...opts.allowedHeaders, ...opts.customHeaders];
  if (allHeaders.length > 0) {
    headers["Access-Control-Allow-Headers"] = allHeaders.join(", ");
  }
  if (opts.exposedHeaders.length > 0) {
    headers["Access-Control-Expose-Headers"] = opts.exposedHeaders.join(", ");
  }
  if (opts.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  if (opts.maxAge > 0) {
    headers["Access-Control-Max-Age"] = String(opts.maxAge);
  }
  Object.assign(headers, SECURITY_HEADERS);
  return headers;
}

export function applyCorsHeaders(
  response: Response,
  headers: Record<string, string>
): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export function withCors(options: CorsOptions = {}): Middleware {
  return async (context: MiddlewareContext) => {
    const { request } = context;
    const corsHeaders = buildCorsHeaders(request, options);
    if (request.method === "OPTIONS") {
      return {
        continue: false,
        response: new Response(null, {
          status: 204,
          headers: corsHeaders,
        }),
      };
    }
    context.meta.corsHeaders = corsHeaders;
    return { continue: true, context };
  };
}

export function withPixelCors(customHeaders: string[] = []): Middleware {
  return async (context: MiddlewareContext) => {
    const { request } = context;
    const corsHeaders = getPixelEventsCorsHeaders(request, {
      customHeaders,
    });
    if (request.method === "OPTIONS") {
      return {
        continue: false,
        response: new Response(null, {
          status: 204,
          headers: corsHeaders,
        }),
      };
    }
    context.meta.corsHeaders = corsHeaders;
    return { continue: true, context };
  };
}

export function withShopCors(
  allowedDomains: string[],
  customHeaders: string[] = []
): Middleware {
  return async (context: MiddlewareContext) => {
    const { request } = context;
    const origin = request.headers.get("Origin");
    const corsHeaders: Record<string, string> = {
      ...SECURITY_HEADERS,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": ["Content-Type", "X-Shopify-Shop-Domain", ...customHeaders].join(", "),
      "Access-Control-Max-Age": "3600",
      "Vary": "Origin",
    };
    if (origin && origin !== "null") {
      const originHost = extractOriginHost(origin);
      if (originHost) {
        const isAllowed = allowedDomains.some(domain => {
          const normalizedDomain = domain.toLowerCase();
          return originHost === normalizedDomain || originHost.endsWith(`.${normalizedDomain}`);
        });
        if (isAllowed) {
          corsHeaders["Access-Control-Allow-Origin"] = origin;
        } else if (isValidShopifyOrigin(origin)) {
          corsHeaders["Access-Control-Allow-Origin"] = origin;
        } else if (isDevMode() && isValidDevOrigin(origin)) {
          corsHeaders["Access-Control-Allow-Origin"] = origin;
        }
      }
    }
    if (request.method === "OPTIONS") {
      return {
        continue: false,
        response: new Response(null, {
          status: 204,
          headers: corsHeaders,
        }),
      };
    }
    context.meta.corsHeaders = corsHeaders;
    return { continue: true, context };
  };
}

export function jsonWithCors<T>(
  data: T,
  context: MiddlewareContext,
  init?: ResponseInit
): Response {
  const corsHeaders = (context.meta.corsHeaders as Record<string, string>) || {};
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}
