/**
 * Unified Error System Exports
 *
 * This module provides a complete error handling system including:
 * - AppError: Base application error class
 * - Service-specific error types
 * - Result-to-Response utilities for Remix
 */

// =============================================================================
// Core Error Types
// =============================================================================

export {
  AppError,
  ErrorCode,
  type ErrorCodeType,
  Errors,
  isAppError,
  getErrorMessage,
  ensureAppError,
  type ErrorMetadata,
  // Recoverable error utilities
  type RecoverableError,
  makeRecoverable,
  isRecoverable,
} from "./app-error";

// =============================================================================
// Service-Specific Errors
// =============================================================================

export {
  // Base service error
  ServiceError,
  // Domain-specific errors
  BillingError,
  PlatformServiceError,
  WebhookError,
  DatabaseError,
  ConsentError,
  ValidationError,
  AuthError,
  NotFoundError,
  // Type guards
  isServiceError,
  isBillingError,
  isPlatformServiceError,
  isWebhookError,
  isDatabaseError,
  isConsentError,
  isValidationError,
  isAuthError,
  isNotFoundError,
} from "./service-errors";

// =============================================================================
// Result-to-Response Utilities
// =============================================================================

export {
  // Response types
  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiResponse,
  // Result conversion
  resultToResponse,
  asyncResultToResponse,
  errorToResponse,
  // Handler wrappers
  wrapAction,
  wrapLoader,
  type ActionHandlerOptions,
  // Throw utilities
  throwErrorResponse,
  unwrapOrThrow,
  unwrapOrThrowSync,
  // Try-catch utilities
  tryCatch,
  tryCatchSync,
  // Validation helpers
  validationError,
  requireField,
  requireNonEmpty,
  // Response helpers
  successResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooManyRequests,
  internalError,
} from "./result-response";
