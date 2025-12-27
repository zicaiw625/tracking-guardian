

export {
  batchFetchReceipts,
  findReceiptForJob,
  updateReceiptTrustLevel,
  type ReceiptFields,
  type JobForReceiptMatch,
} from "../../services/receipt-matcher.server";

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

export {
  validateRequest as validatePixelEventPayload,
  type ValidationResult,
  type PixelEventPayload,
} from "../../services/pixel-validation.server";

export {
  validateOrigin,
  validatePixelOriginForShop,
  validatePixelOriginPreBody,
  buildShopAllowedDomains,
  isValidShopifyOrigin,
  isOriginInAllowlist,
} from "../../utils/origin-validation";

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

