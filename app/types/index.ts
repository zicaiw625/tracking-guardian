/**
 * Centralized Type Definitions
 * 
 * This module re-exports all type definitions from domain-specific modules.
 * Import types from here for convenience, or directly from specific modules
 * for better tree-shaking.
 */

// =============================================================================
// Enum Constants & Types
// =============================================================================

export {
  // Job & Status Enums
  JobStatus,
  ConversionLogStatus,
  WebhookStatus,
  GDPRJobStatus,
  ScanStatus,
  MigrationStatus,
  // Trust & Consent Enums
  TrustLevel as TrustLevelEnum,
  SignatureStatus,
  ConsentStrategy as ConsentStrategyEnum,
  // Platform Enums
  Platform as PlatformEnum,
  PLATFORM_DISPLAY_NAMES,
  EventType,
  // Shop & Billing Enums
  ShopTier,
  PlanId,
  // Alert Enums
  AlertChannel as AlertChannelEnum,
  AlertFrequency,
  // Audit Enums
  ActorType,
  AuditAction,
  PlatformResultStatus,
  // Validators
  isValidJobStatus,
  isValidPlatform,
  isValidTrustLevel,
  isValidConsentStrategy,
} from "./enums";

export type {
  JobStatusType,
  ConversionLogStatusType,
  WebhookStatusType,
  GDPRJobStatusType,
  ScanStatusType,
  MigrationStatusType,
  TrustLevelType,
  SignatureStatusType,
  ConsentStrategyType,
  PlatformType,
  EventTypeValue,
  ShopTierType,
  PlanIdType,
  AlertChannelType,
  AlertFrequencyType,
  ActorTypeValue,
  AuditActionType,
  PlatformResultStatusType,
} from "./enums";

// =============================================================================
// Database Types (Prisma Json Fields)
// =============================================================================

export type {
  CapiLineItem,
  CapiInputJson,
  ConsentStateJson,
  ConsentEvidenceJson,
  TrustMetadataJson,
  PlatformResultsJson,
  EmailAlertSettingsJson,
  SlackAlertSettingsJson,
  TelegramAlertSettingsJson,
  AlertSettingsJson,
  PixelClientConfigJson,
  RiskItemJson,
  PlatformResponseJson,
  AuditMetadataJson,
} from "./database";

export {
  // Parser functions
  parseCapiInput,
  parseConsentState,
  parseConsentEvidence,
  parseTrustMetadata,
  parsePlatformResults,
  parsePixelClientConfig,
  parseRiskItems,
  parseIdentifiedPlatforms,
  parsePlatformResponse,
  // Type guards
  isCapiInputJson,
  isConsentStateJson,
} from "./database";

// =============================================================================
// Platform Types
// =============================================================================

export type {
  // Platform identifier
  Platform,
  // Credential types
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PlatformCredentials,
  // Typed credentials with discriminant (for type-safe switch statements)
  GoogleCredentialsTyped,
  MetaCredentialsTyped,
  TikTokCredentialsTyped,
  TypedPlatformCredentials,
  // Conversion types
  LineItem,
  ConversionData,
  ConversionStatus,
  ConversionLogData,
  ConversionApiResponse,
  // Error types
  PlatformErrorType,
  PlatformError,
  PlatformResult,
  // Config types
  PixelConfigData,
  MigrationConfig,
  MigrationResult,
  // Discriminated config types
  GooglePlatformConfig,
  MetaPlatformConfig,
  TikTokPlatformConfig,
  PlatformConfig,
  ExtractCredentials,
} from "./platform";

export {
  PLATFORM_NAMES,
  // Zod schemas for runtime validation
  GoogleCredentialsSchema,
  MetaCredentialsSchema,
  TikTokCredentialsSchema,
  GoogleCredentialsTypedSchema,
  MetaCredentialsTypedSchema,
  TikTokCredentialsTypedSchema,
  PlatformCredentialsSchema,
  LineItemSchema,
  ConversionDataSchema,
  // Type guards
  isGoogleCredentials,
  isMetaCredentials,
  isTikTokCredentials,
  isTypedGoogleCredentials,
  isTypedMetaCredentials,
  isTypedTikTokCredentials,
  // Utilities
  upgradeCredentials,
  validateCredentials,
  validatePlatformCredentials,
} from "./platform";

// =============================================================================
// Consent Types
// =============================================================================

export type {
  ConsentCategory,
  ConsentStrategy,
  ConsentState,
  ConsentDecision,
  PlatformConsentConfig,
  GDPRJobType,
  // GDPRJobStatus is exported as a value from enums, type as GDPRJobStatusType
  GDPRJobData,
  TrustLevel,
  TrustResult,
  TrustVerificationOptions,
} from "./consent";

// =============================================================================
// Webhook Types
// =============================================================================

export type {
  OrderWebhookPayload,
  MinimalOrderPayload,
  ApiResponse,
  SurveyResponseData,
  ShopData,
  RiskSeverity,
  RiskItem,
  ScanResult,
  ScriptTag,
  CheckoutConfig,
  AlertChannel,
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
  AlertSettings,
  AlertConfig,
  AlertData,
  ReconciliationResult,
  ReconciliationSummary,
  ReconciliationReportData,
} from "./webhook";

export { toMinimalOrderPayload } from "./webhook";

// =============================================================================
// Shopify Types
// =============================================================================

export type {
  WebhookRegisterResult,
  WebhookRegisterResults,
  WebhookSubscriptionEdge,
  WebhookSubscriptionsQueryResponse,
  WebhookDeleteMutationResponse,
  ShopQueryResponse,
  ShopTierValue,
  GraphQLResponse,
  SimpleGraphQLClient,
  NullableAdminContext,
  ShopifySessionData,
  WebPixelCreateResponse,
  WebPixelUpdateResponse,
  WebPixelDeleteResponse,
  CheckoutProfilesQueryResponse,
  ScriptTagData,
  ScriptTagsQueryResponse,
  ShopifyAddress,
  ShopifyCustomer,
  ShopifyLineItem,
  ShopifyMoneySet,
  ShopifyOrder,
} from "./shopify";

export {
  isShopTierValue,
  hasGraphQLErrors,
  extractGraphQLErrors,
} from "./shopify";

// =============================================================================
// Result Types
// =============================================================================

export {
  // Core types
  type Result,
  type AsyncResult,
  type Ok,
  type Err,
  type VoidResult,
  type AsyncVoidResult,
  type SimpleResult,
  type IdResult,
  // Constructors
  ok,
  err,
  // Type guards
  isOk,
  isErr,
  // Utilities
  unwrap,
  unwrapOr,
  unwrapOrElse,
  map,
  mapErr,
  flatMap,
  combine,
  combineAll,
  // Async utilities
  fromPromise,
  fromThrowable,
  mapAsync,
  flatMapAsync,
  // Pattern matching
  match,
  tap,
  tapErr,
} from "./result";
