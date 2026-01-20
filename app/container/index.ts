import type { PrismaClient } from "@prisma/client";
import prisma from "../db.server";
import { logger as baseLogger } from "../utils/logger.server";
import {
  FEATURE_FLAGS,
  RETENTION_CONFIG,
  API_CONFIG,
  RETRY_CONFIG,
  getEnv,
  getRequiredEnv,
  getBoolEnv,
  getNumEnv,
  isProduction,
  isDevelopment,
} from "../utils/config.server";
import type {
  IAppContext,
  IScopedContext,
  IRequestContext,
  ILogger,
  IAppConfig,
  IContainer,
  ServiceFactory,
  ScopedServiceFactory,
  LogContext,
  LogLevel,
} from "./types";
import {
  createAppContext,
  createScopedContext,
  createRequestContext,
  withRequestContextAsync,
  getRequestElapsedMs,
} from "./context";

export type {
  IAppContext,
  IScopedContext,
  IRequestContext,
  ILogger,
  IAppConfig,
  IContainer,
  ServiceFactory,
  ScopedServiceFactory,
  LogContext,
  LogLevel,
} from "./types";

export {
  createRequestContext,
  createRequestContextFromValues,
  withRequestContext,
  withRequestContextAsync,
  getCurrentRequestContext,
  updateRequestContext,
  setShopDomain,
  setOrderId,
  setJobId,
  setPlatform,
  getRequestElapsedMs,
  generateRequestId,
  generateCorrelationId,
} from "./context";

function createLoggerAdapter(logger: typeof baseLogger): ILogger {
  return {
    debug: (message: string, context?: LogContext) => logger.debug(message, context),
    info: (message: string, context?: LogContext) => logger.info(message, context),
    warn: (message: string, context?: LogContext) => logger.warn(message, context),
    error: (message: string, error?: Error | unknown, context?: LogContext) =>
      logger.error(message, error, context),
    log: (level: LogLevel, message: string, context?: LogContext) =>
      logger.log(level, message, context),
    child: (additionalContext: LogContext) =>
      createLoggerAdapter(logger.child(additionalContext)),
  };
}

function createConfigAdapter(): IAppConfig {
  return {
    env: {
      nodeEnv: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
      isProduction: isProduction(),
      isDevelopment: isDevelopment(),
    },
    api: {
      maxBodySize: API_CONFIG.MAX_BODY_SIZE,
      timestampWindowMs: API_CONFIG.TIMESTAMP_WINDOW_MS,
      defaultTimeoutMs: API_CONFIG.DEFAULT_TIMEOUT_MS,
      jwtExpiryBufferMs: API_CONFIG.JWT_EXPIRY_BUFFER_MS,
    },
    retry: {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      initialBackoffMs: RETRY_CONFIG.INITIAL_BACKOFF_MS,
      maxBackoffMs: RETRY_CONFIG.MAX_BACKOFF_MS,
      backoffMultiplier: RETRY_CONFIG.BACKOFF_MULTIPLIER,
      jitterFactor: RETRY_CONFIG.JITTER_FACTOR,
    },
    retention: {
      minDays: RETENTION_CONFIG.MIN_DAYS,
      maxDays: RETENTION_CONFIG.MAX_DAYS,
      defaultDays: RETENTION_CONFIG.DEFAULT_DAYS,
      auditLogDays: RETENTION_CONFIG.AUDIT_LOG_DAYS,
      nonceExpiryMs: RETENTION_CONFIG.NONCE_EXPIRY_MS,
      webhookLogDays: RETENTION_CONFIG.WEBHOOK_LOG_DAYS,
      receiptDays: RETENTION_CONFIG.RECEIPT_DAYS,
    },
    features: {
      funnelEvents: FEATURE_FLAGS.FUNNEL_EVENTS,
      debugLogging: FEATURE_FLAGS.DEBUG_LOGGING,
      extendedPayload: FEATURE_FLAGS.EXTENDED_PAYLOAD,
      trackingApi: FEATURE_FLAGS.TRACKING_API,
      checkoutBlocks: FEATURE_FLAGS.CHECKOUT_BLOCKS,
      reorderEnabled: FEATURE_FLAGS.REORDER_ENABLED,
    },
    getEnv,
    getRequiredEnv,
    getBoolEnv,
    getNumEnv,
  };
}

