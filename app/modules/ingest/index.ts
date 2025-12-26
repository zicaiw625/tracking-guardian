/**
 * Ingest Module
 *
 * Handles pixel event ingestion:
 * - Event validation and verification
 * - Origin and key validation
 * - Replay protection
 * - Receipt creation
 * - Trust evaluation
 *
 * P2-1: Centralized event ingestion with security layers.
 */

// Receipt matching
export {
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields,
  type JobForReceiptMatch,
} from "../../services/receipt-matcher.server";

// Trust evaluation
export {
  evaluateTrust,
  checkPlatformEligibility,
  buildConsentEvidence,
  didReceiptMatchByToken,
  DEFAULT_TRUST_OPTIONS,
  type ShopTrustContext,
  type TrustEvaluationResult,
  type PlatformEligibilityResult,
} from "../../services/trust-evaluator.server";

// Pixel validation
export {
  validatePixelEventPayload,
  type ValidationResult,
} from "../../services/pixel-validation.server";

// Origin validation
export {
  validateOrigin,
  validatePixelOriginForShop,
  validatePixelOriginPreBody,
  buildShopAllowedDomains,
  isValidShopifyOrigin,
  isOriginInAllowlist,
} from "../../utils/origin-validation";

// Consent utilities
export {
  evaluatePlatformConsent,
  evaluatePlatformConsentWithStrategy,
  getPlatformConsentRequirements,
  getAllPlatformConsentRequirements,
  getAllowedPlatforms,
  isMarketingPlatform,
  isAnalyticsPlatform,
  type ConsentState,
  type ConsentDecision,
} from "../../utils/platform-consent";

