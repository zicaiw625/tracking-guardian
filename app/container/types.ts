import type { PrismaClient } from "@prisma/client";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  log(level: LogLevel, message: string, context?: LogContext): void;
  child(additionalContext: LogContext): ILogger;
}

export type IDatabase = PrismaClient;

export interface IEnvConfig {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  isDevelopment: boolean;
}

export interface IApiConfig {
  maxBodySize: number;
  timestampWindowMs: number;
  defaultTimeoutMs: number;
  jwtExpiryBufferMs: number;
}

export interface IRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface IRetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

export interface IRetentionConfig {
  minDays: number;
  maxDays: number;
  defaultDays: number;
  auditLogDays: number;
  nonceExpiryMs: number;
  webhookLogDays: number;
  receiptDays: number;
}

export interface IFeatureFlags {
  funnelEvents: boolean;
  debugLogging: boolean;
  extendedPayload: boolean;
  trackingApi: boolean;
  checkoutBlocks: boolean;
}

export interface IAppConfig {
  env: IEnvConfig;
  api: IApiConfig;
  retry: IRetryConfig;
  retention: IRetentionConfig;
  features: IFeatureFlags;
  getEnv(key: string, defaultValue?: string): string;
  getRequiredEnv(key: string): string;
  getBoolEnv(key: string, defaultValue?: boolean): boolean;
  getNumEnv(key: string, defaultValue: number): number;
}

export interface IRequestContext {
  requestId: string;
  correlationId: string;
  shopDomain?: string;
  orderId?: string;
  jobId?: string;
  platform?: string;
  startTime: number;
  [key: string]: unknown;
}

export interface IAppContext {
  db: IDatabase;
  logger: ILogger;
  config: IAppConfig;
}

export interface IScopedContext extends IAppContext {
  request: IRequestContext;
  requestLogger: ILogger;
}

export type ServiceFactory<T> = (context: IAppContext) => T;

export type ScopedServiceFactory<T> = (context: IScopedContext) => T;

export interface IContainer {
  getContext(): IAppContext;
  createScopedContext(requestContext: IRequestContext): IScopedContext;
  registerSingleton<T>(key: string, factory: ServiceFactory<T>): void;
  registerScoped<T>(key: string, factory: ScopedServiceFactory<T>): void;
  resolve<T>(key: string): T;
  resolveScoped<T>(key: string, scopedContext: IScopedContext): T;
}
