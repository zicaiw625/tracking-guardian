

export {

  JobStatus,
  ConversionLogStatus,
  WebhookStatus,
  GDPRJobStatus,
  ScanStatus,
  MigrationStatus,

  TrustLevel as TrustLevelEnum,
  SignatureStatus,
  ConsentStrategy as ConsentStrategyEnum,

  Platform as PlatformEnum,
  PLATFORM_DISPLAY_NAMES,
  EventType,

  ShopTier,
  PlanId,

  AlertChannel as AlertChannelEnum,
  AlertFrequency,

  ActorType,
  AuditAction,
  PlatformResultStatus,

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

export type {
  Platform,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  PinterestCredentials,
  SnapchatCredentials,
  TwitterCredentials,
  WebhookCredentials,
  PlatformCredentials,
  GoogleCredentialsTyped,
  MetaCredentialsTyped,
  TikTokCredentialsTyped,
  PinterestCredentialsTyped,
  SnapchatCredentialsTyped,
  TwitterCredentialsTyped,
  TypedPlatformCredentials,
  LineItem,
  ConversionData,
  ConversionStatus,
  ConversionLogData,
  ConversionApiResponse,
  PlatformErrorType,
  PlatformError,
  PlatformResult,
  PixelConfigData,
  MigrationConfig,
  MigrationResult,
  GooglePlatformConfig,
  MetaPlatformConfig,
  TikTokPlatformConfig,
  PinterestPlatformConfig,
  SnapchatPlatformConfig,
  TwitterPlatformConfig,
  PlatformConfig,
  ExtractCredentials,
} from "./platform";

export {

  parseCapiInput,
  parseConsentState,
  parseConsentEvidence,
  parseTrustMetadata,
  parsePlatformResults,
  parsePixelClientConfig,
  parseRiskItems,
  parseIdentifiedPlatforms,
  parsePlatformResponse,

  isCapiInputJson,
  isConsentStateJson,
} from "./database";

export {
  PLATFORM_NAMES,

  GoogleCredentialsSchema,
  MetaCredentialsSchema,
  TikTokCredentialsSchema,
  GoogleCredentialsTypedSchema,
  MetaCredentialsTypedSchema,
  TikTokCredentialsTypedSchema,
  PlatformCredentialsSchema,
  LineItemSchema,
  ConversionDataSchema,

  isGoogleCredentials,
  isMetaCredentials,
  isTikTokCredentials,
  isTypedGoogleCredentials,
  isTypedMetaCredentials,
  isTypedTikTokCredentials,

  upgradeCredentials,
  validateCredentials,
  validatePlatformCredentials,
} from "./platform";

export type {
  ConsentCategory,
  ConsentStrategy,
  ConsentState,
  ConsentDecision,
  PlatformConsentConfig,
  GDPRJobType,

  GDPRJobData,
  TrustLevel,
  TrustResult,
  TrustVerificationOptions,
} from "./consent";

export type {

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

export {

  type Result,
  type AsyncResult,
  type Ok,
  type Err,
  type VoidResult,
  type AsyncVoidResult,
  type SimpleResult,
  type IdResult,

  ok,
  err,

  isOk,
  isErr,

  unwrap,
  unwrapOr,
  unwrapOrElse,
  map,
  mapErr,
  flatMap,
  combine,
  combineAll,

  fromPromise,
  fromThrowable,
  mapAsync,
  flatMapAsync,

  match,
  tap,
  tapErr,
} from "./result";
