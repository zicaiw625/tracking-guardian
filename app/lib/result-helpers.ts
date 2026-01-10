import { AppError, ErrorCode, ensureAppError } from "../utils/errors";
import { ok, err, type Result, type AsyncResult, isOk, isErr } from "../types/result";
import { logger } from "../utils/logger.server";
import { isPrismaError, getPrismaErrorCode, getPrismaErrorTarget } from "../utils/type-guards";

export async function wrapDbOperation<T>(
  operation: () => Promise<T>,
  resourceName: string = "Resource"
): AsyncResult<T, AppError> {
  try {
    const result = await operation();
    return ok(result);
  } catch (error) {
    const appError = handleDatabaseError(error, resourceName);
    logger.error(`Database operation failed for ${resourceName}`, error);
    return err(appError);
  }
}

export async function wrapDbFindRequired<T>(
  operation: () => Promise<T | null>,
  resourceName: string,
  resourceId?: string
): AsyncResult<T, AppError> {
  try {
    const result = await operation();
    if (result === null) {
      return err(AppError.notFound(resourceName, resourceId));
    }
    return ok(result);
  } catch (error) {
    const appError = handleDatabaseError(error, resourceName);
    return err(appError);
  }
}

function handleDatabaseError(error: unknown, resourceName: string): AppError {
  if (isPrismaError(error)) {
    const errorCode = getPrismaErrorCode(error);
    if (errorCode === "P2002") {
      const target = getPrismaErrorTarget(error)?.join(", ") || "field";
      return new AppError(
        ErrorCode.DB_UNIQUE_CONSTRAINT,
        `${resourceName} with this ${target} already exists`,
        false,
        { resourceName, constraintTarget: target }
      );
    }
    if (errorCode === "P2025") {
      return new AppError(
        ErrorCode.NOT_FOUND_RESOURCE,
        `${resourceName} not found`,
        false,
        { resourceName }
      );
    }
    if (errorCode?.startsWith("P2")) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new AppError(
        ErrorCode.DB_QUERY_ERROR,
        `Database error: ${errorMessage}`,
        false,
        { resourceName, prismaCode: errorCode }
      );
    }
  }
  return ensureAppError(error, ErrorCode.DB_QUERY_ERROR);
}

export async function wrapApiCall<T>(
  operation: () => Promise<T>,
  serviceName: string,
  timeoutMs: number = 30000
): AsyncResult<T, AppError> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutErrorSymbol = Symbol("TimeoutError");
  const cleanupTimeout = (): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
        (timeoutError as Error & { [timeoutErrorSymbol]: boolean })[timeoutErrorSymbol] = true;
        reject(timeoutError);
      }, timeoutMs);
    });
    const result = await Promise.race([
      operation().finally(() => {
        cleanupTimeout();
      }),
      timeoutPromise,
    ]);
    return ok(result);
  } catch (error) {
    cleanupTimeout();
    const isTimeoutError =
      error instanceof Error &&
      (
        (timeoutErrorSymbol in error && (error as Error & { [timeoutErrorSymbol]: boolean })[timeoutErrorSymbol]) ||
        error.message.includes("timed out") ||
        error.message.includes(`Request timed out after ${timeoutMs}ms`) ||
        error.name === "TimeoutError" ||
        error.message.toLowerCase().includes("timeout")
      );
    if (isTimeoutError) {
      logger.warn(`API call timed out: ${serviceName}`, {
        serviceName,
        timeoutMs,
      });
    }
    const appError = handleApiError(error, serviceName);
    return err(appError);
  }
}

function handleApiError(error: unknown, serviceName: string): AppError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const errorName = error.name?.toLowerCase() || "";
    if (message.includes("timeout") || message.includes("abort") || errorName.includes("timeout") || errorName.includes("abort")) {
      return AppError.retryable(
        ErrorCode.PLATFORM_TIMEOUT,
        `${serviceName} request timed out`,
        { platform: serviceName, originalError: error.message }
      );
    }
    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("econnreset") ||
      errorName.includes("networkerror") ||
      errorName.includes("typeerror")
    ) {
      return AppError.retryable(
        ErrorCode.PLATFORM_NETWORK_ERROR,
        `${serviceName} network error: ${error.message}`,
        { platform: serviceName, originalError: error.message }
      );
    }
    if (message.includes("unauthorized") || message.includes("401") || message.includes("authentication")) {
      return new AppError(
        ErrorCode.PLATFORM_AUTH_ERROR,
        `${serviceName} authentication failed`,
        false,
        { platform: serviceName, originalError: error.message }
      );
    }
    if (message.includes("forbidden") || message.includes("403") || message.includes("permission")) {
      return new AppError(
        ErrorCode.PLATFORM_AUTH_ERROR,
        `${serviceName} access forbidden`,
        false,
        { platform: serviceName, originalError: error.message }
      );
    }
  }
  if (typeof error === "string") {
    return ensureAppError(new Error(error), ErrorCode.PLATFORM_UNKNOWN_ERROR).withMetadata({
      platform: serviceName,
      originalError: error,
    });
  }
  return ensureAppError(error, ErrorCode.PLATFORM_UNKNOWN_ERROR).withMetadata({
    platform: serviceName,
    errorType: typeof error,
  });
}

