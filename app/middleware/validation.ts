/**
 * Validation Middleware
 *
 * Provides request validation using Zod schemas.
 */

import { type ZodSchema, type ZodError, type ZodIssue } from "zod";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { AppError, ErrorCode, type ApiErrorResponse } from "../utils/errors";
import type { Result, AsyncResult } from "../types/result";
import { ok, err } from "../types/result";

// =============================================================================
// Types
// =============================================================================

/**
 * Validation error details
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

/**
 * Validated handler function
 */
export type ValidatedHandler<TInput, TOutput> = (
  args: LoaderFunctionArgs | ActionFunctionArgs,
  data: TInput
) => Promise<TOutput>;

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Source of data to validate */
  source: "json" | "formData" | "searchParams" | "params";
  /** Custom error message prefix */
  errorPrefix?: string;
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Parse and validate request body as JSON
 */
export async function validateJsonBody<T>(
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

/**
 * Parse and validate form data
 */
export async function validateFormData<T>(
  request: Request,
  schema: ZodSchema<T>
): AsyncResult<T, AppError> {
  try {
    const formData = await request.formData();
    const data = Object.fromEntries(formData.entries());
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

/**
 * Validate URL search parameters
 */
export function validateSearchParams<T>(
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

/**
 * Validate route params
 */
export function validateParams<T>(
  params: Record<string, string | undefined>,
  schema: ZodSchema<T>
): Result<T, AppError> {
  const result = schema.safeParse(params);

  if (!result.success) {
    return err(zodErrorToAppError(result.error));
  }

  return ok(result.data);
}

// =============================================================================
// Zod Error Conversion
// =============================================================================

/**
 * Get issues array from ZodError (compatible with Zod v4)
 */
function getZodIssues(zodError: ZodError<unknown>): ZodIssue[] {
  // Zod v4 uses 'issues' property
  return (zodError as unknown as { issues: ZodIssue[] }).issues ?? [];
}

/**
 * Convert Zod error to AppError
 */
export function zodErrorToAppError(zodError: ZodError<unknown>): AppError {
  const issues = getZodIssues(zodError);
  const errors = issues.map((e: ZodIssue) => ({
    field: e.path.join("."),
    message: e.message,
    code: e.code,
  }));

  const firstError = errors[0];
  const message = firstError
    ? `Validation error: ${firstError.field} - ${firstError.message}`
    : "Validation error";

  return new AppError(ErrorCode.VALIDATION_ERROR, message, false, {
    field: firstError?.field,
    errors,
  });
}

/**
 * Format Zod errors for API response
 */
export function formatZodErrors(zodError: ZodError<unknown>): ValidationErrorDetail[] {
  const issues = getZodIssues(zodError);
  return issues.map((e: ZodIssue) => ({
    field: e.path.join("."),
    message: e.message,
    code: e.code,
  }));
}

// =============================================================================
// Validation Middleware
// =============================================================================

/**
 * Create a validated action handler
 *
 * @example
 * ```typescript
 * const UpdateSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email(),
 * });
 *
 * export const action = withValidation(
 *   UpdateSchema,
 *   { source: "formData" },
 *   async (args, data) => {
 *     await updateUser(data);
 *     return json({ success: true });
 *   }
 * );
 * ```
 */
export function withValidation<TInput, TOutput>(
  schema: ZodSchema<TInput>,
  options: ValidationOptions,
  handler: ValidatedHandler<TInput, TOutput>
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<TOutput | Response> {
  return async (args) => {
    let result: Result<TInput, AppError>;

    switch (options.source) {
      case "json":
        result = await validateJsonBody(args.request, schema);
        break;
      case "formData":
        result = await validateFormData(args.request, schema);
        break;
      case "searchParams":
        result = validateSearchParams(args.request, schema);
        break;
      case "params":
        result = validateParams(args.params, schema);
        break;
    }

    if (!result.ok) {
      return validationErrorResponse(result.error, options.errorPrefix);
    }

    return handler(args, result.value);
  };
}

/**
 * Create a validation error response
 */
export function validationErrorResponse(
  error: AppError,
  prefix?: string
): Response {
  const message = prefix
    ? `${prefix}: ${error.message}`
    : error.message;

  const errorDetail: ApiErrorResponse["error"] = {
    code: error.code,
    message,
  };

  if (error.metadata.field) {
    errorDetail.field = String(error.metadata.field);
  }

  const body: ApiErrorResponse = {
    success: false,
    error: errorDetail,
  };

  return json(body, { status: 400 });
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Require a value is present (not null/undefined)
 */
export function require<T>(
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
  return ok(value);
}

/**
 * Require a string is not empty
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
  return ok(value.trim());
}

/**
 * Validate email format
 */
export function validateEmail(email: string): Result<string, AppError> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid email format",
        false,
        { field: "email", expected: "valid email address" }
      )
    );
  }
  return ok(email.toLowerCase());
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): Result<URL, AppError> {
  try {
    return ok(new URL(url));
  } catch {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        "Invalid URL format",
        false,
        { field: "url", expected: "valid URL" }
      )
    );
  }
}

/**
 * Validate numeric value in range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): Result<number, AppError> {
  if (value < min || value > max) {
    return err(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        `${fieldName} must be between ${min} and ${max}`,
        false,
        { field: fieldName, min, max, received: value }
      )
    );
  }
  return ok(value);
}
