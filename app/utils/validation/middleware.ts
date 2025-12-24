/**
 * Validation Middleware
 *
 * Middleware-style validation for Remix loaders and actions.
 */

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import type { ZodSchema } from "zod";
import { AppError, type ApiErrorResponse } from "../errors/index";
import type { Result } from "../../types/result";
import {
  validateJsonBodyResult,
  validateFormDataResult,
  validateSearchParamsResult,
  validateParamsResult,
  type ValidateResult,
} from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Validated handler function for Remix
 */
export type ValidatedHandler<TInput, TOutput> = (
  args: LoaderFunctionArgs | ActionFunctionArgs,
  data: TInput
) => Promise<TOutput>;

/**
 * Validation options
 */
export interface ValidationOptions {
  source: "json" | "formData" | "searchParams" | "params";
  errorPrefix?: string;
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create a validated action handler (Remix middleware style)
 *
 * @example
 * ```typescript
 * const UpdateSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email(),
 * });
 *
 * export const action = withValidationMiddleware(
 *   UpdateSchema,
 *   { source: "formData" },
 *   async (args, data) => {
 *     await updateUser(data);
 *     return json({ success: true });
 *   }
 * );
 * ```
 */
export function withValidationMiddleware<TInput, TOutput>(
  schema: ZodSchema<TInput>,
  options: ValidationOptions,
  handler: ValidatedHandler<TInput, TOutput>
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<TOutput | Response> {
  return async (args) => {
    let result: Result<TInput, AppError>;

    switch (options.source) {
      case "json":
        result = await validateJsonBodyResult(args.request, schema);
        break;
      case "formData":
        result = await validateFormDataResult(args.request, schema);
        break;
      case "searchParams":
        result = validateSearchParamsResult(args.request, schema);
        break;
      case "params":
        result = validateParamsResult(args.params, schema);
        break;
    }

    if (!result.ok) {
      return createValidationErrorResponse(result.error, options.errorPrefix);
    }

    return handler(args, result.value);
  };
}

/**
 * Create a validation error response (AppError style)
 */
export function createValidationErrorResponse(
  error: AppError,
  prefix?: string
): Response {
  const message = prefix ? `${prefix}: ${error.message}` : error.message;

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

/**
 * Wrap a simple handler with validation error handling
 */
export function withValidationHandler<T, R>(
  validator: (request: Request) => Promise<ValidateResult<T>>,
  handler: (data: T, request: Request) => Promise<R>
): (request: Request) => Promise<R | Response> {
  return async (request: Request) => {
    const result = await validator(request);

    if (!result.success) {
      return createSimpleValidationErrorResponse(result.error, result.details);
    }

    return handler(result.data, request);
  };
}

/**
 * Create a simple validation error response
 */
export function createSimpleValidationErrorResponse(
  error: string,
  details?: Record<string, string>
): Response {
  return json(
    {
      success: false,
      error,
      details,
    },
    { status: 400 }
  );
}

// =============================================================================
// Aliases for Backward Compatibility
// =============================================================================

/**
 * @deprecated Use withValidationMiddleware instead
 */
export const withValidation = withValidationMiddleware;

/**
 * @deprecated Use createValidationErrorResponse instead
 */
export const validationErrorResponse = createValidationErrorResponse;