class Container implements IContainer {
  private appContext: IAppContext | null = null;
  private singletons = new Map<string, unknown>();
  private singletonFactories = new Map<string, ServiceFactory<unknown>>();
  private scopedFactories = new Map<string, ScopedServiceFactory<unknown>>();
  initialize(
    db: PrismaClient,
    logger: ILogger,
    config: IAppConfig
  ): void {
    this.appContext = createAppContext(db, logger, config);
  }
  getContext(): IAppContext {
    if (!this.appContext) {
      throw new Error("Container not initialized. Call initialize() first.");
    }
    return this.appContext;
  }
  createScopedContext(requestContext: IRequestContext): IScopedContext {
    return createScopedContext(this.getContext(), requestContext);
  }
  registerSingleton<T>(key: string, factory: ServiceFactory<T>): void {
    this.singletonFactories.set(key, factory as ServiceFactory<unknown>);
  }
  registerScoped<T>(key: string, factory: ScopedServiceFactory<T>): void {
    this.scopedFactories.set(key, factory as ScopedServiceFactory<unknown>);
  }
  resolve<T>(key: string): T {
    if (this.singletons.has(key)) {
      return this.singletons.get(key) as T;
    }
    const factory = this.singletonFactories.get(key);
    if (!factory) {
      throw new Error(`Service "${key}" not registered`);
    }
    const instance = factory(this.getContext());
    this.singletons.set(key, instance);
    return instance as T;
  }
  resolveScoped<T>(key: string, scopedContext: IScopedContext): T {
    const factory = this.scopedFactories.get(key);
    if (!factory) {
      throw new Error(`Scoped service "${key}" not registered`);
    }
    return factory(scopedContext) as T;
  }
  clearSingletons(): void {
    this.singletons.clear();
  }
  reset(): void {
    this.appContext = null;
    this.singletons.clear();
    this.singletonFactories.clear();
    this.scopedFactories.clear();
  }
}

export const container = new Container();

container.initialize(
  prisma,
  createLoggerAdapter(baseLogger),
  createConfigAdapter()
);

export function getAppContext(): IAppContext {
  return container.getContext();
}

export function getDb(): PrismaClient {
  return container.getContext().db;
}

export function getLogger(): ILogger {
  return container.getContext().logger;
}

export function getConfig(): IAppConfig {
  return container.getContext().config;
}

export function withContext<T>(
  handler: (request: Request, ctx: IScopedContext) => Promise<T>
): (args: { request: Request }) => Promise<T> {
  return async ({ request }) => {
    const requestCtx = createRequestContext(request);
    return withRequestContextAsync(requestCtx, async () => {
      const scopedCtx = container.createScopedContext(requestCtx);
      scopedCtx.requestLogger.debug("Request started", {
        method: request.method,
        url: new URL(request.url).pathname,
      });
      try {
        const result = await handler(request, scopedCtx);
        scopedCtx.requestLogger.debug("Request completed", {
          durationMs: getRequestElapsedMs(requestCtx),
        });
        return result;
      } catch (error) {
        scopedCtx.requestLogger.error("Request failed", error, {
          durationMs: getRequestElapsedMs(requestCtx),
        });
        throw error;
      }
    });
  };
}

export function registerService<T>(
  key: string,
  factory: ServiceFactory<T>
): void {
  container.registerSingleton(key, factory);
}

export function registerScopedService<T>(
  key: string,
  factory: ScopedServiceFactory<T>
): void {
  container.registerScoped(key, factory);
}

export function resolveService<T>(key: string): T {
  return container.resolve<T>(key);
}

export function createMockContext(overrides?: {
  db?: Partial<PrismaClient>;
  logger?: Partial<ILogger>;
  config?: Partial<IAppConfig>;
}): IAppContext {
  const mockLogger: ILogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    child: () => mockLogger,
    ...overrides?.logger,
  };
  const mockConfig: IAppConfig = {
    env: { nodeEnv: "test", isProduction: false, isDevelopment: false },
    api: { maxBodySize: 32768, timestampWindowMs: 600000, defaultTimeoutMs: 30000, jwtExpiryBufferMs: 300000 },
    retry: { maxAttempts: 5, initialBackoffMs: 1000, maxBackoffMs: 300000, backoffMultiplier: 2, jitterFactor: 0.1 },
    retention: { minDays: 30, maxDays: 365, defaultDays: 90, auditLogDays: 365, nonceExpiryMs: 3600000, webhookLogDays: 7, receiptDays: 90 },
    features: { funnelEvents: false, debugLogging: false, extendedPayload: false, trackingApi: false, piiHashing: false, checkoutBlocks: false, reorderEnabled: false },
    getEnv: () => "",
    getRequiredEnv: () => "",
    getBoolEnv: () => false,
    getNumEnv: () => 0,
    ...overrides?.config,
  };
  return {
    db: (overrides?.db || {}) as PrismaClient,
    logger: mockLogger,
    config: mockConfig,
  };
}

export function createMockScopedContext(
  overrides?: Parameters<typeof createMockContext>[0],
  requestOverrides?: Partial<IRequestContext>
): IScopedContext {
  const appContext = createMockContext(overrides);
  const requestContext: IRequestContext = {
    requestId: "test-request-id",
    correlationId: "test-correlation-id",
    startTime: Date.now(),
    ...requestOverrides,
  };
  return {
    ...appContext,
    request: requestContext,
    requestLogger: appContext.logger,
  };
}
