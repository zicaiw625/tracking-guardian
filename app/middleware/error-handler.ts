import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  AppError,
  ErrorCode,
  ensureAppError,
  type ApiErrorResponse,
} from "../utils/errors";
import { logger } from "../utils/logger.server";
import { sanitizeSensitiveInfo } from "../utils/security";

export type RouteHandler<T> = (
  args: LoaderFunctionArgs | ActionFunctionArgs
) => Promise<T>;

export interface ErrorHandlerOptions {
  logErrors?: boolean;
  includeStackInDev?: boolean;
  transformError?: (error: AppError) => AppError;
  buildResponse?: (error: AppError) => Response;
}

function processError(
  error: unknown,
  options: ErrorHandlerOptions,
  request?: Request
): Response {
  if (error instanceof Response) {
    throw error;
  }
  let appError: AppError;
  if (error === null || error === undefined) {
    const nullError = new Error("Unknown error: null or undefined");
    appError = ensureAppError(nullError);
  } else {
    appError = ensureAppError(error);
  }
  if (options.transformError) {
    appError = options.transformError(appError);
  }
  const shouldLog = options.logErrors !== false;
  if (shouldLog) {
    if (request) {
      logError(appError, request);
    } else {
      logger.error("Unhandled error", appError, {
        code: appError.code,
        isRetryable: appError.isRetryable,
      });
    }
  }
  if (options.buildResponse) {
    return options.buildResponse(appError);
  }
  return buildErrorResponse(appError, options.includeStackInDev);
}

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
      return processError(error, opts, args.request);
    }
  };
}

export async function handleErrors<T>(
  fn: () => Promise<T>,
  options?: ErrorHandlerOptions
): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    const opts = {
      logErrors: true,
      includeStackInDev: true,
      ...options,
    };
    return processError(error, opts);
  }
}

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
  if (
    includeStackInDev &&
    process.env.NODE_ENV !== "production" &&
    error.stack
  ) {
    body.stack = error.stack;
  }
  const headers = new Headers();
  if (error.metadata.retryAfter && status === 429) {
    headers.set(
      "Retry-After",
      String(Math.ceil(Number(error.metadata.retryAfter) / 1000))
    );
  }
  return json(body, { status, headers });
}

function logError(error: AppError, request: Request): void {
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;
  const searchParamsObj = Object.fromEntries(url.searchParams);
  const sanitizedSearchParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParamsObj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("token") || lowerKey.includes("signature") || lowerKey.includes("hmac") || lowerKey.includes("id_token")) {
      sanitizedSearchParams[key] = "[REDACTED]";
    } else {
      sanitizedSearchParams[key] = sanitizeSensitiveInfo(String(value));
    }
  }
  if (error.isInternalError()) {
    logger.error(`[${error.code}] ${error.message}`, error, {
      method,
      pathname,
      searchParams: sanitizedSearchParams,
      metadata: error.metadata,
    });
  } else {
    logger.warn(`[${error.code}] ${error.message}`, {
      path: url.pathname,
      method: request.method,
      code: error.code,
    });
  }
}

export function throwError(error: AppError): never {
  throw buildErrorResponse(error);
}

export function throwBadRequest(message: string, field?: string): never {
  throw buildErrorResponse(
    new AppError(ErrorCode.VALIDATION_ERROR, message, false, { field })
  );
}

export function throwUnauthorized(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.AUTH_INVALID_TOKEN,
      message ?? "Authentication required"
    )
  );
}

export function throwForbidden(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
      message ?? "Access denied"
    )
  );
}

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

export function throwInternalError(message?: string): never {
  throw buildErrorResponse(
    new AppError(
      ErrorCode.INTERNAL_ERROR,
      message ?? "An internal error occurred"
    )
  );
}

export function throwIf(condition: boolean, error: AppError): void {
  if (condition) {
    throwError(error);
  }
}

export function throwIfNull<T>(
  value: T | null | undefined,
  error: AppError
): asserts value is T {
  if (value === null || value === undefined) {
    throwError(error);
  }
}

export function throwIfNotFound<T>(
  value: T | null | undefined,
  resource: string,
  id?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throwNotFound(resource, id);
  }
}
