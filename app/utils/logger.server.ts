import { randomBytes } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { hashValueSync } from "./crypto.server";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

interface CorrelationContext {
  correlationId: string;
  shopDomain?: string;
  orderId?: string;
  jobId?: string;
  platform?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  shopDomain?: string;
  orderId?: string;
  jobId?: string;
  platform?: string;
  duration?: number;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
  [key: string]: unknown;
}

const REQUEST_ID_HEADER = "X-Request-Id";
const CORRELATION_ID_HEADER = "X-Correlation-Id";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LOG_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "info" : "debug";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function generateCorrelationId(): string {
  return randomBytes(12).toString("hex");
}

export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

export function getRequestId(request: Request): string {
  return request.headers.get(REQUEST_ID_HEADER) || generateRequestId();
}

export function getCorrelationId(request: Request): string {
  return (
    request.headers.get(CORRELATION_ID_HEADER) ||
    request.headers.get(REQUEST_ID_HEADER) ||
    generateCorrelationId()
  );
}

export function withCorrelation<T>(
  context: Partial<CorrelationContext>,
  fn: () => T
): T {
  const existingContext = correlationStorage.getStore();
  const newContext: CorrelationContext = {
    correlationId: context.correlationId || existingContext?.correlationId || generateCorrelationId(),
    ...existingContext,
    ...context,
  };
  return correlationStorage.run(newContext, fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function setCorrelationField(key: string, value: unknown): void {
  const context = correlationStorage.getStore();
  if (context) {
    context[key] = value;
  }
}

const SENSITIVE_FIELD_PATTERNS = [
  "accesstoken",
  "access_token",
  "apisecret",
  "api_secret",
  "password",
  "token",
  "secret",
  "credentials",
  "authorization",
  "bearer",
  "apikey",
  "api_key",
  "email",
  "phone",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "fullname",
  "full_name",
  "customer_name",
  "address",
  "street",
  "city",
  "province",
  "state",
  "country",
  "zip",
  "postal",
  "postcode",
  "creditcard",
  "credit_card",
  "cardnumber",
  "card_number",
  "cvv",
  "expiry",
  "pan",
  "iban",
  "accountnumber",
  "account_number",
  "ingestionsecret",
  "ingestion_secret",
  "ingestion_key",
  "ingestionkey",
  "pixelid",
  "pixel_id",
  "measurementid",
  "measurement_id",
  "webhookurl",
  "webhook_url",
  "bottoken",
  "bot_token",
  "chatid",
  "chat_id",
  "customer",
  "billing",
  "shipping",
  "billing_address",
  "shipping_address",
  "ip_address",
  "ipaddress",
  "client_ip",
  "clientip",
  "remote_addr",
  "remoteaddr",
  "x_forwarded_for",
  "x-forwarded-for",
  "trackingnumber",
  "tracking_number",
  "tracking",
  "checkouttoken",
  "checkout_token",
  "sharetoken",
  "share_token",
];

const EXCLUDED_FIELDS = [
  "orderpayload",
  "order_payload",
  "webhookpayload",
  "webhook_payload",
  "rawpayload",
  "raw_payload",
  "capiinput",
  "capi_input",
  "requestbody",
  "request_body",
  "responsebody",
  "response_body",
  "lineitems",
  "line_items",
  "scriptcontent",
  "script_content",
  "additionalscripts",
  "additional_scripts",
  "analysisresult",
  "analysis_result",
  "scriptsource",
  "script_source",
  "inlinescript",
  "inline_script",
  "rawscript",
  "raw_script",
  "scriptbody",
  "script_body",
];

function safeHash(value: unknown, length: number = 12): string {
  if (typeof value !== "string") return "[REDACTED]";
  const v = value.trim();
  if (v.length === 0) return "[REDACTED]";
  return hashValueSync(v).slice(0, length);
}

function safeUrlForLogging(value: unknown, maxLen: number = 200): string {
  if (typeof value !== "string") return "[REDACTED]";
  const raw = value.trim();
  if (raw.length === 0) return "[REDACTED]";
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString().slice(0, maxLen);
  } catch {
    const cut = raw.split("#")[0]?.split("?")[0] ?? raw;
    return cut.slice(0, maxLen);
  }
}

function sanitizeContext(context: LogContext, depth: number = 0): LogContext {
  if (depth > 5) return { _truncated: true };
  const sanitized: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "orderid" || lowerKey === "order_id") {
      sanitized[key] = safeHash(value, 12);
      continue;
    }
    if (lowerKey === "customerid" || lowerKey === "customer_id") {
      sanitized[key] = safeHash(value, 12);
      continue;
    }
    if (lowerKey === "origin" || lowerKey === "referer" || lowerKey === "referrer" || lowerKey === "url") {
      sanitized[key] = safeUrlForLogging(value, 200);
      continue;
    }
    if (EXCLUDED_FIELDS.some((f) => lowerKey.includes(f))) {
      sanitized[key] = "[EXCLUDED]";
      continue;
    }
    if (SENSITIVE_FIELD_PATTERNS.some((f) => lowerKey.includes(f))) {
      if (
        (lowerKey.includes("trackingnumber") || lowerKey.includes("checkouttoken") || lowerKey.includes("sharetoken")) &&
        typeof value === "string" &&
        value.length > 0
      ) {
        sanitized[key] = hashValueSync(value).slice(0, 12);
      } else {
        sanitized[key] = "[REDACTED]";
      }
    } else if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        const sanitizedArray = value.slice(0, 10).map((item) =>
          typeof item === "object" && item !== null
            ? sanitizeContext(item as LogContext, depth + 1)
            : item
        );
        if (value.length > 10) {
          sanitizedArray.push(`...(${value.length - 10} more)`);
        }
        sanitized[key] = sanitizedArray;
      } else {
        sanitized[key] = sanitizeContext(value as LogContext, depth + 1);
      }
    } else if (typeof value === "string" && value.length > 500) {
      sanitized[key] = value.substring(0, 200) + "...[TRUNCATED]";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function buildLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error | unknown
): LogEntry {
  const correlationContext = correlationStorage.getStore();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (correlationContext) {
    entry.correlationId = correlationContext.correlationId;
    if (correlationContext.shopDomain) entry.shopDomain = correlationContext.shopDomain;
    if (correlationContext.orderId) entry.orderId = safeHash(correlationContext.orderId, 12);
    if (correlationContext.jobId) entry.jobId = correlationContext.jobId;
    if (correlationContext.platform) entry.platform = correlationContext.platform;
  }
  if (error) {
    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else {
      entry.error = { message: String(error) };
    }
  }
  if (context && Object.keys(context).length > 0) {
    const sanitized = sanitizeContext(context);
    Object.assign(entry, sanitized);
  }
  return entry;
}

