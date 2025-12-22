import { randomBytes } from "crypto";
type LogLevel = "debug" | "info" | "warn" | "error";
interface LogContext {
    [key: string]: unknown;
}
const REQUEST_ID_HEADER = "X-Request-Id";
export function generateRequestId(): string {
    return randomBytes(8).toString("hex");
}
export function getRequestId(request: Request): string {
    return request.headers.get(REQUEST_ID_HEADER) || generateRequestId();
}
const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const MIN_LOG_LEVEL: LogLevel = process.env.NODE_ENV === "production" ? "warn" : "debug";
function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    if (context && Object.keys(context).length > 0) {
        const sanitizedContext = sanitizeContext(context);
        return `${prefix} ${message} ${JSON.stringify(sanitizedContext)}`;
    }
    return `${prefix} ${message}`;
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
    "name",
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
function sanitizeContext(context: LogContext): LogContext {
    const sanitized: LogContext = {};
    for (const [key, value] of Object.entries(context)) {
        const lowerKey = key.toLowerCase();
        if (EXCLUDED_FIELDS.some((f) => lowerKey.includes(f))) {
            sanitized[key] = "[EXCLUDED]";
            continue;
        }
        if (SENSITIVE_FIELD_PATTERNS.some((f) => lowerKey.includes(f))) {
            sanitized[key] = "[REDACTED]";
        }
        else if (typeof value === "object" && value !== null) {
            if (Array.isArray(value)) {
                sanitized[key] = value.map(item => typeof item === "object" && item !== null
                    ? sanitizeContext(item as LogContext)
                    : item);
            }
            else {
                sanitized[key] = sanitizeContext(value as LogContext);
            }
        }
        else if (typeof value === "string" && value.length > 500) {
            sanitized[key] = value.substring(0, 200) + "...[TRUNCATED]";
        }
        else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}
function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}
export const logger = {
    debug(message: string, context?: LogContext): void {
        if (shouldLog("debug")) {
            console.debug(formatMessage("debug", message, context));
        }
    },
    info(message: string, context?: LogContext): void {
        if (shouldLog("info")) {
            console.info(formatMessage("info", message, context));
        }
    },
    warn(message: string, context?: LogContext): void {
        if (shouldLog("warn")) {
            console.warn(formatMessage("warn", message, context));
        }
    },
    error(message: string, error?: Error | unknown, context?: LogContext): void {
        if (shouldLog("error")) {
            const errorContext: LogContext = { ...context };
            if (error instanceof Error) {
                errorContext.errorMessage = error.message;
                errorContext.errorStack = error.stack;
            }
            else if (error) {
                errorContext.error = String(error);
            }
            console.error(formatMessage("error", message, errorContext));
        }
    },
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
export function getLogLevel(): LogLevel {
    return MIN_LOG_LEVEL;
}
export function isDebugEnabled(): boolean {
    return shouldLog("debug");
}
export interface RequestLogger {
    debug(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    error(message: string, error?: Error | unknown, context?: LogContext): void;
    child(additionalContext: LogContext): RequestLogger;
    readonly requestId: string;
}
export function createRequestLogger(requestOrId: Request | string, baseContext?: LogContext): RequestLogger {
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
        reason: "invalid_origin" | "invalid_key" | "invalid_timestamp" | "body_too_large" | "invalid_payload" | "rate_limited" | "replay_detected" | "shop_not_found" | "shop_inactive" | "no_ingestion_key";
        originType?: string;
        fingerprint?: string;
    }): void {
        logger.info(`[METRIC] pixel_rejection`, {
            ...context,
            _metric: "pixel_rejection",
            _severity: context.reason === "rate_limited" || context.reason === "replay_detected" ? "warning" : "info",
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
        if (Math.random() > rate)
            return;
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
};
