/**
 * Request Validation Utilities
 *
 * Middleware and helpers for validating incoming API requests using Zod schemas.
 */

import { json } from "@remix-run/node";
import type { ZodSchema, ZodError, ZodIssue } from "zod";
import { logger } from "./logger.server";
import { AppError, ErrorCode } from "./errors/index";

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Error Formatting
// =============================================================================

/**
 * Get issues array from ZodError (compatible with Zod v4)
 */
function getZodIssues(error: ZodError<unknown>): ZodIssue[] {
  // Zod v4 uses 'issues' property
  return (error as unknown as { issues: ZodIssue[] }).issues ?? [];
}

/**
 * Format Zod errors into a user-friendly object
 */
export function formatZodErrors(error: ZodError<unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const issues = getZodIssues(error);

  for (const issue of issues) {
    const path = issue.path.join(".");
    if (!errors[path]) {
      errors[path] = issue.message;
    }
  }

  return errors;
}

/**
 * Get first error message from Zod error
 */
export function getFirstZodError(error: ZodError<unknown>): string {
  const issues = getZodIssues(error);
  const firstError = issues[0];
  if (firstError) {
    const path = firstError.path.join(".");
    return path ? `${path}: ${firstError.message}` : firstError.message;
  }
  return "Validation failed";
}

// =============================================================================
// JSON Body Validation
// =============================================================================

/**
 * Validate JSON request body against a Zod schema
 *
 * @example
 * ```ts
 * const result = await validateJsonBody(request, MySchema);
 * if (!result.success) {
 *   return json({ error: result.error }, { status: 400 });
 * }
 * const data = result.data;
 * ```
 */
export async function validateJsonBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<ValidateResult<T>> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);

    if (!result.success) {
      const details = formatZodErrors(result.error);
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

/**
 * Validate JSON body and return error response on failure
 */
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

// =============================================================================
// Form Data Validation
// =============================================================================

/**
 * Parse form data into object
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    // Handle boolean strings
    if (value === "true") {
      obj[key] = true;
    } else if (value === "false") {
      obj[key] = false;
    } else if (typeof value === "string" && !isNaN(Number(value)) && value !== "") {
      obj[key] = Number(value);
    } else {
      obj[key] = value;
    }
  }

  return obj;
}

/**
 * Validate form data against a Zod schema
 */
export async function validateFormData<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<ValidateResult<T>> {
  try {
    const formData = await request.formData();
    const data = formDataToObject(formData);
    const result = schema.safeParse(data);

    if (!result.success) {
      const details = formatZodErrors(result.error);
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

/**
 * Validate form data and throw on failure
 */
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

// =============================================================================
// Query Parameters Validation
// =============================================================================

/**
 * Validate URL query parameters against a Zod schema
 */
export function validateQueryParams<T>(
  url: URL,
  schema: ZodSchema<T>
): ValidateResult<T> {
  const params: Record<string, unknown> = {};

  for (const [key, value] of url.searchParams.entries()) {
    // Handle boolean strings
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
    const details = formatZodErrors(result.error);
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

/**
 * Validate query params and throw on failure
 */
export function requireValidQueryParams<T>(
  url: URL,
  schema: ZodSchema<T>
): T {
  const result = validateQueryParams(url, schema);

  if (!result.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, result.error);
  }

  return result.data;
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create a validation error response
 */
export function validationErrorResponse(
  error: string,
  details?: Record<string, string>
) {
  return json(
    {
      success: false,
      error,
      details,
    },
    { status: 400 }
  );
}

/**
 * Wrap an action handler with automatic validation error handling
 */
export function withValidation<T, R>(
  validator: (request: Request) => Promise<ValidateResult<T>>,
  handler: (data: T, request: Request) => Promise<R>
): (request: Request) => Promise<R | Response> {
  return async (request: Request) => {
    const result = await validator(request);

    if (!result.success) {
      return validationErrorResponse(result.error, result.details);
    }

    return handler(result.data, request);
  };
}

