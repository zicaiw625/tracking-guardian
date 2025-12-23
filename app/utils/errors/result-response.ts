/**
 * Result to HTTP Response Utilities
 *
 * Bridge between the Result type system and HTTP responses.
 * Provides utilities for converting Results to Remix responses.
 */

import { json } from "@remix-run/node";
import type { Result, AsyncResult } from "../../types/result";
import { isOk, isErr, err } from "../../types/result";
import { AppError, ErrorCode, type ErrorCodeType, ensureAppError, type ErrorMetadata } from "./app-error";
import { logger } from "../logger.server";

// =============================================================================
// Response Types
// =============================================================================

/**
 * Standard API success response structure
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/**
 * Standard API error response structure
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    field?: string;
    retryAfter?: number;
  };
}

/**
 * Combined API response type
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// =============================================================================
// Result to Response Conversion
// =============================================================================

/**
 * Convert a Result to a JSON response.
 *
 * On success: Returns 200 with { success: true, data: T }
 * On error: Returns appropriate HTTP status with { success: false, error: {...} }
 *
 * @example
 * ```typescript
 * export const loader = async ({ request }: LoaderFunctionArgs) => {
 *   const result = await someService.getData();
 *   return resultToResponse(result);
 * };
 * ```
 */
export function resultToResponse<T>(
  result: Result<T, AppError>,
  options?: {
    /** Override the success status code (default: 200) */
    successStatus?: number;
    /** Custom response headers */
    headers?: HeadersInit;
    /** Transform the data before sending */
    transform?: (data: T) => unknown;
  }
): Response {
  const headers = options?.headers;
  const successStatus = options?.successStatus ?? 200;

  if (isOk(result)) {
    const data = options?.transform
      ? options.transform(result.value)
      : result.value;

    return json<ApiSuccessResponse<typeof data>>(
      { success: true, data },
      { status: successStatus, headers }
    );
  }

  return errorToResponse(result.error, { headers });
}

/**
 * Convert an AppError to a JSON response
 */
export function errorToResponse(
  error: AppError,
  options?: { headers?: HeadersInit }
): Response {
  const status = error.getHttpStatus();
  const clientResponse = error.toClientResponse();

  // Log error for internal errors
  if (error.isInternalError()) {
    logger.error("Internal error in response", error, {
      code: error.code,
      metadata: error.metadata,
    });
  }

  // Build error response
  const errorDetail: ApiErrorResponse["error"] = {
    code: clientResponse.code,
    message: clientResponse.message,
  };

  if (error.metadata.field) {
    errorDetail.field = String(error.metadata.field);
  }

  if (error.metadata.retryAfter) {
    errorDetail.retryAfter = Number(error.metadata.retryAfter);
  }

  const response: ApiErrorResponse = {
    success: false,
    error: errorDetail,
  };

  // Add Retry-After header for rate limited responses
  const headers = new Headers(options?.headers);
  if (error.metadata.retryAfter && status === 429) {
    headers.set("Retry-After", String(Math.ceil(Number(error.metadata.retryAfter) / 1000)));
  }

  return json(response, { status, headers });
}

/**
 * Async version of resultToResponse
 *
 * @example
 * ```typescript
 * export const loader = async ({ request }: LoaderFunctionArgs) => {
 *   return asyncResultToResponse(
 *     someService.getData()
 *   );
 * };
 * ```
 */
export async function asyncResultToResponse<T>(
  resultPromise: AsyncResult<T, AppError>,
  options?: Parameters<typeof resultToResponse<T>>[1]
): Promise<Response> {
  const result = await resultPromise;
  return resultToResponse(result, options);
}

// =============================================================================
// Action Handler Utilities
// =============================================================================

/**
 * Options for action handlers
 */
export interface ActionHandlerOptions<T> {
  /** Override success status code (default: 200) */
  successStatus?: number;
  /** Custom response headers */
  headers?: HeadersInit;
  /** Transform success data before response */
  transform?: (data: T) => unknown;
  /** Error handler for logging/metrics */
  onError?: (error: AppError) => void;
}

/**
 * Wrap an action handler that returns Result
 *
 * @example
 * ```typescript
 * export const action = wrapAction(async ({ request }) => {
 *   const formData = await request.formData();
 *   return myService.processAction(formData);
 * });
 * ```
 */
export function wrapAction<T>(
  handler: (args: { request: Request }) => AsyncResult<T, AppError>,
  options?: ActionHandlerOptions<T>
): (args: { request: Request }) => Promise<Response> {
  return async ({ request }) => {
    try {
      const result = await handler({ request });
      
      if (isErr(result) && options?.onError) {
        options.onError(result.error);
      }
      
      return resultToResponse(result, options);
    } catch (error) {
      const appError = ensureAppError(error);
      
      if (options?.onError) {
        options.onError(appError);
      }
      
      logger.error("Unhandled error in action", error);
      return errorToResponse(appError, { headers: options?.headers });
    }
  };
}

/**
 * Wrap a loader handler that returns Result
 *
 * @example
 * ```typescript
 * export const loader = wrapLoader(async ({ request }) => {
 *   return myService.loadData(request);
 * });
 * ```
 */
