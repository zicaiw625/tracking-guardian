/**
 * Request Context Middleware
 *
 * Provides request context management and propagation for Remix routes.
 * Integrates with the DI container's request context system.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  container,
  createRequestContext,
  withRequestContextAsync,
  getRequestElapsedMs,
  type IScopedContext,
  type IRequestContext,
} from "../container";

// =============================================================================
// Types
// =============================================================================

/**
 * Handler function with scoped context
 */
export type ContextHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs,
  ctx: IScopedContext
) => Promise<T>;

/**
 * Simple handler function with request only
 */
export type RequestHandler<T> = (request: Request) => Promise<T>;

/**
 * Options for context middleware
 */
export interface ContextMiddlewareOptions {
  /** Log request start/end */
  logRequests?: boolean;
  /** Extract shop domain from request */
  extractShopDomain?: (request: Request) => string | undefined;
  /** Additional context fields */
  additionalContext?: Record<string, unknown>;
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Wrap a loader or action handler with request context
 *
 * This middleware:
 * 1. Creates a request context from the incoming request
 * 2. Sets up AsyncLocalStorage for context propagation
 * 3. Creates a scoped DI context
 * 4. Provides timing and logging
 *
 * @example
 * ```typescript
 * export const loader = withContext(async (args, ctx) => {
 *   ctx.requestLogger.info("Loading data");
 *   const shop = await ctx.db.shop.findUnique({ ... });
 *   return json({ shop });
 * });
 * ```
 */
export function withContext<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<T> {
  return async (args) => {
    const { request } = args;
    const requestCtx = createRequestContext(request);

    // Add additional context if provided
    if (options?.additionalContext) {
      Object.assign(requestCtx, options.additionalContext);
    }

    // Extract shop domain if provided
    if (options?.extractShopDomain) {
      const shopDomain = options.extractShopDomain(request);
      if (shopDomain) {
        requestCtx.shopDomain = shopDomain;
      }
    }

    return withRequestContextAsync(requestCtx, async () => {
      const scopedCtx = container.createScopedContext(requestCtx);

      // Log request start
      if (options?.logRequests !== false) {
        const url = new URL(request.url);
        scopedCtx.requestLogger.debug("Request started", {
          method: request.method,
          path: url.pathname,
        });
      }

      try {
        const result = await handler(args, scopedCtx);

        // Log request completion
        if (options?.logRequests !== false) {
          scopedCtx.requestLogger.debug("Request completed", {
            durationMs: getRequestElapsedMs(requestCtx),
          });
        }

        return result;
      } catch (error) {
        // Log request failure
        if (options?.logRequests !== false) {
          scopedCtx.requestLogger.error("Request failed", error, {
            durationMs: getRequestElapsedMs(requestCtx),
          });
        }
        throw error;
      }
    });
  };
}

/**
 * Simple request wrapper without full args
 *
 * @example
 * ```typescript
 * export const loader = withRequest(async (request) => {
 *   // Simple request handling
 *   return json({ ok: true });
 * });
 * ```
 */
export function withRequest<T>(
  handler: RequestHandler<T>
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<T> {
  return async ({ request }) => {
    return handler(request);
  };
}

/**
 * Create a loader with context
 */
export function createLoader<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: LoaderFunctionArgs) => Promise<T> {
  return withContext(handler, options);
}

/**
 * Create an action with context
 */
export function createAction<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: ActionFunctionArgs) => Promise<T> {
  return withContext(handler, options);
}

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Extract shop domain from request URL or headers
 */
export function extractShopDomainFromRequest(request: Request): string | undefined {
  // Try URL parameter
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  if (shopParam) {
    return shopParam;
  }

  // Try header
  const shopHeader = request.headers.get("X-Shop-Domain");
  if (shopHeader) {
    return shopHeader;
  }

  return undefined;
}

/**
 * Create context options with shop domain extraction
 */
export function withShopDomain(): ContextMiddlewareOptions {
  return {
    extractShopDomain: extractShopDomainFromRequest,
    logRequests: true,
  };
}

// =============================================================================
// Request Info Extraction
// =============================================================================

/**
 * Get client IP from request
 */
export function getClientIp(request: Request): string | undefined {
  // Check common headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return undefined;
}

/**
 * Get user agent from request
 */
export function getUserAgent(request: Request): string | undefined {
  return request.headers.get("user-agent") ?? undefined;
}

/**
 * Get request info for logging
 */
export function getRequestInfo(request: Request): {
  method: string;
  path: string;
  clientIp?: string;
  userAgent?: string;
} {
  const url = new URL(request.url);
  return {
    method: request.method,
    path: url.pathname,
    clientIp: getClientIp(request),
    userAgent: getUserAgent(request),
  };
}

