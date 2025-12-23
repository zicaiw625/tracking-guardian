/**
 * Unified Application Error System
 *
 * Provides a consistent error structure throughout the application.
 * All errors should extend or use AppError for predictable error handling.
 */

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Error code categories:
 * - AUTH_*: Authentication and authorization errors
 * - VALIDATION_*: Input validation errors
 * - NOT_FOUND_*: Resource not found errors
 * - CONFLICT_*: Resource conflict errors
 * - PLATFORM_*: External platform API errors
 * - BILLING_*: Billing and quota errors
 * - WEBHOOK_*: Webhook processing errors
 * - DB_*: Database errors
 * - INTERNAL_*: Internal server errors
 */
export const ErrorCode = {
  // Authentication & Authorization
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_INSUFFICIENT_PERMISSIONS: "AUTH_INSUFFICIENT_PERMISSIONS",
  AUTH_SHOP_NOT_FOUND: "AUTH_SHOP_NOT_FOUND",
  AUTH_SIGNATURE_INVALID: "AUTH_SIGNATURE_INVALID",
  AUTH_HMAC_MISMATCH: "AUTH_HMAC_MISMATCH",

  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  VALIDATION_MISSING_FIELD: "VALIDATION_MISSING_FIELD",
  VALIDATION_INVALID_FORMAT: "VALIDATION_INVALID_FORMAT",
  VALIDATION_PAYLOAD_TOO_LARGE: "VALIDATION_PAYLOAD_TOO_LARGE",
  VALIDATION_TIMESTAMP_EXPIRED: "VALIDATION_TIMESTAMP_EXPIRED",

  // Not Found
  NOT_FOUND_SHOP: "NOT_FOUND_SHOP",
  NOT_FOUND_ORDER: "NOT_FOUND_ORDER",
  NOT_FOUND_PIXEL_CONFIG: "NOT_FOUND_PIXEL_CONFIG",
  NOT_FOUND_JOB: "NOT_FOUND_JOB",
  NOT_FOUND_RESOURCE: "NOT_FOUND_RESOURCE",

  // Conflict
  CONFLICT_DUPLICATE: "CONFLICT_DUPLICATE",
  CONFLICT_ALREADY_PROCESSED: "CONFLICT_ALREADY_PROCESSED",
  CONFLICT_STALE_DATA: "CONFLICT_STALE_DATA",

  // Platform (External API) Errors
  PLATFORM_AUTH_ERROR: "PLATFORM_AUTH_ERROR",
  PLATFORM_RATE_LIMITED: "PLATFORM_RATE_LIMITED",
  PLATFORM_SERVER_ERROR: "PLATFORM_SERVER_ERROR",
  PLATFORM_TIMEOUT: "PLATFORM_TIMEOUT",
  PLATFORM_NETWORK_ERROR: "PLATFORM_NETWORK_ERROR",
  PLATFORM_INVALID_CONFIG: "PLATFORM_INVALID_CONFIG",
  PLATFORM_QUOTA_EXCEEDED: "PLATFORM_QUOTA_EXCEEDED",
  PLATFORM_UNKNOWN_ERROR: "PLATFORM_UNKNOWN_ERROR",

  // Billing
  BILLING_LIMIT_EXCEEDED: "BILLING_LIMIT_EXCEEDED",
  BILLING_PLAN_REQUIRED: "BILLING_PLAN_REQUIRED",
  BILLING_SUBSCRIPTION_INACTIVE: "BILLING_SUBSCRIPTION_INACTIVE",

  // Webhook Processing
  WEBHOOK_INVALID_PAYLOAD: "WEBHOOK_INVALID_PAYLOAD",
  WEBHOOK_DUPLICATE: "WEBHOOK_DUPLICATE",
  WEBHOOK_PROCESSING_FAILED: "WEBHOOK_PROCESSING_FAILED",
  WEBHOOK_TOPIC_UNSUPPORTED: "WEBHOOK_TOPIC_UNSUPPORTED",

  // Consent & Trust
  CONSENT_NOT_GRANTED: "CONSENT_NOT_GRANTED",
  CONSENT_RECEIPT_NOT_FOUND: "CONSENT_RECEIPT_NOT_FOUND",
  TRUST_VERIFICATION_FAILED: "TRUST_VERIFICATION_FAILED",

  // Database
  DB_CONNECTION_ERROR: "DB_CONNECTION_ERROR",
  DB_QUERY_ERROR: "DB_QUERY_ERROR",
  DB_TRANSACTION_FAILED: "DB_TRANSACTION_FAILED",
  DB_UNIQUE_CONSTRAINT: "DB_UNIQUE_CONSTRAINT",

  // Encryption
  ENCRYPTION_FAILED: "ENCRYPTION_FAILED",
  DECRYPTION_FAILED: "DECRYPTION_FAILED",
  ENCRYPTION_KEY_MISSING: "ENCRYPTION_KEY_MISSING",

  // Internal
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INTERNAL_CONFIG_ERROR: "INTERNAL_CONFIG_ERROR",
  INTERNAL_UNEXPECTED: "INTERNAL_UNEXPECTED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// Error Metadata Types
// =============================================================================

/**
 * Additional metadata that can be attached to errors
 */
export interface ErrorMetadata {
  /** The shop domain associated with the error */
  shopDomain?: string;
  /** The order ID associated with the error */
  orderId?: string;
  /** The platform (google, meta, tiktok) */
  platform?: string;
  /** The webhook topic */
  webhookTopic?: string;
  /** The job ID being processed */
  jobId?: string;
  /** Request/correlation ID for tracing */
  correlationId?: string;
  /** HTTP status code if applicable */
  httpStatus?: number;
  /** Retry attempt number */
  attempt?: number;
  /** Maximum retry attempts */
  maxAttempts?: number;
  /** Retry delay in milliseconds */
  retryAfter?: number;
  /** Platform-specific error code */
  platformCode?: string;
  /** Platform-specific error message */
  platformMessage?: string;
  /** Platform trace ID (e.g., fbtrace_id) */
  traceId?: string;
  /** Additional context */
  [key: string]: unknown;
}

// =============================================================================
// AppError Class
// =============================================================================

/**
 * Unified application error class.
 *
 * Use this for all application errors to ensure consistent error handling
 * and logging throughout the codebase.
 *
 * @example
 * ```typescript
 * // Simple error
 * throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid email format");
 *
 * // Error with retry info
 * throw AppError.retryable(
 *   ErrorCode.PLATFORM_RATE_LIMITED,
 *   "Rate limit exceeded",
 *   { platform: "meta", retryAfter: 60000 }
 * );
 *
 * // Wrapping external errors
 * try {
 *   await externalApi.call();
 * } catch (e) {
 *   throw AppError.wrap(e, ErrorCode.PLATFORM_SERVER_ERROR, "API call failed");
 * }
 * ```
 */
export class AppError extends Error {
  /**
   * Whether this error can be retried
   */
  public readonly isRetryable: boolean;

  /**
   * The original error that caused this error
   */
  public readonly cause?: Error;

  /**
   * Timestamp when the error occurred
   */
  public readonly timestamp: Date;

  constructor(
    /**
     * Error code for categorization and handling
     */
    public readonly code: ErrorCodeType,
    /**
     * Human-readable error message
     */
    message: string,
    /**
     * Whether this error should trigger a retry
     */
    isRetryable: boolean = false,
    /**
     * Additional metadata for logging and debugging
     */
    public readonly metadata: ErrorMetadata = {},
    /**
     * The original error that caused this error
     */
    cause?: Error
  ) {
    super(message);
    this.name = "AppError";
    this.isRetryable = isRetryable;
    this.cause = cause;
    this.timestamp = new Date();

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  // ===========================================================================
  // Factory Methods
  // ===========================================================================

  /**
   * Create a retryable error
   */
  static retryable(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    return new AppError(code, message, true, metadata);
  }

  /**
   * Create a non-retryable error
   */
  static fatal(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    return new AppError(code, message, false, metadata);
  }

  /**
   * Wrap an unknown error with additional context
   */
  static wrap(
    error: unknown,
    code: ErrorCodeType = ErrorCode.INTERNAL_UNEXPECTED,
    message?: string,
    metadata: ErrorMetadata = {}
  ): AppError {
    if (error instanceof AppError) {
      // Merge metadata and return new error with updated context
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

  /**
   * Create a validation error with field information
   */
  static validation(field: string, message: string): AppError {
    return new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Validation error for ${field}: ${message}`,
      false,
      { field }
    );
  }

  /**
   * Create a not found error
   */
  static notFound(resource: string, id?: string): AppError {
    const message = id
      ? `${resource} with id '${id}' not found`
      : `${resource} not found`;
    return new AppError(ErrorCode.NOT_FOUND_RESOURCE, message, false, {
      resource,
      resourceId: id,
    });
  }

  /**
   * Create a platform error from external API response
   */
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

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Create a copy with additional metadata
   */
  withMetadata(additionalMetadata: ErrorMetadata): AppError {
    return new AppError(
      this.code,
      this.message,
      this.isRetryable,
      { ...this.metadata, ...additionalMetadata },
      this.cause
    );
  }

  /**
   * Create a copy with updated retry status
   */
  withRetryable(isRetryable: boolean): AppError {
    return new AppError(
      this.code,
      this.message,
      isRetryable,
      this.metadata,
      this.cause
    );
  }

  /**
   * Convert to a JSON-safe object for logging
   */
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

  /**
   * Get the full error chain (this error and all causes)
   */
  getErrorChain(): Error[] {
    const chain: Error[] = [this];
    let current: Error | undefined = this.cause;
    while (current) {
      chain.push(current);
      current = current instanceof AppError ? current.cause : undefined;
    }
    return chain;
  }

  /**
   * Get a summary of the error chain for logging
   */
  getChainSummary(): string {
    return this.getErrorChain()
      .map((e, i) => `${i === 0 ? "" : "  <- "}${e.name}: ${e.message}`)
      .join("\n");
  }

  /**
   * Get a safe, redacted version for client responses
   */
  toClientResponse(): { code: string; message: string } {
    // Don't expose internal error details to clients
    const safeMessage = this.isInternalError()
      ? "An internal error occurred"
      : this.message;

    return {
      code: this.code,
      message: safeMessage,
    };
  }

  /**
   * Check if this is an internal error that shouldn't be exposed
   */
  isInternalError(): boolean {
    return (
      this.code.startsWith("INTERNAL_") ||
      this.code.startsWith("DB_") ||
      this.code === ErrorCode.ENCRYPTION_FAILED ||
      this.code === ErrorCode.DECRYPTION_FAILED
    );
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.code.startsWith("AUTH_");
  }

  /**
   * Check if this is a validation error
   */
  isValidationError(): boolean {
    return this.code.startsWith("VALIDATION_");
  }

  /**
   * Check if this is a platform error
   */
  isPlatformError(): boolean {
    return this.code.startsWith("PLATFORM_");
  }

  /**
   * Get appropriate HTTP status code for this error
   */
  getHttpStatus(): number {
    if (this.metadata.httpStatus) {
      return this.metadata.httpStatus;
    }

    // Map error codes to HTTP status codes
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

// =============================================================================
// Error Helpers
// =============================================================================

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Ensure an error is an AppError, wrapping if necessary
 */
export function ensureAppError(
  error: unknown,
  defaultCode: ErrorCodeType = ErrorCode.INTERNAL_UNEXPECTED
): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return AppError.wrap(error, defaultCode);
}

// =============================================================================
// Type-specific Error Factories
// =============================================================================

/**
 * Pre-built error factories for common scenarios
 */
export const Errors = {
  // Auth errors
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

  // Validation errors
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

  // Not found errors
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

  // Billing errors
  limitExceeded: (current: number, limit: number) =>
    new AppError(
      ErrorCode.BILLING_LIMIT_EXCEEDED,
      `Monthly limit exceeded: ${current}/${limit}`,
      false,
      { current, limit }
    ),

  // Platform errors
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

  // Webhook errors
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

  // Consent errors
  consentNotGranted: (reason: string) =>
    new AppError(ErrorCode.CONSENT_NOT_GRANTED, `Consent not granted: ${reason}`),

  // Internal errors
  internal: (message: string, cause?: Error) =>
    new AppError(ErrorCode.INTERNAL_ERROR, message, false, {}, cause),

  unexpected: (cause?: unknown) =>
    AppError.wrap(cause, ErrorCode.INTERNAL_UNEXPECTED, "An unexpected error occurred"),

  // Encryption errors
  encryptionFailed: (operation: string, cause?: Error) =>
    new AppError(ErrorCode.ENCRYPTION_FAILED, `Encryption failed: ${operation}`, false, {}, cause),

  decryptionFailed: (operation: string, cause?: Error) =>
    new AppError(ErrorCode.DECRYPTION_FAILED, `Decryption failed: ${operation}`, false, {}, cause),

  // Database errors
  dbConnection: (message: string) =>
    new AppError(ErrorCode.DB_CONNECTION_ERROR, `Database connection error: ${message}`, true),

  dbQuery: (message: string, cause?: Error) =>
    new AppError(ErrorCode.DB_QUERY_ERROR, message, false, {}, cause),

  dbTransaction: (message: string, cause?: Error) =>
    new AppError(ErrorCode.DB_TRANSACTION_FAILED, message, true, {}, cause),

  // Trust & Consent errors
  trustVerificationFailed: (reason: string) =>
    new AppError(ErrorCode.TRUST_VERIFICATION_FAILED, `Trust verification failed: ${reason}`, false),

  receiptNotFound: (orderId: string) =>
    new AppError(ErrorCode.CONSENT_RECEIPT_NOT_FOUND, `Pixel receipt not found for order ${orderId}`, false, {
      orderId,
    }),
} as const;

// =============================================================================
// Recoverable Error Interface
// =============================================================================

/**
 * Interface for errors that can be recovered from
 */
export interface RecoverableError {
  /** Retry the failed operation */
  retry: () => Promise<unknown>;
  /** Get a fallback value */
  fallback: () => unknown;
}

/**
 * Create a recoverable error wrapper
 */
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

/**
 * Check if an error is recoverable
 */
export function isRecoverable(error: unknown): error is AppError & RecoverableError {
  return (
    error instanceof AppError &&
    "retry" in error &&
    "fallback" in error &&
    typeof (error as RecoverableError).retry === "function" &&
    typeof (error as RecoverableError).fallback === "function"
  );
}

