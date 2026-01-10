import type { ZodSchema } from "zod";
import { logger } from "../logger.server";
import { AppError, ErrorCode } from "../errors/index";
import type { Result, AsyncResult } from "../../types/result";
import { ok, err } from "../../types/result";
import {
  formatZodErrorsToRecord,
  getFirstZodError,
  zodErrorToAppError,
} from "./formatters";

export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  error: string;
  details?: Record<string, string>;
}

export type ValidateResult<T> = ValidationResult<T> | ValidationError;

export async function validateJsonBodyResult<T>(
  request: Request,
  schema: ZodSchema<T>
): AsyncResult<T, AppError> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return err(zodErrorToAppError(result.error));
    }
    return ok(result.data);
  } catch (error) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid JSON body",
        false,
        { parseError: error instanceof Error ? error.message : String(error) }
      )
    );
  }
}

export async function validateJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<ValidateResult<T>> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      const details = formatZodErrorsToRecord(result.error);
      const error = getFirstZodError(result.error);
      logger.debug("JSON body validation failed", { error, details });
      return {
        success: false,
        error,
        details,
      };
    }
    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: "Invalid JSON body",
      };
    }
    logger.error("Unexpected error validating JSON body", error);
    return {
      success: false,
      error: "Failed to parse request body",
    };
  }
}

export async function requireValidJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<T> {
  const result = await validateJsonBody(request, schema);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, result.error);
  }
  return result.data;
}

function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (value === "true") {
      obj[key] = true;
    } else if (value === "false") {
      obj[key] = false;
    } else if (
      typeof value === "string" &&
      !isNaN(Number(value)) &&
      value !== ""
    ) {
      obj[key] = Number(value);
    } else {
      obj[key] = value;
    }
  }
  return obj;
}

export async function validateFormDataResult<T>(
  request: Request,
  schema: ZodSchema<T>
): AsyncResult<T, AppError> {
  try {
    const formData = await request.formData();
    const data = formDataToObject(formData);
    const result = schema.safeParse(data);
    if (!result.success) {
      return err(zodErrorToAppError(result.error));
    }
    return ok(result.data);
  } catch (error) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid form data",
        false,
        { parseError: error instanceof Error ? error.message : String(error) }
      )
    );
  }
}

export async function validateFormData<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<ValidateResult<T>> {
  try {
    const formData = await request.formData();
    const data = formDataToObject(formData);
    const result = schema.safeParse(data);
    if (!result.success) {
      const details = formatZodErrorsToRecord(result.error);
      const error = getFirstZodError(result.error);
      logger.debug("Form data validation failed", { error, details });
      return {
        success: false,
        error,
        details,
      };
    }
    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    logger.error("Unexpected error validating form data", error);
    return {
      success: false,
      error: "Failed to parse form data",
    };
  }
}

export async function requireValidFormData<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<T> {
  const result = await validateFormData(request, schema);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, result.error);
  }
  return result.data;
}

export function validateSearchParamsResult<T>(
  request: Request,
  schema: ZodSchema<T>
): Result<T, AppError> {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return err(zodErrorToAppError(result.error));
  }
  return ok(result.data);
}

export function validateQueryParams<T>(
  url: URL,
  schema: ZodSchema<T>
): ValidateResult<T> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (value === "true") {
      params[key] = true;
    } else if (value === "false") {
      params[key] = false;
    } else if (!isNaN(Number(value)) && value !== "") {
      params[key] = Number(value);
    } else {
      params[key] = value;
    }
  }
  const result = schema.safeParse(params);
  if (!result.success) {
    const details = formatZodErrorsToRecord(result.error);
    const error = getFirstZodError(result.error);
    return {
      success: false,
      error,
      details,
    };
  }
  return {
    success: true,
    data: result.data,
  };
}

export function requireValidQueryParams<T>(url: URL, schema: ZodSchema<T>): T {
  const result = validateQueryParams(url, schema);
  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, result.error);
  }
  return result.data;
}

export function validateParamsResult<T>(
  params: Record<string, string | undefined>,
  schema: ZodSchema<T>
): Result<T, AppError> {
  const result = schema.safeParse(params);
  if (!result.success) {
    return err(zodErrorToAppError(result.error));
  }
  return ok(result.data);
}