export function wrapLoader<T>(
  handler: (args: { request: Request }) => AsyncResult<T, AppError>,
  options?: ActionHandlerOptions<T>
): (args: { request: Request }) => Promise<Response> {
  return wrapAction(handler, options);
}

// =============================================================================
// Error Throwing Utilities
// =============================================================================

/**
 * Throw a Response for Remix error boundaries
 *
 * Use this when you need to trigger Remix's error boundary.
 *
 * @example
 * ```typescript
 * if (!shop) {
 *   throwErrorResponse(AppError.notFound("Shop", shopDomain));
 * }
 * ```
 */
export function throwErrorResponse(error: AppError): never {
  throw errorToResponse(error);
}

/**
 * Convert Result to data or throw response
 *
 * Useful for loaders that want to use error boundaries.
 *
 * @example
 * ```typescript
 * const data = await unwrapOrThrow(myService.loadData());
 * return json(data);
 * ```
 */
export async function unwrapOrThrow<T>(
  resultPromise: AsyncResult<T, AppError>
): Promise<T> {
  const result = await resultPromise;
  
  if (isOk(result)) {
    return result.value;
  }
  
  throw errorToResponse(result.error);
}

/**
 * Synchronous version of unwrapOrThrow
 */
export function unwrapOrThrowSync<T>(result: Result<T, AppError>): T {
  if (isOk(result)) {
    return result.value;
  }
  
  throw errorToResponse(result.error);
}

// =============================================================================
// Result Conversion Utilities
// =============================================================================

/**
 * Convert a thrown error into a Result
 *
 * @example
 * ```typescript
 * const result = await tryCatch(
 *   async () => {
 *     const data = await riskyOperation();
 *     return data;
 *   },
 *   ErrorCode.INTERNAL_ERROR
 * );
 * ```
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  defaultCode: ErrorCodeType = ErrorCode.INTERNAL_ERROR
): AsyncResult<T, AppError> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return err(ensureAppError(error, defaultCode));
  }
}

/**
 * Synchronous version of tryCatch
 */
export function tryCatchSync<T>(
  fn: () => T,
  defaultCode: ErrorCodeType = ErrorCode.INTERNAL_ERROR
): Result<T, AppError> {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (error) {
    return err(ensureAppError(error, defaultCode));
  }
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Create a validation error Result
 */
export function validationError(
  field: string,
  message: string
): Result<never, AppError> {
  return err(
    new AppError(
      ErrorCode.VALIDATION_ERROR,
      `${field}: ${message}`,
      false,
      { field }
    )
  );
}

/**
 * Validate required field, returning Result
 */
export function requireField<T>(
  value: T | null | undefined,
  fieldName: string
): Result<T, AppError> {
  if (value === null || value === undefined) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        `Missing required field: ${fieldName}`,
        false,
        { field: fieldName }
      )
    );
  }
  return { ok: true, value };
}

/**
 * Validate string is not empty
 */
export function requireNonEmpty(
  value: string | null | undefined,
  fieldName: string
): Result<string, AppError> {
  if (!value || value.trim() === "") {
    return err(
      new AppError(
        ErrorCode.VALIDATION_MISSING_FIELD,
        `${fieldName} cannot be empty`,
        false,
        { field: fieldName }
      )
    );
  }
  return { ok: true, value: value.trim() };
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a simple JSON success response
 */
export function successResponse<T>(
  data: T,
  status: number = 200
): Response {
  return json<ApiSuccessResponse<T>>(
    { success: true, data },
    { status }
  );
}

/**
 * Create a JSON error response from code and message
 */
export function errorResponse(
  code: string,
  message: string,
  status: number = 400,
  extra?: { field?: string; retryAfter?: number }
): Response {
  return json<ApiErrorResponse>(
    {
      success: false,
      error: { code, message, ...extra },
    },
    { status }
  );
}

/**
 * Create a 400 Bad Request response
 */
export function badRequest(message: string, field?: string): Response {
  return errorResponse(ErrorCode.VALIDATION_ERROR, message, 400, { field });
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorized(message: string = "Authentication required"): Response {
  return errorResponse(ErrorCode.AUTH_INVALID_TOKEN, message, 401);
}

/**
 * Create a 403 Forbidden response
 */
export function forbidden(message: string = "Access denied"): Response {
  return errorResponse(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message, 403);
}

/**
 * Create a 404 Not Found response
 */
export function notFound(resource: string, id?: string): Response {
  const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
  return errorResponse(ErrorCode.NOT_FOUND_RESOURCE, message, 404);
}

/**
 * Create a 429 Too Many Requests response
 */
export function tooManyRequests(retryAfter?: number): Response {
  const headers = new Headers();
  if (retryAfter) {
    headers.set("Retry-After", String(retryAfter));
  }
  
  return json<ApiErrorResponse>(
    {
      success: false,
      error: {
        code: ErrorCode.BILLING_LIMIT_EXCEEDED,
        message: "Rate limit exceeded",
        retryAfter,
      },
    },
    { status: 429, headers }
  );
}

/**
 * Create a 500 Internal Server Error response
 */
export function internalError(message: string = "An internal error occurred"): Response {
  return errorResponse(ErrorCode.INTERNAL_ERROR, message, 500);
}

