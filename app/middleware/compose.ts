/**
 * Middleware Composition
 *
 * Provides utilities for composing middleware and creating API handlers.
 */

import type {
  Middleware,
  MiddlewareContext,
  ApiHandlerConfig,
} from "./types";
import { createContext } from "./types";
import { buildErrorResponse } from "./error-handler";
import { logger } from "../utils/logger.server";
import { ensureAppError } from "../utils/errors";

// Note: These imports are for re-export only, not used directly in this file.
// They are re-exported so routes can import from a single location.
export { withCors, withPixelCors } from "./cors";
export { withRateLimit, standardRateLimit, strictRateLimit, webhookRateLimit } from "./rate-limit";
export { withValidation } from "./validation";
export { createContext } from "./types";

// =============================================================================
// Middleware Composition
// =============================================================================

/**
 * Compose multiple middleware into a single middleware
 */
export function composeMiddleware(...middleware: Middleware[]): Middleware {
  return async (context: MiddlewareContext) => {
    for (const mw of middleware) {
      const result = await mw(context);
      if (!result.continue) {
        return result;
      }
      context = result.context;
    }
    return { continue: true, context };
  };
}

/**
 * Run middleware chain and return final context or response
 */
async function runMiddleware(
  middleware: Middleware[],
  context: MiddlewareContext
): Promise<{ context: MiddlewareContext } | { response: Response }> {
  for (const mw of middleware) {
    const result = await mw(context);
    if (!result.continue) {
      return { response: result.response };
    }
    context = result.context;
  }
  return { context };
}

// =============================================================================
// API Handler Factory
// =============================================================================

/**
 * Create an API action handler with middleware support
 */
export function createApiHandler<T = unknown>(
  config: ApiHandlerConfig<T>
): (args: { request: Request }) => Promise<Response> {
  const { middleware = [], handler, postMiddleware = [] } = config;

  return async ({ request }) => {
    const context = createContext(request);

    try {
      // Run pre-middleware
      const middlewareResult = await runMiddleware(middleware, context);

      if ("response" in middlewareResult) {
        return middlewareResult.response;
      }

      const finalContext = middlewareResult.context;

      // Run handler
      let response: Response;
      const handlerResult = await handler(finalContext);

      if (handlerResult instanceof Response) {
        response = handlerResult;
      } else {
        // Convert non-Response result to JSON response
        const corsHeaders =
          (finalContext.meta.corsHeaders as Record<string, string>) || {};
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/json");

        response = new Response(JSON.stringify(handlerResult), {
          status: 200,
          headers,
        });
      }

      // Run post-middleware
      for (const postMw of postMiddleware) {
        response = postMw(response, finalContext);
      }

      // Log request completion
      const duration = Date.now() - context.startTime;
      if (duration > 1000) {
        logger.warn("Slow request", {
          path: new URL(request.url).pathname,
          duration,
          shopDomain: finalContext.shopDomain,
        });
      }

      return response;
    } catch (error) {
      const appError = ensureAppError(error);
      return buildErrorResponse(appError);
    }
  };
}

/**
 * Create an API loader handler with middleware support
 */
export function createApiLoader<T = unknown>(
  config: Omit<ApiHandlerConfig<T>, "postMiddleware">
): (args: { request: Request }) => Promise<Response> {
  return createApiHandler(config);
}

// =============================================================================
// Note: Middleware composition helpers have been simplified.
// Use withCors, withPixelCors, withRateLimit, and withValidation directly
// for building custom middleware stacks in your routes.
// =============================================================================
