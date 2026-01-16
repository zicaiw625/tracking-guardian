import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { AppError, ErrorCode, ensureAppError } from "../utils/errors";
import { logger, createRequestLogger, type RequestLogger } from "../utils/logger.server";
import { type Result, ok, err } from "../types/result";
import type { AdminApiContext, Session } from "@shopify/shopify-app-remix/server";
import { safeFireAndForget } from "../utils/helpers";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";

export interface AuthContext {
  session: Session;
  admin: AdminApiContext;
  shopDomain: string;
  shopId?: string;
  logger: RequestLogger;
}

export interface ActionHandlerConfig<TInput, TOutput> {
  validate?: (data: unknown) => Result<TInput, AppError>;
  execute: (input: TInput, ctx: AuthContext) => Promise<Result<TOutput, AppError>>;
  onError?: (error: AppError, ctx: AuthContext) => Response;
  successStatus?: number;
}

export interface LoaderHandlerConfig<TOutput> {
  execute: (ctx: AuthContext) => Promise<Result<TOutput, AppError>>;
  onError?: (error: AppError, ctx: AuthContext) => Response;
}

export interface PublicHandlerConfig<TInput, TOutput> {
  validate?: (data: unknown) => Result<TInput, AppError>;
  execute: (input: TInput, request: Request) => Promise<Result<TOutput, AppError>>;
  onError?: (error: AppError) => Response;
}

export function createActionHandler<TInput = unknown, TOutput = unknown>(
  config: ActionHandlerConfig<TInput, TOutput>
): (args: ActionFunctionArgs) => Promise<Response> {
  return async ({ request }: ActionFunctionArgs) => {
    const requestLogger = createRequestLogger(request);
    let ctx: AuthContext;
    try {
      const { session, admin } = await authenticate.admin(request);
      ctx = {
        session,
        admin,
        shopDomain: session.shop,
        logger: requestLogger,
      };
    } catch (error) {
      requestLogger.error("Authentication failed", error);
      return json(
        { success: false, error: "Authentication required", code: ErrorCode.AUTH_INVALID_TOKEN },
        { status: 401 }
      );
    }
    try {
      let input: TInput;
      if (config.validate) {
        const body = await parseRequestBody(request);
        const validationResult = config.validate(body);
        if (!validationResult.ok) {
          return handleError(validationResult.error, ctx, config.onError);
        }
        input = validationResult.value;
      } else {
        input = (await parseRequestBody(request)) as TInput;
      }
      const result = await config.execute(input, ctx);
      if (!result.ok) {
        return handleError(result.error, ctx, config.onError);
      }
      return json(
        { success: true, data: result.value },
        { status: config.successStatus || 200 }
      );
    } catch (error) {
      const appError = ensureAppError(error);
      return handleError(appError, ctx, config.onError);
    }
  };
}

export function createLoaderHandler<TOutput>(
  config: LoaderHandlerConfig<TOutput>
): (args: LoaderFunctionArgs) => Promise<Response> {
  return async ({ request }: LoaderFunctionArgs) => {
    const requestLogger = createRequestLogger(request);
    let ctx: AuthContext;
    try {
      const { session, admin } = await authenticate.admin(request);
      ctx = {
        session,
        admin,
        shopDomain: session.shop,
        logger: requestLogger,
      };
    } catch (error) {
      requestLogger.error("Authentication failed", error);
      return json(
        { success: false, error: "Authentication required", code: ErrorCode.AUTH_INVALID_TOKEN },
        { status: 401 }
      );
    }
    try {
      const result = await config.execute(ctx);
      if (!result.ok) {
        return handleError(result.error, ctx, config.onError);
      }
      return json({ success: true, data: result.value });
    } catch (error) {
      const appError = ensureAppError(error);
      return handleError(appError, ctx, config.onError);
    }
  };
}

export function createPublicActionHandler<TInput = unknown, TOutput = unknown>(
  config: PublicHandlerConfig<TInput, TOutput>
): (args: ActionFunctionArgs) => Promise<Response> {
  return async ({ request }: ActionFunctionArgs) => {
    try {
      let input: TInput;
      if (config.validate) {
        const body = await parseRequestBody(request);
        const validationResult = config.validate(body);
        if (!validationResult.ok) {
          return handlePublicError(validationResult.error, config.onError);
        }
        input = validationResult.value;
      } else {
        input = (await parseRequestBody(request)) as TInput;
      }
      const result = await config.execute(input, request);
      if (!result.ok) {
        return handlePublicError(result.error, config.onError);
      }
      return json({ success: true, data: result.value });
    } catch (error) {
      const appError = ensureAppError(error);
      return handlePublicError(appError, config.onError);
    }
  };
}

