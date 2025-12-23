/**
 * Container Types
 *
 * Type definitions for the dependency injection container.
 * Provides interfaces for all injectable services.
 */

import type { PrismaClient } from "@prisma/client";

// =============================================================================
// Logger Interface
// =============================================================================

/**
 * Log level types
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log context for structured logging
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Logger interface - abstracts logging implementation
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  log(level: LogLevel, message: string, context?: LogContext): void;
  child(additionalContext: LogContext): ILogger;
}

// =============================================================================
// Database Interface
// =============================================================================

/**
 * Database client interface - abstracts Prisma
 */
export type IDatabase = PrismaClient;

// =============================================================================
// Config Interface
// =============================================================================

/**
 * Environment configuration
 */
export interface IEnvConfig {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  isDevelopment: boolean;
}

/**
 * API configuration
 */
export interface IApiConfig {
  maxBodySize: number;
  timestampWindowMs: number;
  defaultTimeoutMs: number;
  jwtExpiryBufferMs: number;
}

/**
 * Rate limit configuration for an endpoint
 */
export interface IRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Retry configuration
 */
export interface IRetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}

/**
 * Data retention configuration
 */
export interface IRetentionConfig {
  minDays: number;
  maxDays: number;
  defaultDays: number;
  auditLogDays: number;
  nonceExpiryMs: number;
  webhookLogDays: number;
  receiptDays: number;
}

/**
 * Feature flags
 */
export interface IFeatureFlags {
  funnelEvents: boolean;
  debugLogging: boolean;
  extendedPayload: boolean;
  trackingApi: boolean;
  piiHashing: boolean;
  checkoutBlocks: boolean;
}

/**
 * Complete application configuration interface
 */
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

// =============================================================================
// Request Context
// =============================================================================

/**
 * Request context stored in AsyncLocalStorage
 */
export interface IRequestContext {
  /** Unique request ID */
  requestId: string;
  /** Correlation ID for distributed tracing */
  correlationId: string;
  /** Shop domain if authenticated */
  shopDomain?: string;
  /** Current order ID being processed */
  orderId?: string;
  /** Current job ID being processed */
  jobId?: string;
  /** Current platform being processed */
  platform?: string;
  /** Request start timestamp */
  startTime: number;
  /** Additional context data */
  [key: string]: unknown;
}

// =============================================================================
// Application Context (DI Container)
// =============================================================================

/**
 * Application context - the main DI container
 * 
 * Provides access to all application services and dependencies.
 * Services should receive this context rather than importing dependencies directly.
 */
export interface IAppContext {
  /** Prisma database client */
  db: IDatabase;
  /** Logger instance */
  logger: ILogger;
  /** Application configuration */
  config: IAppConfig;
}

/**
 * Scoped context - per-request context with request-specific data
 */
export interface IScopedContext extends IAppContext {
  /** Request-specific context */
  request: IRequestContext;
  /** Request-scoped logger with correlation ID */
  requestLogger: ILogger;
}

// =============================================================================
// Service Factory Types
// =============================================================================

/**
 * Service factory function type
 */
export type ServiceFactory<T> = (context: IAppContext) => T;

/**
 * Scoped service factory function type
 */
export type ScopedServiceFactory<T> = (context: IScopedContext) => T;

// =============================================================================
// Container Interface
// =============================================================================

/**
 * Service container for dependency injection
 */
export interface IContainer {
  /** Get the application context */
  getContext(): IAppContext;
  
  /** Create a scoped context for a request */
  createScopedContext(requestContext: IRequestContext): IScopedContext;
  
  /** Register a singleton service */
  registerSingleton<T>(key: string, factory: ServiceFactory<T>): void;
  
  /** Register a scoped service (per-request) */
  registerScoped<T>(key: string, factory: ScopedServiceFactory<T>): void;
  
  /** Get a registered service */
  resolve<T>(key: string): T;
  
  /** Get a scoped service */
  resolveScoped<T>(key: string, scopedContext: IScopedContext): T;
}

