

import { json } from "@remix-run/node";
import type { Result, AsyncResult } from "../../types/result";
import { isOk, isErr, err } from "../../types/result";
import { AppError, ErrorCode, type ErrorCodeType, ensureAppError, type ErrorMetadata } from "./app-error";
import { logger } from "../logger.server";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    field?: string;
    retryAfter?: number;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function resultToResponse<T>(
  result: Result<T, AppError>,
  options?: {

    successStatus?: number;

    headers?: HeadersInit;

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

export function errorToResponse(
  error: AppError,
  options?: { headers?: HeadersInit }
): Response {
  const status = error.getHttpStatus();
  const clientResponse = error.toClientResponse();

  if (error.isInternalError()) {
    logger.error("Internal error in response", error, {
      code: error.code,
      metadata: error.metadata,
    });
  }

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

  const headers = new Headers(options?.headers);
  if (error.metadata.retryAfter && status === 429) {
    headers.set("Retry-After", String(Math.ceil(Number(error.metadata.retryAfter) / 1000)));
  }

  return json(response, { status, headers });
}

export async function asyncResultToResponse<T>(
  resultPromise: AsyncResult<T, AppError>,
  options?: Parameters<typeof resultToResponse<T>>[1]
): Promise<Response> {
  const result = await resultPromise;
  return resultToResponse(result, options);
}

export interface ActionHandlerOptions<T> {

  successStatus?: number;

  headers?: HeadersInit;

  transform?: (data: T) => unknown;

  onError?: (error: AppError) => void;
}

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

export function wrapLoader<T>(
  handler: (args: { request: Request }) => AsyncResult<T, AppError>,
  options?: ActionHandlerOptions<T>
): (args: { request: Request }) => Promise<Response> {
  return wrapAction(handler, options);
}

export function throwErrorResponse(error: AppError): never {
  throw errorToResponse(error);
}

export async function unwrapOrThrow<T>(
  resultPromise: AsyncResult<T, AppError>
): Promise<T> {
  const result = await resultPromise;

  if (isOk(result)) {
    return result.value;
  }

  throw errorToResponse(result.error);
}

export function unwrapOrThrowSync<T>(result: Result<T, AppError>): T {
  if (isOk(result)) {
    return result.value;
  }

  throw errorToResponse(result.error);
}

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

export function successResponse<T>(
  data: T,
  status: number = 200
): Response {
  return json<ApiSuccessResponse<T>>(
    { success: true, data },
    { status }
  );
}

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

export function badRequest(message: string, field?: string): Response {
  return errorResponse(ErrorCode.VALIDATION_ERROR, message, 400, { field });
}

export function unauthorized(message: string = "Authentication required"): Response {
  return errorResponse(ErrorCode.AUTH_INVALID_TOKEN, message, 401);
}

export function forbidden(message: string = "Access denied"): Response {
  return errorResponse(ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message, 403);
}

export function notFound(resource: string, id?: string): Response {
  const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
  return errorResponse(ErrorCode.NOT_FOUND_RESOURCE, message, 404);
}

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

export function internalError(message: string = "An internal error occurred"): Response {
  return errorResponse(ErrorCode.INTERNAL_ERROR, message, 500);
}

