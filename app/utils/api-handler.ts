/**
 * API Handler Utilities
 *
 * Middleware and utilities for handling API routes with consistent
 * error handling, logging, and response formatting.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "./logger.server";
import { AppError, ErrorCode, isAppError, ensureAppError } from "./errors/index";

// =============================================================================
// Types
// =============================================================================

export type ActionHandler<T = unknown> = (
  args: ActionFunctionArgs
) => Promise<T>;

export type LoaderHandler<T = unknown> = (
  args: LoaderFunctionArgs
) => Promise<T>;

export interface ApiHandlerOptions {
  /**
   * Whether to log the full error stack in production
   */
  logStack?: boolean;

  /**
   * Custom error transformer
   */
  transformError?: (error: unknown) => {
    message: string;
    status: number;
    code?: string;
  };

  /**
   * Whether to include error details in response (dev only)
   */
  includeDetails?: boolean;
}

// =============================================================================
// Error Handler
// =============================================================================

/**
 * Handle errors consistently across API routes
 */
function handleApiError(
  error: unknown,
  options: ApiHandlerOptions = {}
): Response {
  const { logStack = false, transformError, includeDetails = false } = options;

  // Ensure we have an AppError
  const appError = ensureAppError(error);

  // Log the error
  if (appError.isInternalError()) {
    logger.error(`API internal error: ${appError.message}`, appError);
  } else if (appError.isRetryable) {
    logger.warn(`API retryable error: ${appError.message}`, {
      code: appError.code,
    });
  } else {
    logger.info(`API error: ${appError.message}`, {
      code: appError.code,
    });
  }

  if (logStack && error instanceof Error) {
    logger.error(`Stack trace: ${error.stack}`);
  }

  // Transform error if custom transformer provided
  if (transformError) {
    const transformed = transformError(error);
    return json(
      {
        error: transformed.message,
        code: transformed.code,
      },
      { status: transformed.status }
    );
  }

  // Use standard error response
  const clientResponse = appError.toClientResponse();
  const statusCode = appError.getHttpStatus();

  // Build response
  const response = {
    success: false,
    error: clientResponse.message,
    code: clientResponse.code,
    ...(process.env.NODE_ENV !== "production" && includeDetails && {
      stack: error instanceof Error ? error.stack : undefined,
    }),
  };

  return json(response, { status: statusCode });
}

// =============================================================================
// Wrapper Functions
// =============================================================================

/**
 * Wrap an action handler with error handling
 *
 * @example
 * ```ts
 * export const action = withErrorHandling(async ({ request }) => {
 *   const data = await processRequest(request);
 *   return json({ success: true, data });
 * });
 * ```
 */
export function withErrorHandling<T>(
  handler: ActionHandler<T>,
  options?: ApiHandlerOptions
): ActionHandler<Response | T> {
  return async (args: ActionFunctionArgs): Promise<Response | T> => {
    try {
      return await handler(args);
    } catch (error) {
      return handleApiError(error, options);
    }
  };
}

/**
 * Wrap a loader handler with error handling
 */
export function withLoaderErrorHandling<T>(
  handler: LoaderHandler<T>,
  options?: ApiHandlerOptions
): LoaderHandler<Response | T> {
  return async (args: LoaderFunctionArgs): Promise<Response | T> => {
    try {
      return await handler(args);
    } catch (error) {
      return handleApiError(error, options);
    }
  };
}

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Parse JSON body from request with error handling
 */
export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON body");
  }
}

/**
 * Parse form data from request
 */
export async function parseFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid form data");
  }
}

/**
 * Get a required query parameter
 */
export function getRequiredQueryParam(
  url: URL,
  param: string
): string {
  const value = url.searchParams.get(param);
  if (!value) {
    throw new AppError(
      ErrorCode.VALIDATION_MISSING_FIELD,
      `Missing required parameter: ${param}`,
      false,
      { field: param }
    );
  }
  return value;
}

/**
 * Get an optional query parameter with default
 */
export function getQueryParam(
  url: URL,
  param: string,
  defaultValue: string = ""
): string {
  return url.searchParams.get(param) ?? defaultValue;
}

/**
 * Get a numeric query parameter
 */
export function getNumericQueryParam(
  url: URL,
  param: string,
  defaultValue: number
): number {
  const value = url.searchParams.get(param);
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new AppError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Invalid numeric parameter: ${param}`,
      false,
      { field: param, expected: "number" }
    );
  }
  return parsed;
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a JSON response with appropriate headers
 */
export function apiResponse<T>(
  data: T,
  init?: ResponseInit
): Response {
  return json(data, {
    ...init,
    headers: {
      ...init?.headers,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create a no-content response
 */
export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Create a created response
 */
export function createdResponse<T>(data: T): Response {
  return json(data, { status: 201 });
}

/**
 * Create an accepted response (for async operations)
 */
export function acceptedResponse<T>(data?: T): Response {
  return data ? json(data, { status: 202 }) : new Response(null, { status: 202 });
}

