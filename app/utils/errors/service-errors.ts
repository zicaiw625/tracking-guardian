

import { AppError, ErrorCode, type ErrorCodeType, type ErrorMetadata } from "./app-error";

export abstract class ServiceError extends AppError {

  public readonly service: string;

  constructor(
    service: string,
    code: ErrorCodeType,
    message: string,
    isRetryable: boolean = false,
    metadata: ErrorMetadata = {}
  ) {
    super(code, message, isRetryable, { service, ...metadata });
    this.service = service;
    this.name = this.constructor.name;
  }
}

export class BillingError extends ServiceError {
  constructor(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ) {
    super("billing", code, message, false, metadata);
  }

  static limitExceeded(current: number, limit: number, shopDomain?: string): BillingError {
    return new BillingError(
      ErrorCode.BILLING_LIMIT_EXCEEDED,
      `Monthly order limit exceeded: ${current}/${limit}`,
      { current, limit, shopDomain }
    );
  }

  static subscriptionRequired(feature: string): BillingError {
    return new BillingError(
      ErrorCode.BILLING_PLAN_REQUIRED,
      `Subscription required for feature: ${feature}`,
      { feature }
    );
  }

  static subscriptionInactive(shopDomain: string): BillingError {
    return new BillingError(
      ErrorCode.BILLING_SUBSCRIPTION_INACTIVE,
      "Subscription is not active",
      { shopDomain }
    );
  }
}

export class PlatformServiceError extends ServiceError {
  public readonly platform: string;

  constructor(
    platform: string,
    code: ErrorCodeType,
    message: string,
    isRetryable: boolean = false,
    metadata: ErrorMetadata = {}
  ) {
    super("platform", code, message, isRetryable, { platform, ...metadata });
    this.platform = platform;
  }

  static timeout(platform: string, timeoutMs: number): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_TIMEOUT,
      `${platform} API request timed out after ${timeoutMs}ms`,
      true,
      { timeout: timeoutMs }
    );
  }

  static rateLimited(platform: string, retryAfter?: number): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_RATE_LIMITED,
      `${platform} API rate limit exceeded`,
      true,
      { retryAfter }
    );
  }

  static authError(platform: string, message: string): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_AUTH_ERROR,
      `${platform} authentication failed: ${message}`,
      false
    );
  }

  static serverError(platform: string, statusCode: number, message?: string): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_SERVER_ERROR,
      message || `${platform} server error (${statusCode})`,
      true,
      { httpStatus: statusCode }
    );
  }

  static networkError(platform: string, originalMessage: string): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_NETWORK_ERROR,
      `${platform} network error: ${originalMessage}`,
      true
    );
  }

  static invalidConfig(platform: string, reason: string): PlatformServiceError {
    return new PlatformServiceError(
      platform,
      ErrorCode.PLATFORM_INVALID_CONFIG,
      `Invalid ${platform} configuration: ${reason}`,
      false
    );
  }
}

export class WebhookError extends ServiceError {
  public readonly webhookId?: string;
  public readonly topic?: string;

  constructor(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ) {
    super("webhook", code, message, false, metadata);
    this.webhookId = metadata.webhookId as string | undefined;
    this.topic = metadata.webhookTopic as string | undefined;
  }

  static duplicate(webhookId: string, topic: string): WebhookError {
    return new WebhookError(
      ErrorCode.WEBHOOK_DUPLICATE,
      `Webhook ${webhookId} for topic ${topic} already processed`,
      { webhookId, webhookTopic: topic }
    );
  }

  static invalidPayload(reason: string, topic?: string): WebhookError {
    return new WebhookError(
      ErrorCode.WEBHOOK_INVALID_PAYLOAD,
      `Invalid webhook payload: ${reason}`,
      { webhookTopic: topic }
    );
  }

  static unsupportedTopic(topic: string): WebhookError {
    return new WebhookError(
      ErrorCode.WEBHOOK_TOPIC_UNSUPPORTED,
      `Unsupported webhook topic: ${topic}`,
      { webhookTopic: topic }
    );
  }

  static processingFailed(reason: string, webhookId?: string): WebhookError {
    return new WebhookError(
      ErrorCode.WEBHOOK_PROCESSING_FAILED,
      `Webhook processing failed: ${reason}`,
      { webhookId }
    );
  }
}

export class DatabaseError extends ServiceError {
  constructor(
    code: ErrorCodeType,
    message: string,
    isRetryable: boolean = false,
    metadata: ErrorMetadata = {}
  ) {
    super("database", code, message, isRetryable, metadata);
  }

  static connectionError(message: string): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_CONNECTION_ERROR,
      `Database connection error: ${message}`,
      true
    );
  }

  static queryError(query: string, message: string, cause?: Error): DatabaseError {
    const error = new DatabaseError(
      ErrorCode.DB_QUERY_ERROR,
      `Query failed: ${message}`,
      false,
      { query: query.substring(0, 100) }
    );
    if (cause) {
      const wrapped = AppError.wrap(cause, ErrorCode.DB_QUERY_ERROR, error.message, error.metadata);
      // 创建一个新的DatabaseError实例，保持类型一致性
      return new DatabaseError(
        ErrorCode.DB_QUERY_ERROR,
        wrapped.message,
        wrapped.isRetryable,
        { ...wrapped.metadata, query: query.substring(0, 100) }
      );
    }
    return error;
  }

  static transactionFailed(message: string): DatabaseError {
    return new DatabaseError(
      ErrorCode.DB_TRANSACTION_FAILED,
      `Transaction failed: ${message}`,
      true
    );
  }

  static uniqueConstraint(field: string, value?: string): DatabaseError {
    const msg = value
      ? `Unique constraint violation: ${field} = ${value}`
      : `Unique constraint violation on ${field}`;
    return new DatabaseError(
      ErrorCode.DB_UNIQUE_CONSTRAINT,
      msg,
      false,
      { field, value }
    );
  }
}