export function parseJson<T>(json: string): Result<T, AppError> {
  try {
    const parsed = JSON.parse(json) as T;
    return ok(parsed);
  } catch (error) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        `Invalid JSON: ${error instanceof Error ? error.message : "Unknown error"}`,
        false
      )
    );
  }
}

export function parseJsonSafe<T>(
  input: unknown,
  validator?: (value: unknown) => value is T
): Result<T, AppError> {
  if (typeof input === "string") {
    const parsed = parseJson<T>(input);
    if (!parsed.ok) return parsed;
    if (validator && !validator(parsed.value)) {
      return err(
        new AppError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          "JSON structure does not match expected format",
          false
        )
      );
    }
    return ok(parsed.value);
  }
  if (validator && !validator(input)) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Value does not match expected format",
        false
      )
    );
  }
  return ok(input as T);
}

export async function collectResults<T extends readonly Result<unknown, AppError>[]>(
  results: [...{ [K in keyof T]: Promise<T[K]> }]
): Promise<Result<{ [K in keyof T]: T[K] extends Result<infer V, AppError> ? V : never }, AppError>> {
  if (!Array.isArray(results) || results.length === 0) {
    return ok([] as { [K in keyof T]: T[K] extends Result<infer V, AppError> ? V : never });
  }
  const settled = await Promise.all(results);
  const values: unknown[] = [];
  for (const result of settled) {
    if (!result.ok) {
      return err(result.error);
    }
    values.push(result.value);
  }
  return ok(values as { [K in keyof T]: T[K] extends Result<infer V, AppError> ? V : never });
}

export async function collectAllResults<T>(
  operations: Promise<Result<T, AppError>>[]
): AsyncResult<T[], AppError[]> {
  if (!Array.isArray(operations) || operations.length === 0) {
    return ok([]);
  }
  const results = await Promise.all(operations);
  const values: T[] = [];
  const errors: AppError[] = [];
  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok(values);
}

export function resultToResponse<T>(
  result: Result<T, AppError>,
  successStatus: number = 200
): Response {
  if (result.ok) {
    return new Response(JSON.stringify({ success: true, data: result.value }), {
      status: successStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
  const status = result.error.getHttpStatus();
  const body = result.error.toClientResponse();
  return new Response(JSON.stringify({ success: false, ...body }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function resultToJson<T>(
  result: Result<T, AppError>
): { success: true; data: T } | { success: false; error: string; code: string } {
  if (result.ok) {
    return { success: true, data: result.value };
  }
  const { code, message } = result.error.toClientResponse();
  return { success: false, error: message, code };
}

export async function executeIf<T>(
  condition: boolean,
  operation: () => AsyncResult<T, AppError>,
  defaultValue: T
): AsyncResult<T, AppError> {
  if (!condition) {
    return ok(defaultValue);
  }
  return operation();
}

export async function chain<T, U>(
  result: Result<T, AppError>,
  operation: (value: T) => AsyncResult<U, AppError>
): AsyncResult<U, AppError> {
  if (!result.ok) {
    return result;
  }
  return operation(result.value);
}

export function logResult<T, E>(
  result: Result<T, E>,
  context: string
): Result<T, E> {
  if (isOk(result)) {
    logger.debug(`${context}: Success`);
  } else if (isErr(result)) {
    const error = result.error;
    if (error instanceof AppError) {
      const logLevel = error.isInternalError() ? "error" : error.isRetryable ? "warn" : "info";
      if (logLevel === "error") {
        logger.error(`${context}: Failed`, error, {
          code: error.code,
          message: error.message,
          isRetryable: error.isRetryable,
          metadata: error.metadata,
        });
      } else if (logLevel === "warn") {
        logger.warn(`${context}: Failed`, {
          code: error.code,
          message: error.message,
          isRetryable: error.isRetryable,
          metadata: error.metadata,
        });
      } else {
        logger.info(`${context}: Failed`, {
          code: error.code,
          message: error.message,
          isRetryable: error.isRetryable,
          metadata: error.metadata,
        });
      }
    } else {
      logger.warn(`${context}: Failed`, {
        error: String(error),
        errorName: error instanceof Error ? error.name : "Unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export { ok, err, isOk, isErr };
export type { Result, AsyncResult };
