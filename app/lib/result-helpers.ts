

import { AppError, ErrorCode, ensureAppError } from "../utils/errors";
import { ok, err, type Result, type AsyncResult, isOk, isErr } from "../types/result";
import { logger } from "../utils/logger.server";

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
  if (error instanceof Error) {

    const prismaError = error as { code?: string; meta?: { target?: string[] } };

    if (prismaError.code === "P2002") {

      const target = prismaError.meta?.target?.join(", ") || "field";
      return new AppError(
        ErrorCode.DB_UNIQUE_CONSTRAINT,
        `${resourceName} with this ${target} already exists`,
        false,
        { resourceName, constraintTarget: target }
      );
    }

    if (prismaError.code === "P2025") {

      return new AppError(
        ErrorCode.NOT_FOUND_RESOURCE,
        `${resourceName} not found`,
        false,
        { resourceName }
      );
    }

    if (prismaError.code?.startsWith("P2")) {

      return new AppError(
        ErrorCode.DB_QUERY_ERROR,
        `Database error: ${error.message}`,
        false,
        { resourceName, prismaCode: prismaError.code }
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
  try {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      // 创建超时 promise，确保事件监听器可以被清理
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const result = await Promise.race([operation(), timeoutPromise]);
      
      // 如果操作成功完成，清理 timeout
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      return ok(result);
    } catch (error) {
      // 确保清理 timeout
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  } catch (error) {
    const appError = handleApiError(error, serviceName);
    return err(appError);
  }
}

function handleApiError(error: unknown, serviceName: string): AppError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("timeout") || message.includes("abort")) {
      return AppError.retryable(
        ErrorCode.PLATFORM_TIMEOUT,
        `${serviceName} request timed out`,
        { platform: serviceName }
      );
    }

    if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
      return AppError.retryable(
        ErrorCode.PLATFORM_NETWORK_ERROR,
        `${serviceName} network error: ${error.message}`,
        { platform: serviceName }
      );
    }
  }

  return ensureAppError(error, ErrorCode.PLATFORM_UNKNOWN_ERROR).withMetadata({
    platform: serviceName,
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
    return { ok: false, error: errors };
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
      logger.warn(`${context}: Failed`, { code: error.code, message: error.message });
    } else {
      logger.warn(`${context}: Failed`, { error: String(error) });
    }
  }
  return result;
}

export { ok, err, isOk, isErr };
export type { Result, AsyncResult };

