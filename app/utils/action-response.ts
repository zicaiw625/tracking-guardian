import { json } from "@remix-run/node";

export interface ActionSuccess<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ActionError {
  success: false;
  error: string;
  code?: string;
  field?: string;
  retryAfter?: number;
}

export type ActionResponse<T = unknown> = ActionSuccess<T> | ActionError;

export type VoidActionResponse = ActionResponse<void>;

export function successResponse<T>(data: T, message?: string): ActionSuccess<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

export function successMessage(message: string): ActionSuccess<void> {
  return {
    success: true,
    message,
  };
}

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

export function jsonSuccess<T>(
  data: T,
  message?: string,
  init?: ResponseInit
) {
  return json(successResponse(data, message), init);
}

export function jsonSuccessMessage(message: string, init?: ResponseInit) {
  return json(successMessage(message), init);
}

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

export function jsonNotFound(resource: string = "Resource") {
  return jsonError(`${resource} not found`, 404, { code: "NOT_FOUND" });
}

export function jsonValidationError(message: string, field?: string) {
  return jsonError(message, 400, { code: "VALIDATION_ERROR", field });
}

export function jsonUnauthorized(message: string = "Unauthorized") {
  return jsonError(message, 401, { code: "UNAUTHORIZED" });
}

export function jsonForbidden(message: string = "Access denied") {
  return jsonError(message, 403, { code: "FORBIDDEN" });
}

export function jsonRateLimited(retryAfter: number = 60) {
  return jsonError("Rate limit exceeded", 429, {
    code: "RATE_LIMITED",
    retryAfter,
  });
}

export function jsonInternalError(
  message: string = "An unexpected error occurred"
) {
  return jsonError(message, 500, { code: "INTERNAL_ERROR" });
}

export function isActionSuccess<T>(
  response: ActionResponse<T>
): response is ActionSuccess<T> {
  return response.success === true;
}

export function isActionError(
  response: ActionResponse<unknown>
): response is ActionError {
  return response.success === false;
}

export function unwrapResponse<T>(response: ActionResponse<T>): T {
  if (isActionError(response)) {
    throw new Error(response.error);
  }
  return response.data as T;
}

export function unwrapResponseOr<T>(
  response: ActionResponse<T>,
  defaultValue: T
): T {
  if (isActionError(response)) {
    return defaultValue;
  }
  return response.data ?? defaultValue;
}
