

import type { Middleware, MiddlewareContext, CorsOptions } from "./types";

const DEFAULT_CORS_OPTIONS: Required<CorsOptions> = {
  origin: "*",
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
    allowedOrigin = "*";
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
  return withCors({
    origin: (origin) => {

      if (!origin) return null;
      if (origin.startsWith("https:

      if (origin.startsWith("http:
      return null;
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Shopify-Shop-Domain",
      "X-Tracking-Guardian-Key",
      "X-Tracking-Guardian-Timestamp",
      ...customHeaders,
    ],
    exposedHeaders: ["X-RateLimit-Remaining", "X-RateLimit-Reset"],
    credentials: false,
    maxAge: 3600,
  });
}

export function withShopCors(
  allowedDomains: string[],
  customHeaders: string[] = []
): Middleware {
  return withCors({
    origin: (origin) => {
      if (!origin) return null;

      try {
        const originUrl = new URL(origin);
        if (allowedDomains.includes(originUrl.host)) {
          return origin;
        }
      } catch {

      }

      return null;
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "X-Shopify-Shop-Domain",
      ...customHeaders,
    ],
    credentials: false,
    maxAge: 3600,
  });
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