function formatForConsole(entry: LogEntry): string {
  if (IS_PRODUCTION) {
    return JSON.stringify(entry);
  }
  const { timestamp, level, message, correlationId, ...rest } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const corrId = correlationId ? ` [${correlationId.substring(0, 8)}]` : "";
  if (Object.keys(rest).length > 0) {
    return `${prefix}${corrId} ${message} ${JSON.stringify(rest, null, 2)}`;
  }
  return `${prefix}${corrId} ${message}`;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  log(level: LogLevel, message: string, context?: LogContext): void;
  child(additionalContext: LogContext): Logger;
}

function createChildLogger(additionalContext: LogContext): Logger {
  return {
    debug: (msg: string, ctx?: LogContext) =>
      loggerImpl.debug(msg, { ...additionalContext, ...ctx }),
    info: (msg: string, ctx?: LogContext) =>
      loggerImpl.info(msg, { ...additionalContext, ...ctx }),
    warn: (msg: string, ctx?: LogContext) =>
      loggerImpl.warn(msg, { ...additionalContext, ...ctx }),
    error: (msg: string, err?: Error | unknown, ctx?: LogContext) =>
      loggerImpl.error(msg, err, { ...additionalContext, ...ctx }),
    log: (level: LogLevel, msg: string, ctx?: LogContext) =>
      loggerImpl.log(level, msg, { ...additionalContext, ...ctx }),
    child: (moreContext: LogContext) =>
      createChildLogger({ ...additionalContext, ...moreContext }),
  };
}

