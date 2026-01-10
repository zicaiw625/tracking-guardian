import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  container,
  createRequestContext,
  withRequestContextAsync,
  getRequestElapsedMs,
  type IScopedContext,
  type IRequestContext,
} from "../container";

export type ContextHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs,
  ctx: IScopedContext
) => Promise<T>;

export type RequestHandler<T> = (request: Request) => Promise<T>;

export interface ContextMiddlewareOptions {
  logRequests?: boolean;
  extractShopDomain?: (request: Request) => string | undefined;
  additionalContext?: Record<string, unknown>;
}

export function withContext<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<T> {
  return async (args) => {
    const { request } = args;
    const requestCtx = createRequestContext(request);
    if (options?.additionalContext) {
      Object.assign(requestCtx, options.additionalContext);
    }
    if (options?.extractShopDomain) {
      const shopDomain = options.extractShopDomain(request);
      if (shopDomain) {
        requestCtx.shopDomain = shopDomain;
      }
    }
    return withRequestContextAsync(requestCtx, async () => {
      const scopedCtx = container.createScopedContext(requestCtx);
      if (options?.logRequests !== false) {
        const url = new URL(request.url);
        scopedCtx.requestLogger.debug("Request started", {
          method: request.method,
          path: url.pathname,
        });
      }
      try {
        const result = await handler(args, scopedCtx);
        if (options?.logRequests !== false) {
          scopedCtx.requestLogger.debug("Request completed", {
            durationMs: getRequestElapsedMs(requestCtx),
          });
        }
        return result;
      } catch (error) {
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

export function withRequest<T>(
  handler: RequestHandler<T>
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<T> {
  return async ({ request }) => {
    return handler(request);
  };
}

export function createLoader<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: LoaderFunctionArgs) => Promise<T> {
  return withContext(handler, options);
}

export function createAction<T>(
  handler: ContextHandler<T>,
  options?: ContextMiddlewareOptions
): (args: ActionFunctionArgs) => Promise<T> {
  return withContext(handler, options);
}

export function extractShopDomainFromRequest(request: Request): string | undefined {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  if (shopParam) {
    return shopParam;
  }
  const shopHeader = request.headers.get("X-Shop-Domain");
  if (shopHeader) {
    return shopHeader;
  }
  return undefined;
}

export function withShopDomain(): ContextMiddlewareOptions {
  return {
    extractShopDomain: extractShopDomainFromRequest,
    logRequests: true,
  };
}
