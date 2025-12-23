/**
 * Domain Layer
 *
 * Centralized exports for all domain modules.
 *
 * The domain layer contains:
 * - Entity definitions (business objects)
 * - Repository interfaces (data access contracts)
 * - Domain logic and validation
 * - Value objects
 *
 * This layer is independent of infrastructure concerns like databases,
 * frameworks, or external services.
 */

// =============================================================================
// Shop Domain
// =============================================================================

export {
  // Entity
  type Shop,
  type ShopBasic,
  type ShopWithBilling,
  type ShopWithConsent,
  type ShopWithSecurity,
  type ShopTier,
  type ConsentStrategy,
  type ShopStatus,
  createShop,
  getShopStatus,
  isPiiFullyEnabled,
  isWithinUsageLimits,
  getAllowedDomains,
  isDomainAllowed,
  isInSecretGracePeriod,
  getEffectiveConsentStrategy,
  isValidConsentStrategy,
  isValidShopTier,
  // Repository
  type IShopRepository,
  type FindShopOptions,
  type UpdateShopOptions,
  type ShopUpdateData,
  type CreateShopData,
  type ShopEvent,
  type ShopCreatedEvent,
  type ShopPlanChangedEvent,
  type ShopUninstalledEvent,
  type ShopReinstalledEvent,
  type ShopDomainEvent,
} from "./shop";

// =============================================================================
// Conversion Domain
// =============================================================================

export {
  // Entity
  type ConversionJob,
  type JobWithShop,
  type JobStatus,
  type PlatformResultStatus,
  type ConsentState,
  type TrustResult,
  type ConsentEvidence,
  type TrustMetadata,
  type LineItem,
  type CapiInput,
  type HashedIdentifiers,
  createConversionJob,
  canRetry,
  isExhausted,
  isTerminal,
  isReady,
  calculateNextRetryTime,
  getJobAge,
  allPlatformsSucceeded,
  anyPlatformSucceeded,
  getFailedPlatforms,
  isValidJobStatus,
  isValidPlatformResultStatus,
  // Repository
  type IConversionJobRepository,
  type QueryPendingJobsOptions,
  type QueryByStatusOptions,
  type JobStatusUpdate,
  type CreateJobData,
  type BatchUpdateResult,
  type JobEvent,
  type JobCreatedEvent,
  type JobCompletedEvent,
  type JobFailedEvent,
  type JobDeadLetteredEvent,
  type ConversionJobEvent,
} from "./conversion";

// =============================================================================
// Platform Domain
// =============================================================================

export {
  // Types
  type Platform,
  type GoogleCredentials,
  type MetaCredentials,
  type TikTokCredentials,
  type PlatformCredentials,
  type TypedGoogleCredentials,
  type TypedMetaCredentials,
  type TypedTikTokCredentials,
  type TypedPlatformCredentials,
  type ConversionLineItem,
  type ConversionData,
  type PlatformErrorType,
  type PlatformError,
  type ConversionApiResponse,
  type PlatformSendResult,
  type PixelConfig,
  type PixelClientConfig,
  type PixelConfigWithCredentials,
  PLATFORM_DISPLAY_NAMES,
  PLATFORMS,
  isValidPlatform,
  isGoogleCredentials,
  isMetaCredentials,
  isTikTokCredentials,
  isRetryableError,
  isRetryableErrorType,
  // Service interfaces
  type CredentialsValidationResult,
  type IPlatformService,
  type IPlatformRegistry,
  type IPlatformOrchestrator,
  type MultiPlatformSendResult,
  type PlatformEvent,
  type ConversionSentEvent,
  type ConversionFailedEvent,
  type RateLimitEvent,
  type PlatformDomainEvent,
} from "./platform";

