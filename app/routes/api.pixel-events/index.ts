/**
 * Pixel Events API - Module Exports
 *
 * Re-exports all types and utilities from the modular structure.
 */

// Types
export type {
  PixelEventName,
  PixelEventPayload,
  PixelEventData,
  ConsentState,
  ValidationErrorCode,
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  KeyValidationResult,
  ShopContext,
  PixelEventSuccessResponse,
  PixelEventErrorResponse,
} from "./types";

export { PRIMARY_EVENTS, FUNNEL_EVENTS } from "./types";

// Validation
export { validateRequest, isPrimaryEvent } from "./validation";

// Consent
export {
  checkInitialConsent,
  filterPlatformsByConsent,
  logNoConsentDrop,
  logConsentFilterMetrics,
  type ConsentCheckResult,
  type PlatformFilterResult,
} from "./consent-filter";

// Receipt handling
export {
  isClientEventRecorded,
  generateOrderMatchKey,
  evaluateTrustLevel,
  createEventNonce,
  upsertPixelEventReceipt,
  recordConversionLogs,
  getActivePixelConfigs,
  generatePurchaseEventId,
  type MatchKeyResult,
  type TrustEvaluationResult,
  type ReceiptCreateResult,
  type ConversionLogResult,
} from "./receipt-handler";

// CORS
export {
  PIXEL_CUSTOM_HEADERS,
  getCorsHeadersPreBody,
  getCorsHeadersForShop,
  jsonWithCors,
  emptyResponseWithCors,
  optionsResponse,
} from "./cors";

// Key validation
export {
  getShopForPixelVerification,
  validateIngestionKey,
  type KeyValidationContext,
  type KeyValidationOutcome,
} from "./key-validation";

