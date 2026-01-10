import type { ZodError, ZodIssue } from "zod";
import { AppError, ErrorCode } from "../errors/index";

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

export function getZodIssues(error: ZodError<unknown>): ZodIssue[] {
  return error.issues ?? [];
}

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

export function getFirstZodError(error: ZodError<unknown>): string {
  const issues = getZodIssues(error);
  const firstError = issues[0];
  if (firstError) {
    const path = firstError.path.join(".");
    return path ? `${path}: ${firstError.message}` : firstError.message;
  }
  return "Validation failed";
}

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

export const formatZodErrors = formatZodErrorsToArray;
