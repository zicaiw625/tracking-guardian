export interface MiddlewareContext {
  request: Request;
  body?: unknown;
  shopDomain?: string;
  clientIp?: string;
  startTime: number;
  meta: Record<string, unknown>;
}

export type MiddlewareResult =
  | { continue: true; context: MiddlewareContext }
  | { continue: false; response: Response };

export type Middleware = (
  context: MiddlewareContext
) => Promise<MiddlewareResult>;

export type Handler<T = unknown> = (
  context: MiddlewareContext
) => Promise<T | Response>;

export interface ApiHandlerConfig<T = unknown> {
  middleware?: Middleware[];
  handler: Handler<T>;
  postMiddleware?: Array<(response: Response, context: MiddlewareContext) => Response>;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
  retryAfter?: number;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface CorsOptions {
  origin?: string | string[] | ((origin: string | null) => string | null);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  customHeaders?: string[];
}

export interface RateLimitOptions {
  endpoint: string;
  maxRequests?: number;
  windowMs?: number;
}

export interface ValidationOptions<T = unknown> {
  schema?: import("zod").ZodType<T>;
  maxBodySize?: number;
  contentType?: string;
  validate?: (body: unknown) => T | Promise<T>;
}

export function createContext(request: Request): MiddlewareContext {
  return {
    request,
    startTime: Date.now(),
    meta: {},
  };
}

export function extractClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function extractShopDomain(request: Request): string | undefined {
  return request.headers.get("x-shopify-shop-domain") ?? undefined;
}
