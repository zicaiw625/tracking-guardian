

export const ErrorCode = {

  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_INSUFFICIENT_PERMISSIONS: "AUTH_INSUFFICIENT_PERMISSIONS",
  AUTH_SHOP_NOT_FOUND: "AUTH_SHOP_NOT_FOUND",
  AUTH_SIGNATURE_INVALID: "AUTH_SIGNATURE_INVALID",
  AUTH_HMAC_MISMATCH: "AUTH_HMAC_MISMATCH",

  VALIDATION_ERROR: "VALIDATION_ERROR",
  VALIDATION_MISSING_FIELD: "VALIDATION_MISSING_FIELD",
  VALIDATION_INVALID_FORMAT: "VALIDATION_INVALID_FORMAT",
  VALIDATION_PAYLOAD_TOO_LARGE: "VALIDATION_PAYLOAD_TOO_LARGE",
  VALIDATION_TIMESTAMP_EXPIRED: "VALIDATION_TIMESTAMP_EXPIRED",

  NOT_FOUND_SHOP: "NOT_FOUND_SHOP",
  NOT_FOUND_ORDER: "NOT_FOUND_ORDER",
  NOT_FOUND_PIXEL_CONFIG: "NOT_FOUND_PIXEL_CONFIG",
  NOT_FOUND_JOB: "NOT_FOUND_JOB",
  NOT_FOUND_RESOURCE: "NOT_FOUND_RESOURCE",

  CONFLICT_DUPLICATE: "CONFLICT_DUPLICATE",
  CONFLICT_ALREADY_PROCESSED: "CONFLICT_ALREADY_PROCESSED",
  CONFLICT_STALE_DATA: "CONFLICT_STALE_DATA",

  PLATFORM_AUTH_ERROR: "PLATFORM_AUTH_ERROR",
  PLATFORM_RATE_LIMITED: "PLATFORM_RATE_LIMITED",
  PLATFORM_SERVER_ERROR: "PLATFORM_SERVER_ERROR",
  PLATFORM_TIMEOUT: "PLATFORM_TIMEOUT",
  PLATFORM_NETWORK_ERROR: "PLATFORM_NETWORK_ERROR",
  PLATFORM_INVALID_CONFIG: "PLATFORM_INVALID_CONFIG",
  PLATFORM_QUOTA_EXCEEDED: "PLATFORM_QUOTA_EXCEEDED",
  PLATFORM_UNKNOWN_ERROR: "PLATFORM_UNKNOWN_ERROR",

  BILLING_LIMIT_EXCEEDED: "BILLING_LIMIT_EXCEEDED",
  BILLING_PLAN_REQUIRED: "BILLING_PLAN_REQUIRED",
  BILLING_SUBSCRIPTION_INACTIVE: "BILLING_SUBSCRIPTION_INACTIVE",

  WEBHOOK_INVALID_PAYLOAD: "WEBHOOK_INVALID_PAYLOAD",
  WEBHOOK_DUPLICATE: "WEBHOOK_DUPLICATE",
  WEBHOOK_PROCESSING_FAILED: "WEBHOOK_PROCESSING_FAILED",
  WEBHOOK_TOPIC_UNSUPPORTED: "WEBHOOK_TOPIC_UNSUPPORTED",

  CONSENT_NOT_GRANTED: "CONSENT_NOT_GRANTED",
  CONSENT_RECEIPT_NOT_FOUND: "CONSENT_RECEIPT_NOT_FOUND",
  TRUST_VERIFICATION_FAILED: "TRUST_VERIFICATION_FAILED",

  DB_CONNECTION_ERROR: "DB_CONNECTION_ERROR",
  DB_QUERY_ERROR: "DB_QUERY_ERROR",
  DB_TRANSACTION_FAILED: "DB_TRANSACTION_FAILED",
  DB_UNIQUE_CONSTRAINT: "DB_UNIQUE_CONSTRAINT",

  ENCRYPTION_FAILED: "ENCRYPTION_FAILED",
  DECRYPTION_FAILED: "DECRYPTION_FAILED",
  ENCRYPTION_KEY_MISSING: "ENCRYPTION_KEY_MISSING",

  INTERNAL_ERROR: "INTERNAL_ERROR",
  INTERNAL_CONFIG_ERROR: "INTERNAL_CONFIG_ERROR",
  INTERNAL_UNEXPECTED: "INTERNAL_UNEXPECTED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorMetadata {

  shopDomain?: string;

  orderId?: string;

  platform?: string;

  webhookTopic?: string;

  jobId?: string;

  correlationId?: string;

  httpStatus?: number;

  attempt?: number;

  maxAttempts?: number;

  retryAfter?: number;

  platformCode?: string;

  platformMessage?: string;

  traceId?: string;

  [key: string]: unknown;
}

export class AppError extends Error {

  public readonly isRetryable: boolean;

