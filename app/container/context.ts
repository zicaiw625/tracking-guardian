/**
 * Application Context Implementation
 *
 * Provides the DI container implementation with request context management.
 * Uses AsyncLocalStorage for request-scoped context propagation.
 */

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

// =============================================================================
// Request Context Storage
// =============================================================================

/**
 * AsyncLocalStorage for request context propagation
 */
export const requestContextStorage = new AsyncLocalStorage<IRequestContext>();

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Generate a correlation ID
 */
export function generateCorrelationId(): string {
  return randomBytes(12).toString("hex");
}

/**
 * Get request ID from headers or generate new one
 */
export function extractRequestId(request: Request): string {
  return (
    request.headers.get("X-Request-Id") ||
    request.headers.get("X-Correlation-Id") ||
    generateRequestId()
  );
}

/**
 * Get correlation ID from headers or generate new one
 */
export function extractCorrelationId(request: Request): string {
  return (
    request.headers.get("X-Correlation-Id") ||
    request.headers.get("X-Request-Id") ||
    generateCorrelationId()
  );
}

/**
 * Create a request context from a Request object
 */
export function createRequestContext(request: Request): IRequestContext {
  return {
    requestId: extractRequestId(request),
    correlationId: extractCorrelationId(request),
    startTime: Date.now(),
  };
}

/**
 * Create a request context from raw values
 */
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

/**
 * Get the current request context from AsyncLocalStorage
 */
export function getCurrentRequestContext(): IRequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Run a function with a request context
 */
export function withRequestContext<T>(
  context: IRequestContext,
  fn: () => T
): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Run an async function with a request context
 */
export async function withRequestContextAsync<T>(
  context: IRequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Update the current request context
 */
export function updateRequestContext(updates: Partial<IRequestContext>): void {
  const current = requestContextStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

// =============================================================================
// Logger Wrapper
// =============================================================================

/**
 * Create a logger that automatically includes request context
 */
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

// =============================================================================
// Application Context Factory
// =============================================================================

/**
 * Application context implementation
 */
class AppContext implements IAppContext {
  constructor(
    public readonly db: PrismaClient,
    public readonly logger: ILogger,
    public readonly config: IAppConfig
  ) {}
}

/**
 * Scoped context implementation
 */
class ScopedContext implements IScopedContext {
  public readonly requestLogger: ILogger;

  constructor(
    public readonly db: PrismaClient,
    public readonly logger: ILogger,
    public readonly config: IAppConfig,
    public readonly request: IRequestContext
  ) {
    // Create a logger with request context
    this.requestLogger = logger.child({
      requestId: request.requestId,
      correlationId: request.correlationId,
      ...(request.shopDomain && { shopDomain: request.shopDomain }),
    });
  }
}

/**
 * Create the application context
 */
export function createAppContext(
  db: PrismaClient,
  logger: ILogger,
  config: IAppConfig
): IAppContext {
  // Wrap logger to automatically include request context from AsyncLocalStorage
  const contextAwareLogger = createContextAwareLogger(
    logger,
    getCurrentRequestContext
  );
  
  return new AppContext(db, contextAwareLogger, config);
}

/**
 * Create a scoped context for a request
 */
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

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Get elapsed time since request start
 */
export function getRequestElapsedMs(context: IRequestContext): number {
  return Date.now() - context.startTime;
}

/**
 * Add shop domain to current request context
 */
export function setShopDomain(shopDomain: string): void {
  updateRequestContext({ shopDomain });
}

/**
 * Add order ID to current request context
 */
export function setOrderId(orderId: string): void {
  updateRequestContext({ orderId });
}

/**
 * Add job ID to current request context
 */
export function setJobId(jobId: string): void {
  updateRequestContext({ jobId });
}

/**
 * Add platform to current request context
 */
export function setPlatform(platform: string): void {
  updateRequestContext({ platform });
}

