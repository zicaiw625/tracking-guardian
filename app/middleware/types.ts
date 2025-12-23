/**
 * Middleware Types
 *
 * Core type definitions for the middleware system.
 */

// =============================================================================
// Context Types
// =============================================================================

/**
 * Context passed through middleware chain
 */
export interface MiddlewareContext {
  /** The original request */
  request: Request;

  /** Parsed request body (populated by validation middleware) */
  body?: unknown;

  /** Shop domain from headers or body */
  shopDomain?: string;

  /** Client IP address */
  clientIp?: string;

  /** Request start time for timing */
  startTime: number;

  /** Additional metadata */
  meta: Record<string, unknown>;
}

/**
 * Result of middleware execution
 */
export type MiddlewareResult =
  | { continue: true; context: MiddlewareContext }
  | { continue: false; response: Response };

/**
 * Middleware function signature
 */
export type Middleware = (
  context: MiddlewareContext
) => Promise<MiddlewareResult>;

// =============================================================================
// Handler Types
// =============================================================================

/**
 * Final handler function that produces the response
 */
export type Handler<T = unknown> = (
  context: MiddlewareContext
) => Promise<T | Response>;

/**
 * Configuration for API handler
 */
export interface ApiHandlerConfig<T = unknown> {
  /** Middleware to apply before handler */
  middleware?: Middleware[];

  /** The main handler function */
  handler: Handler<T>;

  /** Post-processing middleware (e.g., for adding headers) */
  postMiddleware?: Array<(response: Response, context: MiddlewareContext) => Response>;
}

// =============================================================================
// Common Response Types
// =============================================================================

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

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Options for CORS middleware
 */
export interface CorsOptions {
  /** Allowed origins (string or function) */
  origin?: string | string[] | ((origin: string | null) => string | null);

  /** Allowed methods */
  methods?: string[];

  /** Allowed headers */
  allowedHeaders?: string[];

  /** Exposed headers */
  exposedHeaders?: string[];

  /** Allow credentials */
  credentials?: boolean;

  /** Max age for preflight cache */
  maxAge?: number;

  /** Custom headers to add */
  customHeaders?: string[];
}

/**
 * Options for rate limit middleware
 */
export interface RateLimitOptions {
  /** Endpoint name for rate limit config */
  endpoint: string;

  /** Override max requests */
  maxRequests?: number;

  /** Override window in milliseconds */
  windowMs?: number;
}

/**
 * Options for validation middleware
 */
export interface ValidationOptions<T = unknown> {
  /** Zod schema for body validation */
  schema?: import("zod").ZodType<T>;

  /** Maximum body size in bytes */
  maxBodySize?: number;

  /** Required content type */
  contentType?: string;

  /** Custom validation function */
  validate?: (body: unknown) => T | Promise<T>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a context from a request
 */
export function createContext(request: Request): MiddlewareContext {
  return {
    request,
    startTime: Date.now(),
    meta: {},
  };
}

/**
 * Extract client IP from request headers
 */
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

/**
 * Extract shop domain from request
 */
export function extractShopDomain(request: Request): string | undefined {
  return request.headers.get("x-shopify-shop-domain") ?? undefined;
}

