import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "./logger.server";
import { AppError, ErrorCode, isAppError, ensureAppError } from "./errors/index";
import { readJsonWithSizeLimit } from "./body-size-guard";

export type ActionHandler<T = unknown> = (
  args: ActionFunctionArgs
) => Promise<T>;

export type LoaderHandler<T = unknown> = (
  args: LoaderFunctionArgs
) => Promise<T>;

export interface ApiHandlerOptions {
  logStack?: boolean;
  transformError?: (error: unknown) => {
    message: string;
    status: number;
    code?: string;
  };
  includeDetails?: boolean;
}

function handleApiError(
  error: unknown,
  options: ApiHandlerOptions = {}
): Response {
  const { logStack = false, transformError, includeDetails = false } = options;
  const appError = ensureAppError(error);
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
  const clientResponse = appError.toClientResponse();
  const statusCode = appError.getHttpStatus();
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

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return await readJsonWithSizeLimit<T>(request);
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON body");
  }
}

export async function parseFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid form data");
  }
}

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

export function getQueryParam(
  url: URL,
  param: string,
  defaultValue: string = ""
): string {
  return url.searchParams.get(param) ?? defaultValue;
}

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

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

export function createdResponse<T>(data: T): Response {
  return json(data, { status: 201 });
}

export function acceptedResponse<T>(data?: T): Response {
  return data ? json(data, { status: 202 }) : new Response(null, { status: 202 });
}
