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

export type ValidatedHandler<TInput, TOutput> = (
  args: LoaderFunctionArgs | ActionFunctionArgs,
  data: TInput
) => Promise<TOutput>;

export interface ValidationOptions {
  source: "json" | "formData" | "searchParams" | "params";
  errorPrefix?: string;
}

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

export const withValidation = withValidationMiddleware;

export const validationErrorResponse = createValidationErrorResponse;
