/**
 * Logging utility for Tracking Guardian
 * 
 * Controls log output based on environment:
 * - Production: Only error and warn levels
 * - Development: All levels including debug
 * 
 * Usage:
 *   import { logger } from "../utils/logger";
 *   logger.info("Operation completed", { orderId: "123" });
 *   logger.error("Failed to process", error);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
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