const loggerImpl: Logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog("debug")) {
      const entry = buildLogEntry("debug", message, context);
      console.debug(formatForConsole(entry));
    }
  },
  info(message: string, context?: LogContext): void {
    if (shouldLog("info")) {
      const entry = buildLogEntry("info", message, context);
      console.info(formatForConsole(entry));
    }
  },
  warn(message: string, context?: LogContext): void {
    if (shouldLog("warn")) {
      const entry = buildLogEntry("warn", message, context);
      console.warn(formatForConsole(entry));
    }
  },
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (shouldLog("error")) {
      const entry = buildLogEntry("error", message, context, error);
      console.error(formatForConsole(entry));
    }
  },
  log(level: LogLevel, message: string, context?: LogContext): void {
    if (shouldLog(level)) {
      const entry = buildLogEntry(level, message, context);
      const formatted = formatForConsole(entry);
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
  child(additionalContext: LogContext): Logger {
    return createChildLogger(additionalContext);
  },
};

export const logger: Logger = loggerImpl;

export interface RequestLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  child(additionalContext: LogContext): RequestLogger;
  readonly requestId: string;
  readonly correlationId: string;
}

export function createRequestLogger(
  requestOrId: Request | string,
  baseContext?: LogContext
): RequestLogger {
  const requestId =
    typeof requestOrId === "string"
      ? requestOrId
      : getRequestId(requestOrId);
  const correlationId =
    typeof requestOrId === "string"
      ? requestOrId
      : getCorrelationId(requestOrId);
  const contextWithIds: LogContext = {
    ...baseContext,
    requestId,
    correlationId,
  };
  return {
    requestId,
    correlationId,
    debug(message: string, context?: LogContext): void {
      logger.debug(message, { ...contextWithIds, ...context });
    },
    info(message: string, context?: LogContext): void {
      logger.info(message, { ...contextWithIds, ...context });
    },
    warn(message: string, context?: LogContext): void {
      logger.warn(message, { ...contextWithIds, ...context });
    },
    error(message: string, error?: Error | unknown, context?: LogContext): void {
      logger.error(message, error, { ...contextWithIds, ...context });
    },
    child(additionalContext: LogContext): RequestLogger {
      return createRequestLogger(requestId, {
        ...contextWithIds,
        ...additionalContext,
      });
    },
  };
}

export function getLogLevel(): LogLevel {
  return MIN_LOG_LEVEL;
}

export function isDebugEnabled(): boolean {
  return shouldLog("debug");
}

export const metrics = {
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
  pixelRejection(context: {
    requestId?: string;
    shopDomain: string;
    reason:
      | "invalid_origin"
      | "invalid_origin_protocol"
      | "origin_not_allowlisted"
      | "invalid_key"
      | "invalid_timestamp"
      | "body_too_large"
      | "invalid_payload"
      | "rate_limited"
      | "replay_detected"
      | "shop_not_found"
      | "shop_inactive"
      | "no_ingestion_key";
    originType?: string;
    fingerprint?: string;
  }): void {
    logger.info(`[METRIC] pixel_rejection`, {
      ...context,
      _metric: "pixel_rejection",
      _severity:
        context.reason === "rate_limited" || context.reason === "replay_detected"
          ? "warning"
          : "info",
    });
  },
  silentDrop(context: {
    requestId?: string;
    shopDomain?: string;
    reason: string;
    category: "security" | "validation" | "duplicate" | "rate_limit";
    sampleRate?: number;
  }): void {
    const rate = context.sampleRate ?? 1;
    if (Math.random() > rate) return;
    logger.info(`[METRIC] silent_drop`, {
      ...context,
      _metric: "silent_drop",
      sampled: rate < 1,
    });
  },
  trustVerification(context: {
    shopDomain: string;
    orderId: string;
    trustLevel: "trusted" | "partial" | "untrusted";
    reason?: string;
    checkoutTokenMatch: boolean;
    hasReceipt: boolean;
  }): void {
    logger.info(`[METRIC] trust_verification`, {
      ...context,
      _metric: "trust_verification",
    });
  },
  consentFilter(context: {
    shopDomain: string;
    orderId: string;
    recordedPlatforms: string[];
    skippedPlatforms: string[];
    marketingConsent: boolean;
    analyticsConsent: boolean;
  }): void {
    if (context.skippedPlatforms.length > 0) {
      logger.info(`[METRIC] consent_filter`, {
        ...context,
        _metric: "consent_filter",
      });
    }
  },
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
  jobProcessing(context: {
    jobId: string;
    shopDomain: string;
    orderId: string;
    status: "started" | "completed" | "failed" | "limit_exceeded" | "skipped";
    platforms?: string[];
    duration?: number;
    error?: string;
  }): void {
    logger.info(`[METRIC] job_processing`, {
      ...context,
      _metric: "job_processing",
    });
  },
  platformSend(context: {
    platform: string;
    shopDomain: string;
    orderId: string;
    status: "sent" | "failed" | "skipped";
    duration?: number;
    error?: string;
    errorCode?: string;
  }): void {
    const level = context.status === "failed" ? "warn" : "info";
    logger.log(level, `[METRIC] platform_send`, {
      ...context,
      _metric: "platform_send",
    });
  },
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
  batchProcessing(context: {
    batchId?: string;
    operation: string;
    totalItems: number;
    succeeded: number;
    failed: number;
    duration: number;
  }): void {
    logger.info(`[METRIC] batch_processing`, {
      ...context,
      _metric: "batch_processing",
      successRate: context.totalItems > 0
        ? Math.round((context.succeeded / context.totalItems) * 100)
        : 0,
    });
  },
};

