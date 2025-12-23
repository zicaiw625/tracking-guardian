/**
 * Action Response Utilities
 *
 * Standardized response types and helpers for Remix actions.
 */

import { json } from "@remix-run/node";

// =============================================================================
// Response Types
// =============================================================================

/**
 * Success response type
 */
export interface ActionSuccess<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * Error response type
 */
export interface ActionError {
  success: false;
  error: string;
  code?: string;
  field?: string;
  retryAfter?: number;
}

/**
 * Union type for action responses
 */
export type ActionResponse<T = unknown> = ActionSuccess<T> | ActionError;

/**
 * Void success response (no data)
 */
export type VoidActionResponse = ActionResponse<void>;

// =============================================================================
// Response Constructors
// =============================================================================

/**
 * Create a success response
 */
export function successResponse<T>(data: T, message?: string): ActionSuccess<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

/**
 * Create a success response with just a message
 */
export function successMessage(message: string): ActionSuccess<void> {
  return {
    success: true,
    message,
  };
}

/**
 * Create an error response
 */
export function errorResponse(
  error: string,
  options?: {
    code?: string;
    field?: string;
    retryAfter?: number;
  }
): ActionError {
  return {
    success: false,
    error,
    ...options,
  };
}

// =============================================================================
// JSON Response Helpers
// =============================================================================

/**
 * Return a JSON success response
 */
export function jsonSuccess<T>(
  data: T,
  message?: string,
  init?: ResponseInit
) {
  return json(successResponse(data, message), init);
}

/**
 * Return a JSON success message response
 */
export function jsonSuccessMessage(message: string, init?: ResponseInit) {
  return json(successMessage(message), init);
}

/**
 * Return a JSON error response
 */
export function jsonError(
  error: string,
  status: number = 400,
  options?: {
    code?: string;
    field?: string;
    retryAfter?: number;
  }
) {
  return json(errorResponse(error, options), { status });
}

/**
 * Return a JSON not found error
 */
export function jsonNotFound(resource: string = "Resource") {
  return jsonError(`${resource} not found`, 404, { code: "NOT_FOUND" });
}

/**
 * Return a JSON validation error
 */
export function jsonValidationError(message: string, field?: string) {
  return jsonError(message, 400, { code: "VALIDATION_ERROR", field });
}

/**
 * Return a JSON unauthorized error
 */
export function jsonUnauthorized(message: string = "Unauthorized") {
  return jsonError(message, 401, { code: "UNAUTHORIZED" });
}

/**
 * Return a JSON forbidden error
 */
export function jsonForbidden(message: string = "Access denied") {
  return jsonError(message, 403, { code: "FORBIDDEN" });
}

/**
 * Return a JSON rate limit error
 */
export function jsonRateLimited(retryAfter: number = 60) {
  return jsonError("Rate limit exceeded", 429, {
    code: "RATE_LIMITED",
    retryAfter,
  });
}

/**
 * Return a JSON internal server error
 */
export function jsonInternalError(
  message: string = "An unexpected error occurred"
) {
  return jsonError(message, 500, { code: "INTERNAL_ERROR" });
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if response is successful
 */
export function isActionSuccess<T>(
  response: ActionResponse<T>
): response is ActionSuccess<T> {
  return response.success === true;
}

/**
 * Check if response is an error
 */
export function isActionError(
  response: ActionResponse<unknown>
): response is ActionError {
  return response.success === false;
}

// =============================================================================
// Response Unwrapping
// =============================================================================

/**
 * Extract data from a successful response or throw
 */
export function unwrapResponse<T>(response: ActionResponse<T>): T {
  if (isActionError(response)) {
    throw new Error(response.error);
  }
  return response.data as T;
}

/**
 * Extract data from a successful response or return default
 */
export function unwrapResponseOr<T>(
  response: ActionResponse<T>,
  defaultValue: T
): T {
  if (isActionError(response)) {
    return defaultValue;
  }
  return response.data ?? defaultValue;
}