  public readonly cause?: Error;

  public readonly timestamp: Date;

  constructor(

    public readonly code: ErrorCodeType,

    message: string,

    isRetryable: boolean = false,

    public readonly metadata: ErrorMetadata = {},

    cause?: Error
  ) {
    super(message);
    this.name = "AppError";
    this.isRetryable = isRetryable;
    this.cause = cause;
    this.timestamp = new Date();

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  static retryable(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    return new AppError(code, message, true, metadata);
  }

  static fatal(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    return new AppError(code, message, false, metadata);
  }

  static wrap(
    error: unknown,
    code: ErrorCodeType = ErrorCode.INTERNAL_UNEXPECTED,
    message?: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    if (error instanceof AppError) {

      return new AppError(
        error.code,
        message || error.message,
        error.isRetryable,
        { ...error.metadata, ...metadata },
        error.cause || error
      );
    }

    const originalError = error instanceof Error ? error : new Error(String(error));
    const errorMessage = message || originalError.message || "An unexpected error occurred";

    return new AppError(code, errorMessage, false, metadata, originalError);
  }

  static validation(field: string, message: string): AppError {
    return new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Validation error for ${field}: ${message}`,
      false,
      { field }
    );
  }

  static notFound(resource: string, id?: string): AppError {
    const message = id
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    return new AppError(ErrorCode.NOT_FOUND_RESOURCE, message, false, {
      resource,
      resourceId: id,
    });
  }

  static platform(
    platform: string,
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    const retryableCodes: ErrorCodeType[] = [
      ErrorCode.PLATFORM_RATE_LIMITED,
      ErrorCode.PLATFORM_SERVER_ERROR,
      ErrorCode.PLATFORM_TIMEOUT,
      ErrorCode.PLATFORM_NETWORK_ERROR,
    ];
    const isRetryable = retryableCodes.includes(code);

    return new AppError(code, message, isRetryable, { platform, ...metadata });
  }

  withMetadata(additionalMetadata: ErrorMetadata): AppError {
    return new AppError(
      this.code,
      this.message,
      this.isRetryable,
      { ...this.metadata, ...additionalMetadata },
      this.cause
    );
  }

  withRetryable(isRetryable: boolean): AppError {
    return new AppError(
      this.code,
      this.message,
      isRetryable,
      this.metadata,
      this.cause
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      isRetryable: this.isRetryable,
      metadata: this.metadata,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
    };
  }

  getErrorChain(): Error[] {
    const chain: Error[] = [this];
    let current: Error | undefined = this.cause;
    while (current) {
      chain.push(current);
      current = current instanceof AppError ? current.cause : undefined;
    }
    return chain;
  }

  getChainSummary(): string {
    return this.getErrorChain()
      .map((e, i) => `${i === 0 ? "" : "  <- "}${e.name}: ${e.message}`)
      .join("\n");
  }

  toClientResponse(): { code: string; message: string } {

    const safeMessage = this.isInternalError()
      ? "An internal error occurred"
      : this.message;

    return {
      code: this.code,
      message: safeMessage,
    };
  }

  isInternalError(): boolean {
    return (
      this.code.startsWith("INTERNAL_") ||
      this.code.startsWith("DB_") ||
      this.code === ErrorCode.ENCRYPTION_FAILED ||
      this.code === ErrorCode.DECRYPTION_FAILED
    );
  }

  isAuthError(): boolean {
    return this.code.startsWith("AUTH_");
  }

  isValidationError(): boolean {
    return this.code.startsWith("VALIDATION_");
  }

  isPlatformError(): boolean {
    return this.code.startsWith("PLATFORM_");
  }

  getHttpStatus(): number {
    if (this.metadata.httpStatus) {
      return this.metadata.httpStatus;
    }

    if (this.code.startsWith("AUTH_")) return 401;
    if (this.code.startsWith("VALIDATION_")) return 400;
    if (this.code.startsWith("NOT_FOUND_")) return 404;
    if (this.code.startsWith("CONFLICT_")) return 409;
    if (this.code === ErrorCode.BILLING_LIMIT_EXCEEDED) return 429;
    if (this.code === ErrorCode.PLATFORM_RATE_LIMITED) return 429;
    if (this.code.startsWith("BILLING_")) return 402;

    return 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

export function ensureAppError(
  error: unknown,
  defaultCode: ErrorCodeType = ErrorCode.INTERNAL_UNEXPECTED
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return AppError.wrap(error, defaultCode);
}

export const Errors = {

  invalidToken: (details?: string) =>
    new AppError(
      ErrorCode.AUTH_INVALID_TOKEN,
      details || "Invalid authentication token"
    ),

  tokenExpired: () =>
    new AppError(ErrorCode.AUTH_TOKEN_EXPIRED, "Authentication token has expired"),

  shopNotFound: (shopDomain: string) =>
    new AppError(ErrorCode.AUTH_SHOP_NOT_FOUND, `Shop ${shopDomain} not found`, false, {
      shopDomain,
    }),

  signatureInvalid: () =>
    new AppError(ErrorCode.AUTH_SIGNATURE_INVALID, "Request signature is invalid"),

  missingField: (field: string) =>
    new AppError(
      ErrorCode.VALIDATION_MISSING_FIELD,
      `Missing required field: ${field}`,
      false,
      { field }
    ),

  invalidFormat: (field: string, expected: string) =>
    new AppError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Invalid format for ${field}: expected ${expected}`,
      false,
      { field, expected }
    ),

  payloadTooLarge: (size: number, maxSize: number) =>
    new AppError(
      ErrorCode.VALIDATION_PAYLOAD_TOO_LARGE,
      `Payload size ${size} exceeds maximum ${maxSize}`,
      false,
      { size, maxSize }
    ),

  orderNotFound: (orderId: string) =>
    new AppError(ErrorCode.NOT_FOUND_ORDER, `Order ${orderId} not found`, false, {
      orderId,
    }),

  configNotFound: (platform: string) =>
    new AppError(
      ErrorCode.NOT_FOUND_PIXEL_CONFIG,
      `Pixel config for ${platform} not found`,
      false,
      { platform }
    ),

  limitExceeded: (current: number, limit: number) =>
    new AppError(
      ErrorCode.BILLING_LIMIT_EXCEEDED,
      `Monthly limit exceeded: ${current}/${limit}`,
      false,
      { current, limit }
    ),

  platformTimeout: (platform: string, timeout: number) =>
    AppError.retryable(
      ErrorCode.PLATFORM_TIMEOUT,
      `${platform} API request timed out after ${timeout}ms`,
      { platform, timeout }
    ),

  platformRateLimited: (platform: string, retryAfter?: number) =>
    AppError.retryable(ErrorCode.PLATFORM_RATE_LIMITED, `${platform} rate limit exceeded`, {
      platform,
      retryAfter,
    }),

  webhookDuplicate: (webhookId: string) =>
    new AppError(
      ErrorCode.WEBHOOK_DUPLICATE,
      `Webhook ${webhookId} already processed`,
      false,
      { webhookId }
    ),

  webhookInvalidPayload: (reason: string) =>
    new AppError(
      ErrorCode.WEBHOOK_INVALID_PAYLOAD,
      `Invalid webhook payload: ${reason}`,
      false
    ),

  consentNotGranted: (reason: string) =>
    new AppError(ErrorCode.CONSENT_NOT_GRANTED, `Consent not granted: ${reason}`),

  internal: (message: string, cause?: Error) =>
    new AppError(ErrorCode.INTERNAL_ERROR, message, false, {}, cause),

  unexpected: (cause?: unknown) =>
    AppError.wrap(cause, ErrorCode.INTERNAL_UNEXPECTED, "An unexpected error occurred"),

  encryptionFailed: (operation: string, cause?: Error) =>
    new AppError(ErrorCode.ENCRYPTION_FAILED, `Encryption failed: ${operation}`, false, {}, cause),

  decryptionFailed: (operation: string, cause?: Error) =>
    new AppError(ErrorCode.DECRYPTION_FAILED, `Decryption failed: ${operation}`, false, {}, cause),

  dbConnection: (message: string) =>
    new AppError(ErrorCode.DB_CONNECTION_ERROR, `Database connection error: ${message}`, true),

  dbQuery: (message: string, cause?: Error) =>
    new AppError(ErrorCode.DB_QUERY_ERROR, message, false, {}, cause),

  dbTransaction: (message: string, cause?: Error) =>
    new AppError(ErrorCode.DB_TRANSACTION_FAILED, message, true, {}, cause),

  trustVerificationFailed: (reason: string) =>
    new AppError(ErrorCode.TRUST_VERIFICATION_FAILED, `Trust verification failed: ${reason}`, false),

  receiptNotFound: (orderId: string) =>
    new AppError(ErrorCode.CONSENT_RECEIPT_NOT_FOUND, `Pixel receipt not found for order ${orderId}`, false, {
      orderId,
    }),
} as const;

export interface RecoverableError {

  retry: () => Promise<unknown>;

  fallback: () => unknown;
}

export function makeRecoverable<T>(
  error: AppError,
  retryFn: () => Promise<T>,
  fallbackValue: T
): AppError & RecoverableError {
  const recoverable = error as AppError & RecoverableError;
  recoverable.retry = retryFn;
  recoverable.fallback = () => fallbackValue;
  return recoverable;
}

export function isRecoverable(error: unknown): error is AppError & RecoverableError {
  return (
    error instanceof AppError &&
    "retry" in error &&
    "fallback" in error &&
    typeof (error as RecoverableError).retry === "function" &&
    typeof (error as RecoverableError).fallback === "function"
  );
}

