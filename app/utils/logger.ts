/**
 * Logging utility for Tracking Guardian
 * 
 * P2-3: Enhanced with requestId support for request tracing
 * 
 * Controls log output based on environment:
 * - Production: Only error and warn levels
 * - Development: All levels including debug
 * 
 * Usage:
 *   import { logger, createRequestLogger } from "../utils/logger";
 *   
 *   // Basic logging
 *   logger.info("Operation completed", { orderId: "123" });
 *   logger.error("Failed to process", error);
 *   
 *   // Request-scoped logging
 *   const reqLogger = createRequestLogger(request);
 *   reqLogger.info("Processing order", { orderId: "123" });
 */

import { randomBytes } from "crypto";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

// P2-3: Request ID header name
const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * Generate a short unique request ID
 */
export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Extract or generate request ID from a request
 */
export function getRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER) || generateRequestId();
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Minimum log level based on environment
const MIN_LOG_LEVEL: LogLevel = process.env.NODE_ENV === "production" ? "warn" : "debug";

/**
 * Format log message with timestamp and level
 */
function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  if (context && Object.keys(context).length > 0) {
    // Sanitize context - remove sensitive fields
    const sanitizedContext = sanitizeContext(context);
    return `${prefix} ${message} ${JSON.stringify(sanitizedContext)}`;
  }
  
  return `${prefix} ${message}`;
}

/**
 * Remove sensitive fields from log context
 */
function sanitizeContext(context: LogContext): LogContext {
  const sensitiveFields = [
    "accessToken",
    "access_token",
    "apiSecret",
    "api_secret",
    "password",
    "token",
    "secret",
    "credentials",
    "authorization",
  ];
  
  const sanitized: LogContext = {};
  
  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveFields.some((f) => lowerKey.includes(f))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeContext(value as LogContext);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

/**
 * Logger instance with level-specific methods
 */
export const logger = {
  /**
   * Debug level - development only
   */
  debug(message: string, context?: LogContext): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", message, context));
    }
  },

  /**
   * Info level - general information
   */
  info(message: string, context?: LogContext): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", message, context));
    }
  },

  /**
   * Warning level - potential issues
   */
  warn(message: string, context?: LogContext): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  /**
   * Error level - errors and exceptions
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (shouldLog("error")) {
      const errorContext: LogContext = { ...context };
      
      if (error instanceof Error) {
        errorContext.errorMessage = error.message;
        errorContext.errorStack = error.stack;
      } else if (error) {
        errorContext.error = String(error);
      }
      
      console.error(formatMessage("error", message, errorContext));
    }
  },

  /**
   * Log with custom level
   */
  log(level: LogLevel, message: string, context?: LogContext): void {
    if (shouldLog(level)) {
      const formatted = formatMessage(level, message, context);
      switch (level) {
        case "debug":
          console.debug(formatted);
          break;
        case "info":
          console.info(formatted);
          break;
        case "warn":
          console.warn(formatted);
          break;
        case "error":
          console.error(formatted);
          break;
      }
    }
  },
};

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
  return MIN_LOG_LEVEL;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return shouldLog("debug");
}

// ==========================================
// P2-3: Request-Scoped Logger
// ==========================================

/**
 * Logger interface with requestId support
 */
export interface RequestLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  child(additionalContext: LogContext): RequestLogger;
  readonly requestId: string;
}

/**
 * Create a request-scoped logger with automatic requestId injection
 */
export function createRequestLogger(
  requestOrId: Request | string,
  baseContext?: LogContext
): RequestLogger {
  const requestId = typeof requestOrId === "string" 
    ? requestOrId 
    : getRequestId(requestOrId);
  
  const contextWithRequestId: LogContext = {
    ...baseContext,
    requestId,
  };
  
  return {
    requestId,
    
    debug(message: string, context?: LogContext): void {
      logger.debug(message, { ...contextWithRequestId, ...context });
    },
    
    info(message: string, context?: LogContext): void {
      logger.info(message, { ...contextWithRequestId, ...context });
    },
    
    warn(message: string, context?: LogContext): void {
      logger.warn(message, { ...contextWithRequestId, ...context });
    },
    
    error(message: string, error?: Error | unknown, context?: LogContext): void {
      logger.error(message, error, { ...contextWithRequestId, ...context });
    },
    
    child(additionalContext: LogContext): RequestLogger {
      return createRequestLogger(requestId, {
        ...contextWithRequestId,
        ...additionalContext,
      });
    },
  };
}

// ==========================================
// P2-3: Key Metrics Logging
// ==========================================

/**
 * Log metrics for monitoring and alerting
 */
export const metrics = {
  /**
   * Log pixel event metrics
   */
  pixelEvent(context: {
    requestId: string;
    shopDomain: string;
    eventName: string;
    status: "received" | "verified" | "recorded" | "failed";
    duration?: number;
    error?: string;
  }): void {
    logger.info(`[METRIC] pixel_event`, {
      ...context,
      _metric: "pixel_event",
    });
  },
  
  /**
   * Log webhook processing metrics
   */
  webhookProcessing(context: {
    requestId?: string;
    shopDomain: string;
    orderId: string;
    platform: string;
    status: "started" | "consent_pending" | "sent" | "failed" | "retrying";
    duration?: number;
    error?: string;
  }): void {
    logger.info(`[METRIC] webhook_processing`, {
      ...context,
      _metric: "webhook_processing",
    });
  },
  
  /**
   * Log retry queue metrics
   */
  retryQueue(context: {
    action: "scheduled" | "processed" | "dead_letter";
    platform: string;
    attempt: number;
    reason?: string;
  }): void {
    logger.info(`[METRIC] retry_queue`, {
      ...context,
      _metric: "retry_queue",
    });
  },
  
  /**
   * Log rate limit metrics
   */
  rateLimit(context: {
    endpoint: string;
    key: string;
    blocked: boolean;
    remaining?: number;
  }): void {
    if (context.blocked) {
      logger.warn(`[METRIC] rate_limited`, {
        ...context,
        _metric: "rate_limit",
      });
    }
  },
  
  /**
   * Log circuit breaker metrics
   */
  circuitBreaker(context: {
    shopDomain: string;
    action: "tripped" | "reset";
    count?: number;
  }): void {
    logger.warn(`[METRIC] circuit_breaker`, {
      ...context,
      _metric: "circuit_breaker",
    });
  },
};
