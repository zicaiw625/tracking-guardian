/**
 * Validation Formatters
 *
 * Utilities for formatting Zod errors into various formats.
 */

import type { ZodError, ZodIssue } from "zod";
import { AppError, ErrorCode } from "../errors/index";

// =============================================================================
// Types
// =============================================================================

/**
 * Validation error detail for API responses
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

// =============================================================================
// Zod Error Utilities
// =============================================================================

/**
 * Get issues array from ZodError (compatible with Zod v4)
 */
export function getZodIssues(error: ZodError<unknown>): ZodIssue[] {
  return (error as unknown as { issues: ZodIssue[] }).issues ?? [];
}

/**
 * Format Zod errors into a record (field -> message)
 */
export function formatZodErrorsToRecord(
  error: ZodError<unknown>
): Record<string, string> {
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
 * Format Zod errors into detailed array
 */
export function formatZodErrorsToArray(
  error: ZodError<unknown>
): ValidationErrorDetail[] {
  const issues = getZodIssues(error);
  return issues.map((e: ZodIssue) => ({
    field: e.path.join("."),
    message: e.message,
    code: e.code,
  }));
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

/**
 * Convert Zod error to AppError
 */
export function zodErrorToAppError(zodError: ZodError<unknown>): AppError {
  const errors = formatZodErrorsToArray(zodError);
  const firstError = errors[0];

  const message = firstError
    ? `Validation error: ${firstError.field} - ${firstError.message}`
    : "Validation error";

  return new AppError(ErrorCode.VALIDATION_ERROR, message, false, {
    field: firstError?.field,
    errors,
  });
}

// =============================================================================
// Aliases for Backward Compatibility
// =============================================================================

/**
 * @deprecated Use formatZodErrorsToArray instead
 */
export const formatZodErrors = formatZodErrorsToArray;

