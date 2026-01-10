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

export { validateRequest, isPrimaryEvent } from "./validation";

export {
  checkInitialConsent,
  filterPlatformsByConsent,
  logNoConsentDrop,
  logConsentFilterMetrics,
  type ConsentCheckResult,
  type PlatformFilterResult,
} from "./consent-filter";

export {
  isClientEventRecorded,
  generateOrderMatchKey,
  evaluateTrustLevel,
  createEventNonce,
  upsertPixelEventReceipt,
  getActivePixelConfigs,
  generatePurchaseEventId,
  type MatchKeyResult,
  type TrustEvaluationResult,
  type ReceiptCreateResult,
  type ConversionLogResult,
} from "./receipt-handler";

export {
  PIXEL_CUSTOM_HEADERS,
  getCorsHeadersPreBody,
  getCorsHeadersForShop,
  jsonWithCors,
  emptyResponseWithCors,
  optionsResponse,
} from "./cors";

export {
  getShopForPixelVerification,
  getShopForPixelVerificationWithConfigs,
} from "./key-validation";