export class ConsentError extends ServiceError {
  constructor(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ) {
    super("consent", code, message, false, metadata);
  }

  static notGranted(
    reason: string,
    context?: { shopDomain?: string; orderId?: string; platform?: string }
  ): ConsentError {
    return new ConsentError(
      ErrorCode.CONSENT_NOT_GRANTED,
      `Consent not granted: ${reason}`,
      context
    );
  }

  static receiptNotFound(orderId: string, shopDomain?: string): ConsentError {
    return new ConsentError(
      ErrorCode.CONSENT_RECEIPT_NOT_FOUND,
      `Pixel event receipt not found for order ${orderId}`,
      { orderId, shopDomain }
    );
  }

  static trustVerificationFailed(
    reason: string,
    context?: { shopDomain?: string; orderId?: string }
  ): ConsentError {
    return new ConsentError(
      ErrorCode.TRUST_VERIFICATION_FAILED,
      `Trust verification failed: ${reason}`,
      context
    );
  }
}

export class ValidationError extends ServiceError {
  public readonly field?: string;
  public readonly expected?: string;
  public readonly received?: string;

  constructor(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata & {
      field?: string;
      expected?: string;
      received?: string;
    } = {}
  ) {
    super("validation", code, message, false, metadata);
    this.field = metadata.field;
    this.expected = metadata.expected;
    this.received = metadata.received;
  }

  static missingField(field: string): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_MISSING_FIELD,
      `Missing required field: ${field}`,
      { field }
    );
  }

  static invalidFormat(field: string, expected: string, received?: string): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_INVALID_FORMAT,
      `Invalid format for ${field}: expected ${expected}${received ? `, received ${received}` : ""}`,
      { field, expected, received }
    );
  }

  static payloadTooLarge(size: number, maxSize: number): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_PAYLOAD_TOO_LARGE,
      `Payload size ${size} bytes exceeds maximum ${maxSize} bytes`,
      { size, maxSize } as ErrorMetadata
    );
  }

  static timestampExpired(timestamp: number, windowMs: number): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_TIMESTAMP_EXPIRED,
      `Timestamp ${timestamp} is outside acceptable window of ${windowMs}ms`,
      { timestamp, windowMs } as ErrorMetadata
    );
  }

  static custom(message: string, field?: string): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_ERROR,
      message,
      { field }
    );
  }
}

export class AuthError extends ServiceError {
  constructor(
    code: ErrorCodeType,
    message: string,
    metadata: ErrorMetadata = {}
  ) {
    super("auth", code, message, false, metadata);
  }

  static invalidToken(reason?: string): AuthError {
    return new AuthError(
      ErrorCode.AUTH_INVALID_TOKEN,
      reason || "Invalid authentication token"
    );
  }

  static tokenExpired(): AuthError {
    return new AuthError(
      ErrorCode.AUTH_TOKEN_EXPIRED,
      "Authentication token has expired"
    );
  }

  static shopNotFound(shopDomain: string): AuthError {
    return new AuthError(
      ErrorCode.AUTH_SHOP_NOT_FOUND,
      `Shop ${shopDomain} not found`,
      { shopDomain }
    );
  }

  static signatureInvalid(reason?: string): AuthError {
    return new AuthError(
      ErrorCode.AUTH_SIGNATURE_INVALID,
      reason || "Request signature is invalid"
    );
  }

  static hmacMismatch(): AuthError {
    return new AuthError(
      ErrorCode.AUTH_HMAC_MISMATCH,
      "HMAC signature verification failed"
    );
  }

  static insufficientPermissions(required: string): AuthError {
    return new AuthError(
      ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
      `Insufficient permissions: ${required} required`,
      { requiredPermission: required }
    );
  }
}

export class NotFoundError extends ServiceError {
  public readonly resource: string;
  public readonly resourceId?: string;

  constructor(
    resource: string,
    resourceId?: string,
    metadata: ErrorMetadata = {}
  ) {
    const message = resourceId
      ? `${resource} with id '${resourceId}' not found`
      : `${resource} not found`;

    const code = getNotFoundCodeForResource(resource);

    super("resource", code, message, false, {
      resource,
      resourceId,
      ...metadata,
    });

    this.resource = resource;
    this.resourceId = resourceId;
  }

  static shop(shopDomain: string): NotFoundError {
    return new NotFoundError("Shop", shopDomain, { shopDomain });
  }

  static order(orderId: string): NotFoundError {
    return new NotFoundError("Order", orderId, { orderId });
  }

  static pixelConfig(platform: string, shopDomain?: string): NotFoundError {
    return new NotFoundError("PixelConfig", platform, { platform, shopDomain });
  }

  static job(jobId: string): NotFoundError {
    return new NotFoundError("Job", jobId, { jobId });
  }
}

function getNotFoundCodeForResource(resource: string): ErrorCodeType {
  switch (resource.toLowerCase()) {
    case "shop":
      return ErrorCode.NOT_FOUND_SHOP;
    case "order":
      return ErrorCode.NOT_FOUND_ORDER;
    case "pixelconfig":
      return ErrorCode.NOT_FOUND_PIXEL_CONFIG;
    case "job":
      return ErrorCode.NOT_FOUND_JOB;
    default:
      return ErrorCode.NOT_FOUND_RESOURCE;
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingError;
}

export function isPlatformServiceError(error: unknown): error is PlatformServiceError {
  return error instanceof PlatformServiceError;
}

export function isWebhookError(error: unknown): error is WebhookError {
  return error instanceof WebhookError;
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

export function isConsentError(error: unknown): error is ConsentError {
  return error instanceof ConsentError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

