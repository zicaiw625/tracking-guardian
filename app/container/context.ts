import { AsyncLocalStorage } from "async_hooks";
import { randomBytes } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  IAppContext,
  IScopedContext,
  IRequestContext,
  ILogger,
  IAppConfig,
  LogContext,
  LogLevel,
} from "./types";

export const requestContextStorage = new AsyncLocalStorage<IRequestContext>();

export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

export function generateCorrelationId(): string {
  return randomBytes(12).toString("hex");
}

export function extractRequestId(request: Request): string {
  return (
    request.headers.get("X-Request-Id") ||
    request.headers.get("X-Correlation-Id") ||
    generateRequestId()
  );
}

export function extractCorrelationId(request: Request): string {
  return (
    request.headers.get("X-Correlation-Id") ||
    request.headers.get("X-Request-Id") ||
    generateCorrelationId()
  );
}

export function createRequestContext(request: Request): IRequestContext {
  return {
    requestId: extractRequestId(request),
    correlationId: extractCorrelationId(request),
    startTime: Date.now(),
  };
}

export function createRequestContextFromValues(
  requestId?: string,
  correlationId?: string
): IRequestContext {
  const rid = requestId || generateRequestId();
  return {
    requestId: rid,
    correlationId: correlationId || rid,
    startTime: Date.now(),
  };
}

export function getCurrentRequestContext(): IRequestContext | undefined {
  return requestContextStorage.getStore();
}

export function withRequestContext<T>(
  context: IRequestContext,
  fn: () => T
): T {
  return requestContextStorage.run(context, fn);
}

export async function withRequestContextAsync<T>(
  context: IRequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

export function updateRequestContext(updates: Partial<IRequestContext>): void {
  const current = requestContextStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

export function createContextAwareLogger(
  baseLogger: ILogger,
  getContext: () => IRequestContext | undefined
): ILogger {
  const enrichContext = (context?: LogContext): LogContext => {
    const reqCtx = getContext();
    if (!reqCtx) return context || {};

    return {
      requestId: reqCtx.requestId,
      correlationId: reqCtx.correlationId,
      ...(reqCtx.shopDomain && { shopDomain: reqCtx.shopDomain }),
      ...(reqCtx.orderId && { orderId: reqCtx.orderId }),
      ...(reqCtx.jobId && { jobId: reqCtx.jobId }),
      ...(reqCtx.platform && { platform: reqCtx.platform }),
      ...context,
    };
  };

  return {
    debug(message: string, context?: LogContext): void {
      baseLogger.debug(message, enrichContext(context));
    },
    info(message: string, context?: LogContext): void {
      baseLogger.info(message, enrichContext(context));
    },
    warn(message: string, context?: LogContext): void {
      baseLogger.warn(message, enrichContext(context));
    },
    error(message: string, error?: Error | unknown, context?: LogContext): void {
      baseLogger.error(message, error, enrichContext(context));
    },
    log(level: LogLevel, message: string, context?: LogContext): void {
      baseLogger.log(level, message, enrichContext(context));
    },
    child(additionalContext: LogContext): ILogger {
      return createContextAwareLogger(
        baseLogger.child(additionalContext),
        getContext
      );
    },
  };
}

class AppContext implements IAppContext {
  constructor(
    public readonly db: PrismaClient,
    public readonly logger: ILogger,
    public readonly config: IAppConfig
  ) {}
}

class ScopedContext implements IScopedContext {
  public readonly requestLogger: ILogger;

  constructor(
    public readonly db: PrismaClient,
    public readonly logger: ILogger,
    public readonly config: IAppConfig,
    public readonly request: IRequestContext
  ) {

    this.requestLogger = logger.child({
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(request.shopDomain && { shopDomain: request.shopDomain }),
    });
  }
}

export function createAppContext(
  db: PrismaClient,
  logger: ILogger,
  config: IAppConfig
): IAppContext {

  const contextAwareLogger = createContextAwareLogger(
    logger,
    getCurrentRequestContext
  );

  return new AppContext(db, contextAwareLogger, config);
}

export function createScopedContext(
  appContext: IAppContext,
  requestContext: IRequestContext
): IScopedContext {
  return new ScopedContext(
    appContext.db,
    appContext.logger,
    appContext.config,
    requestContext
  );
}

export function getRequestElapsedMs(context: IRequestContext): number {
  return Date.now() - context.startTime;
}

export function setShopDomain(shopDomain: string): void {
  updateRequestContext({ shopDomain });
}

export function setOrderId(orderId: string): void {
  updateRequestContext({ orderId });
}

export function setJobId(jobId: string): void {
  updateRequestContext({ jobId });
}

export function setPlatform(platform: string): void {
  updateRequestContext({ platform });
}
