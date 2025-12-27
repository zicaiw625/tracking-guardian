

export {
  AppError,
  ErrorCode,
  type ErrorCodeType,
  Errors,
  isAppError,
  getErrorMessage,
  ensureAppError,
  type ErrorMetadata,

  type RecoverableError,
  makeRecoverable,
  isRecoverable,
} from "./app-error";

export {

  ServiceError,

  BillingError,
  PlatformServiceError,
  WebhookError,
  DatabaseError,
  ConsentError,
  ValidationError,
  AuthError,
  NotFoundError,

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

export {

  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiResponse,

  resultToResponse,
  asyncResultToResponse,
  errorToResponse,

  wrapAction,
  wrapLoader,
  type ActionHandlerOptions,

  throwErrorResponse,
  unwrapOrThrow,
  unwrapOrThrowSync,

  tryCatch,
  tryCatchSync,

  validationError,
  requireField,
  requireNonEmpty,

  successResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooManyRequests,
  internalError,
} from "./result-response";
