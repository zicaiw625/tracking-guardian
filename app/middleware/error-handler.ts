/**
 * Error Handler Middleware
 *
 * Provides standardized error handling for Remix routes.
 */

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  AppError,
  ErrorCode,
  ensureAppError,
  type ApiErrorResponse,
} from "../utils/errors";
import { logger } from "../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

/**
 * Handler function type
 */
export type RouteHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs
) => Promise<T>;

/**
 * Error handler options
 */
export interface ErrorHandlerOptions {
  /** Log all errors */
  logErrors?: boolean;
  /** Include stack traces in development */
  includeStackInDev?: boolean;
  /** Custom error transformer */
  transformError?: (error: AppError) => AppError;
  /** Custom response builder */
  buildResponse?: (error: AppError) => Response;
}

// =============================================================================
// Error Handler Middleware
// =============================================================================

/**
 * Wrap a handler with error handling
 *
 * This middleware catches all errors and converts them to
 * standardized JSON error responses.
 *
 * @example
 * ```typescript
 * export const loader = withErrorHandling(async ({ request }) => {
 *   const shop = await getShop(request);
 *   if (!shop) {
 *     throw AppError.notFound("Shop", "unknown");
 *   }
 *   return json({ shop });
 * });
 * ```
 */
export function withErrorHandling<T>(
  handler: RouteHandler<T>,
  options?: ErrorHandlerOptions
): RouteHandler<T | Response> {
  const opts = {
    logErrors: true,
    includeStackInDev: true,
    ...options,
  };

  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      // If already a Response, just rethrow (e.g., from throwErrorResponse)
      if (error instanceof Response) {
        throw error;
      }

      // Convert to AppError
      let appError = ensureAppError(error);

      // Apply custom transformation
      if (opts.transformError) {
        appError = opts.transformError(appError);
      }

      // Log the error
      if (opts.logErrors) {
        logError(appError, args.request);
      }

      // Build response
      if (opts.buildResponse) {
        return opts.buildResponse(appError);
      }

      return buildErrorResponse(appError, opts.includeStackInDev);
    }
  };
}

/**
 * Wrap an async function with error handling (for use in loaders/actions)
 */
export async function handleErrors<T>(
  fn: () => Promise<T>,
  options?: ErrorHandlerOptions
): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    let appError = ensureAppError(error);

    if (options?.transformError) {
      appError = options.transformError(appError);
    }

    if (options?.logErrors !== false) {
      logger.error("Unhandled error", appError, {
        code: appError.code,
        isRetryable: appError.isRetryable,
      });
    }

    return buildErrorResponse(appError, options?.includeStackInDev);
  }
}

// =============================================================================
// Error Response Building
// =============================================================================

/**
 * Build a JSON error response from an AppError
 */
export function buildErrorResponse(
  error: AppError,
  includeStackInDev?: boolean
): Response {
  const status = error.getHttpStatus();
  const clientResponse = error.toClientResponse();

  const errorDetails: ApiErrorResponse["error"] = {
    code: clientResponse.code,
    message: clientResponse.message,
  };

  if (error.metadata.field) {
    errorDetails.field = String(error.metadata.field);
  }

  if (error.metadata.retryAfter) {
    errorDetails.retryAfter = Number(error.metadata.retryAfter);
  }

  const body: ApiErrorResponse & { stack?: string } = {
    success: false,
    error: errorDetails,
  };

  // Include stack in development
  if (
    includeStackInDev &&
    process.env.NODE_ENV !== "production" &&
    error.stack
  ) {
    body.stack = error.stack;
  }

  // Add retry headers for rate limiting
  const headers = new Headers();
  if (error.metadata.retryAfter && status === 429) {
    headers.set(
      "Retry-After",
      String(Math.ceil(Number(error.metadata.retryAfter) / 1000))
    );
  }

  return json(body, { status, headers });
}

/**
 * Log an error with request context
 */
function logError(error: AppError, request: Request): void {
  const url = new URL(request.url);

  if (error.isInternalError()) {
    // Log internal errors with full details
    logger.error(`[${error.code}] ${error.message}`, error, {
      path: url.pathname,
      method: request.method,
      metadata: error.metadata,
    });
  } else {
    // Log client errors at warn level
    logger.warn(`[${error.code}] ${error.message}`, {
      path: url.pathname,
      method: request.method,
      code: error.code,
    });
  }
}

// =============================================================================
// Error Throwing Utilities
// =============================================================================

/**
 * Throw a standardized error response
 *
 * Use this to trigger Remix's error handling with a proper response.
 */
export function throwError(error: AppError): never {
  throw buildErrorResponse(error);
}

/**
 * Throw a 400 Bad Request error
 */
export function throwBadRequest(message: string, field?: string): never {
  throw buildErrorResponse(
    new AppError(ErrorCode.VALIDATION_ERROR, message, false, { field })
  );
}

/**
 * Throw a 401 Unauthorized error
 */
export function throwUnauthorized(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.AUTH_INVALID_TOKEN,
      message ?? "Authentication required"
    )
  );
}

/**
 * Throw a 403 Forbidden error
 */
export function throwForbidden(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
      message ?? "Access denied"
    )
  );
}

/**
 * Throw a 404 Not Found error
 */
export function throwNotFound(resource: string, id?: string): never {
  const message = id
    ? `${resource} '${id}' not found`
    : `${resource} not found`;
  throw buildErrorResponse(
    new AppError(ErrorCode.NOT_FOUND_RESOURCE, message, false, {
      resource,
      resourceId: id,
    })
  );
}

/**
 * Throw a 429 Too Many Requests error
 */
export function throwRateLimited(retryAfter?: number): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.BILLING_LIMIT_EXCEEDED,
      "Rate limit exceeded",
      false,
      { retryAfter }
    )
  );
}

/**
 * Throw a 500 Internal Server Error
 */
export function throwInternalError(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.INTERNAL_ERROR,
      message ?? "An internal error occurred"
    )
  );
}

// =============================================================================
// Conditional Throws
// =============================================================================

/**
 * Throw if condition is true
 */
export function throwIf(condition: boolean, error: AppError): void {
  if (condition) {
    throwError(error);
  }
}

/**
 * Throw if value is null or undefined
 */
export function throwIfNull<T>(
  value: T | null | undefined,
  error: AppError
): asserts value is T {
  if (value === null || value === undefined) {
    throwError(error);
  }
}

/**
 * Throw not found if value is null
 */
export function throwIfNotFound<T>(
  value: T | null | undefined,
  resource: string,
  id?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throwNotFound(resource, id);
  }
}