export function createTimer(): { elapsed: () => number } {
  const start = performance.now();
  return {
    elapsed: () => Math.round(performance.now() - start),
  };
}

export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const timer = createTimer();
  try {
    const result = await fn();
    logger.debug(`${name} completed`, { ...context, duration: timer.elapsed() });
    return result;
  } catch (error) {
    logger.error(`${name} failed`, error, { ...context, duration: timer.elapsed() });
    throw error;
  }
}

export type ErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "rate_limit"
  | "external_service"
  | "database"
  | "configuration"
  | "unknown";

export interface ErrorContext {
  category: ErrorCategory;
  code?: string;
  isRetryable?: boolean;
  service?: string;
  operation?: string;
  input?: LogContext;
}

export function logError(
  message: string,
  error: Error | unknown,
  errorContext: ErrorContext,
  additionalContext?: LogContext
): void {
  logger.error(message, error, {
    _errorCategory: errorContext.category,
    _errorCode: errorContext.code,
    _isRetryable: errorContext.isRetryable,
    _service: errorContext.service,
    _operation: errorContext.operation,
    ...errorContext.input,
    ...additionalContext,
  });
}

export function logRequestStart(
  request: Request,
  context?: LogContext
): { requestId: string; startTime: number } {
  const requestId = getRequestId(request);
  const url = new URL(request.url);
  logger.info("Request started", {
    requestId,
    method: request.method,
    path: url.pathname,
    ...context,
  });
  return { requestId, startTime: Date.now() };
}

export function logRequestEnd(
  requestId: string,
  startTime: number,
  status: number,
  context?: LogContext
): void {
  const duration = Date.now() - startTime;
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  logger.log(level, "Request completed", {
    requestId,
    status,
    duration,
    ...context,
  });
}

export type AuditAction =
  | "shop_installed"
  | "shop_uninstalled"
  | "config_changed"
  | "credentials_updated"
  | "data_exported"
  | "data_deleted"
  | "consent_updated"
  | "billing_changed"
  | "alert_settings_changed"
  | "scan_requested"
  | "migration_started";

export function logAudit(
  action: AuditAction,
  context: {
    shopDomain: string;
    actor?: string;
    resourceType?: string;
    resourceId?: string;
    details?: LogContext;
  }
): void {
  logger.info(`[AUDIT] ${action}`, {
    _audit: true,
    _action: action,
    shopDomain: context.shopDomain,
    actor: context.actor ?? "system",
    resourceType: context.resourceType,
    resourceId: context.resourceId,
    ...context.details,
  });
}

export function logSlowOperation(
  operation: string,
  duration: number,
  thresholdMs: number,
  context?: LogContext
): void {
  if (duration > thresholdMs) {
    logger.warn(`Slow operation: ${operation}`, {
      duration,
      threshold: thresholdMs,
      slowBy: duration - thresholdMs,
      ...context,
    });
  }
}

export function logQueryPerformance(
  query: string,
  duration: number,
  rowCount?: number,
  context?: LogContext
): void {
  const level = duration > 1000 ? "warn" : duration > 100 ? "info" : "debug";
  logger.log(level, "Database query", {
    query: query.substring(0, 100),
    duration,
    rowCount,
    _metric: "db_query",
    ...context,
  });
}

export function logHealthCheck(
  service: string,
  healthy: boolean,
  details?: LogContext
): void {
  const level = healthy ? "debug" : "error";
  logger.log(level, `Health check: ${service}`, {
    service,
    healthy,
    _metric: "health_check",
    ...details,
  });
}
