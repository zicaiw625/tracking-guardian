import { logger } from "./logger";

export class AppError extends Error {
    public readonly code: string;
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    constructor(message: string, code: string, statusCode: number = 500, isOperational: boolean = true) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}
export class ValidationError extends AppError {
    public readonly field?: string;
    constructor(message: string, field?: string) {
        super(message, "VALIDATION_ERROR", 400);
        this.field = field;
    }
}
export class AuthenticationError extends AppError {
    constructor(message: string = "Authentication required") {
        super(message, "AUTHENTICATION_ERROR", 401);
    }
}
export class AuthorizationError extends AppError {
    constructor(message: string = "Access denied") {
        super(message, "AUTHORIZATION_ERROR", 403);
    }
}
export class NotFoundError extends AppError {
    public readonly resource: string;
    constructor(resource: string, message?: string) {
        super(message || `${resource} not found`, "NOT_FOUND", 404);
        this.resource = resource;
    }
}
export class RateLimitError extends AppError {
    public readonly retryAfter: number;
    constructor(retryAfter: number, message: string = "Rate limit exceeded") {
        super(message, "RATE_LIMIT_EXCEEDED", 429);
        this.retryAfter = retryAfter;
    }
}
export class ExternalServiceError extends AppError {
    public readonly service: string;
    constructor(service: string, message?: string) {
        super(message || `External service error: ${service}`, "EXTERNAL_SERVICE_ERROR", 502);
        this.service = service;
    }
}
export class ConfigurationError extends AppError {
    public readonly configKey: string;
    constructor(configKey: string, message?: string) {
        super(message || `Configuration error: ${configKey}`, "CONFIGURATION_ERROR", 500, false);
        this.configKey = configKey;
    }
}
export interface ErrorResponse {
    error: string;
    code?: string;
    field?: string;
    retryAfter?: number;
}
export function toErrorResponse(error: unknown): ErrorResponse {
    if (error instanceof AppError) {
        const response: ErrorResponse = {
            error: error.message,
            code: error.code,
        };
        if (error instanceof ValidationError && error.field) {
            response.field = error.field;
        }
        if (error instanceof RateLimitError) {
            response.retryAfter = error.retryAfter;
        }
        return response;
    }
    if (error instanceof Error) {
        logger.error("Unhandled error:", error);
        if (error.message.includes("timeout")) {
            return {
                error: "Request timed out. Please try again.",
                code: "TIMEOUT",
            };
        }
        if (error.message.includes("network") || error.message.includes("fetch")) {
            return {
                error: "Network error. Please check your connection.",
                code: "NETWORK_ERROR",
            };
        }
    }
    logger.error("Unknown error type", error);
    return {
        error: "An unexpected error occurred. Please try again.",
        code: "UNKNOWN_ERROR",
    };
}
export function getStatusCode(error: unknown): number {
    if (error instanceof AppError) {
        return error.statusCode;
    }
    return 500;
}
export const ERROR_MESSAGES = {
    UNKNOWN: "发生未知错误，请稍后重试",
    NETWORK: "网络连接错误，请检查您的网络",
    TIMEOUT: "请求超时，请稍后重试",
    MISSING_REQUIRED: (field: string) => `${field}不能为空`,
    INVALID_FORMAT: (field: string) => `${field}格式不正确`,
    UNAUTHORIZED: "请先登录",
    ACCESS_DENIED: "您没有权限执行此操作",
    SHOP_NOT_FOUND: "店铺不存在",
    CONFIG_NOT_FOUND: "配置不存在",
    RATE_LIMITED: "请求过于频繁，请稍后重试",
    PLATFORM_ERROR: (platform: string) => `${platform} 服务暂时不可用`,
    API_ERROR: "API 调用失败，请稍后重试",
    CONFIG_MISSING: (key: string) => `缺少必要的配置: ${key}`,
} as const;
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    return "Unknown error";
}
export function isRetryableError(error: unknown): boolean {
    if (error instanceof AppError) {
        return error instanceof RateLimitError || error instanceof ExternalServiceError;
    }
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (message.includes("timeout") ||
            message.includes("network") ||
            message.includes("econnreset") ||
            message.includes("econnrefused"));
    }
    return false;
}