export interface WebhookHandlerConfig<TPayload, TOutput> {
  topic?: string;
  validate?: (payload: unknown) => Result<TPayload, AppError>;
  execute: (
    payload: TPayload,
    context: {
      shop: string;
      webhookId: string | null;
      topic: string;
      admin?: AdminApiContext;
    }
  ) => Promise<Result<TOutput, AppError>>;
  async?: boolean;
}

export function createWebhookHandler<TPayload = unknown, TOutput = unknown>(
  config: WebhookHandlerConfig<TPayload, TOutput>
): (args: ActionFunctionArgs) => Promise<Response> {
  return async ({ request }: ActionFunctionArgs) => {
    try {
      const authResult = await authenticate.webhook(request);
      const { topic, shop, payload, admin } = authResult;
      if (config.topic && topic !== config.topic) {
        return new Response("OK", { status: 200 });
      }
      const webhookId =
        (authResult as any).webhookId ??
        request.headers.get("X-Shopify-Event-Id") ??
        request.headers.get("X-Shopify-Webhook-Id") ??
        null;
      let validatedPayload: TPayload;
      if (config.validate) {
        const validationResult = config.validate(payload);
        if (!validationResult.ok) {
          logger.warn("Webhook payload validation failed", {
            shop,
            topic,
            error: validationResult.error.message,
          });
          return new Response("Invalid payload", { status: 400 });
        }
        validatedPayload = validationResult.value;
      } else {
        validatedPayload = payload as TPayload;
      }
      if (config.async) {
        safeFireAndForget(
          config.execute(validatedPayload, { shop, webhookId, topic, admin }),
          {
            operation: "asyncWebhookProcessing",
            metadata: { shop, topic },
          }
        );
        return new Response("OK", { status: 200 });
      }
      const result = await config.execute(validatedPayload, { shop, webhookId, topic, admin });
      if (!result.ok) {
        logger.error("Webhook processing failed", result.error, { shop, topic });
        return new Response(result.error.message, { status: 500 });
      }
      return new Response("OK", { status: 200 });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      logger.error("Webhook handler error", error);
      return new Response("Internal error", { status: 500 });
    }
  };
}

async function parseRequestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await readJsonWithSizeLimit(request);
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      logger.warn("Failed to parse JSON body", { error: error instanceof Error ? error.message : String(error) });
      return {};
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const data: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }
    return data;
  }
  return {};
}

function handleError(
  error: AppError,
  ctx: AuthContext,
  customHandler?: (error: AppError, ctx: AuthContext) => Response
): Response {
  ctx.logger.error("Request failed", error, {
    code: error.code,
    shopDomain: ctx.shopDomain,
  });
  if (customHandler) {
    return customHandler(error, ctx);
  }
  const status = error.getHttpStatus();
  const { code, message } = error.toClientResponse();
  return json({ success: false, error: message, code }, { status });
}

function handlePublicError(
  error: AppError,
  customHandler?: (error: AppError) => Response
): Response {
  logger.error("Public request failed", error, { code: error.code });
  if (customHandler) {
    return customHandler(error);
  }
  const status = error.getHttpStatus();
  const { code, message } = error.toClientResponse();
  return json({ success: false, error: message, code }, { status });
}

export function createValidator<T>(
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } } }
): (data: unknown) => Result<T, AppError> {
  return (data: unknown): Result<T, AppError> => {
    const result = schema.safeParse(data);
    if (result.success) {
      return ok(result.data);
    }
    const errors = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return err(
      new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Validation failed: ${errors}`,
        false,
        { validationErrors: result.error.issues }
      )
    );
  };
}

export function composeValidators<T>(
  ...validators: Array<(data: T) => Result<T, AppError>>
): (data: T) => Result<T, AppError> {
  return (data: T): Result<T, AppError> => {
    for (const validator of validators) {
      const result = validator(data);
      if (!result.ok) {
        return result;
      }
      data = result.value;
    }
    return ok(data);
  };
}
