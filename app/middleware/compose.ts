import type {
  Middleware,
  MiddlewareContext,
  ApiHandlerConfig,
} from "./types";
import { createContext } from "./types";
import { buildErrorResponse } from "./error-handler";
import { logger } from "../utils/logger.server";
import { ensureAppError } from "../utils/errors";

export { withCors, withPixelCors } from "./cors";
export { withRateLimit, standardRateLimit, strictRateLimit, webhookRateLimit } from "./rate-limit";
export { withValidation } from "./validation";
export { createContext } from "./types";

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

export function createApiHandler<T = unknown>(
  config: ApiHandlerConfig<T>
): (args: { request: Request }) => Promise<Response> {
  const { middleware = [], handler, postMiddleware = [] } = config;

  return async ({ request }) => {
    const context = createContext(request);

    try {

      const middlewareResult = await runMiddleware(middleware, context);

      if ("response" in middlewareResult) {
        return middlewareResult.response;
      }

      const finalContext = middlewareResult.context;

      let response: Response;
      const handlerResult = await handler(finalContext);

      if (handlerResult instanceof Response) {
        response = handlerResult;
      } else {

        const corsHeaders =
          (finalContext.meta.corsHeaders as Record<string, string>) || {};
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", "application/json");

        response = new Response(JSON.stringify(handlerResult), {
          status: 200,
          headers,
        });
      }

      for (const postMw of postMiddleware) {
        response = postMw(response, finalContext);
      }

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

export function createApiLoader<T = unknown>(
  config: Omit<ApiHandlerConfig<T>, "postMiddleware">
): (args: { request: Request }) => Promise<Response> {
  return createApiHandler(config);
}
