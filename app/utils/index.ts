/**
 * Utilities Module
 *
 * Centralized exports for all utility functions, types, and helpers.
 * Import from this file for cleaner imports throughout the app.
 */

// =============================================================================
// Error Handling
// =============================================================================

export * from "./errors/index";

// =============================================================================
// Logging
// =============================================================================

export { logger, createRequestLogger, type RequestLogger } from "./logger.server";

// =============================================================================
// Security & Cryptography
// =============================================================================

export {
  hashValue,
  normalizePhone,
  normalizeEmail,
  getEncryptionKey,
  validateEncryptionConfig,
} from "./crypto.server";

export {
  encryptAccessToken,
  decryptAccessToken,
  isTokenEncrypted,
  ensureTokenEncrypted,
  migrateToEncrypted,
  encryptIngestionSecret,
  decryptIngestionSecret,
  generateEncryptedIngestionSecret,
  validateTokenEncryptionConfig,
  TokenDecryptionError,
} from "./token-encryption";

export { 
  withSecurityHeaders,
  addSecurityHeaders,
  addSecurityHeadersToHeaders,
  getProductionSecurityHeaders,
  validateSecurityHeaders,
  CSP_DIRECTIVES,
  EMBEDDED_APP_HEADERS,
  API_SECURITY_HEADERS,
  WEBHOOK_SECURITY_HEADERS,
  PIXEL_INGESTION_HEADERS,
  HEALTH_CHECK_HEADERS,
  HSTS_HEADER,
  buildCspHeader,
} from "./security-headers";

// =============================================================================
// Validation & Request Handling
// =============================================================================

export {
  validateJsonBody,
  requireValidJsonBody,
  validateFormData,
  requireValidFormData,
  validateQueryParams,
  requireValidQueryParams,
  formatZodErrors,
  getFirstZodError,
  validationErrorResponse,
  withValidation,
  type ValidationResult,
  // Note: ValidationError class also exported from ./errors/index
  type ValidationError as ZodValidationError,
  type ValidateResult,
} from "./validate-request";

export {
  withErrorHandling,
  withLoaderErrorHandling,
  parseJsonBody,
  parseFormData,
  getRequiredQueryParam,
  getQueryParam,
  getNumericQueryParam,
  apiResponse,
  noContentResponse,
  createdResponse,
  acceptedResponse,
  type ActionHandler,
  type LoaderHandler,
  type ApiHandlerOptions,
} from "./api-handler";

// =============================================================================
// Configuration & Constants
// =============================================================================

export {
  // Environment helpers
  getEnv,
  getRequiredEnv,
  getBoolEnv,
  getNumEnv,
  isProduction,
  isDevelopment,
  // Configuration objects
  CONFIG,
  API_CONFIG,
  RATE_LIMIT_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  RETRY_CONFIG,
  RETENTION_CONFIG,
  ENCRYPTION_CONFIG,
  SHOPIFY_API_CONFIG,
  PLATFORM_ENDPOINTS,
  CAPI_CONFIG,
  WEBHOOK_CONFIG,
  SCANNER_CONFIG,
  MONITORING_CONFIG,
  FEATURE_FLAGS,
  PCD_CONFIG,
  INGESTION_KEY_CONFIG,
  // Validation
  validateConfig,
  validateAllConfig,
  logConfigStatus,
  // Summaries
  getConfigSummary,
  getRetentionConfigSummary,
  getFeatureFlagsSummary,
  getPcdConfigSummary,
  // Utilities
  getApiTimeout,
  getRateLimitForEndpoint,
  isFeatureEnabled,
  getEnabledFeatures,
  type ConfigValidationResult,
} from "./config";

export {
  DEPRECATION_DATES,
  DEADLINE_METADATA,
  getScriptTagDeprecationStatus,
  getScriptTagCreationStatus,
  getScriptTagExecutionStatus,
  getAdditionalScriptsDeprecationStatus,
  getMigrationUrgencyStatus,
  getUpgradeStatusMessage,
  getDateDisplayLabel,
  formatDeadlineForUI,
  type DeprecationStatus,
  type DatePrecision,
  type DateDisplayInfo,
  type ShopTier,
  type ShopUpgradeStatus,
} from "./deprecation-dates";

// =============================================================================
// Shop & Origin Validation
// =============================================================================

export {
  isValidShopifyOrigin,
  isDevMode,
  isValidDevOrigin,
  isValidPixelOrigin,
  validatePixelOriginPreBody,
  validateOrigin,
  isOriginInAllowlist,
  buildDefaultAllowedDomains,
  buildShopAllowedDomains,
  validatePixelOriginForShop,
  extractOriginHost,
  getAllowedPatterns,
  SHOPIFY_ALLOWLIST,
} from "./origin-validation";

export {
  timingSafeEquals,
  getShopWithDecryptedFields,
  getShopByIdWithDecryptedFields,
  getDecryptedIngestionSecret,
  getShopForVerification,
  verifyWithGraceWindow,
  type DecryptedShop,
  type ShopVerificationData,
  type ShopWithDecryptedSecret,
} from "./shop-access";

// =============================================================================
// Webhook Validation
// =============================================================================

export {
  validateOrderWebhookPayload,
  parseOrderWebhookPayload,
  parseGDPRDataRequestPayload,
  parseGDPRCustomerRedactPayload,
  parseGDPRShopRedactPayload,
  type GDPRDataRequestPayload,
  type GDPRCustomerRedactPayload,
  type GDPRShopRedactPayload,
  type GDPRValidationResult,
} from "./webhook-validation";

// =============================================================================
// Cache & Rate Limiting
// =============================================================================

export {
  // Classes
  SimpleCache,
  RedisCache,
  // TTL Presets
  TTL,
  // Memoization
  memoizeAsync,
  memoize,
  // Singleton caches
  billingCache,
  shopConfigCache,
  pixelConfigCache,
  secretCache,
  // Global operations
  clearAllCaches,
  cleanupCaches,
  getCacheStats,
  invalidateShopCaches,
  // Cache keys
  CACHE_NAMESPACES,
  CacheKeyBuilder,
  CacheKeys,
  // Cache warming
  warmCache,
  warmRedisCache,
  registerCacheWarmer,
  runCacheWarmers,
  // Types
  type CacheOptions,
  type CacheStats,
  type ShopConfigCacheEntry,
  type CacheWarmerOptions,
  type CacheWarmEntry,
  type CacheWarmResult,
} from "./cache";

export {
  // Rate limit functions
  checkRateLimit,
  checkRateLimitAsync,
  resetRateLimit,
  createRateLimitResponse,
  addRateLimitHeaders,
  withRateLimit,
  getRateLimitConfig,
  getRateLimitStats,
  // Anomaly tracking
  trackAnomaly,
  unblockShop,
  clearAllTracking,
  getBlockedShops,
  getAnomalyStats,
  cleanupAnomalyTrackers,
  // Security headers
  SECURITY_HEADERS,
  addSecurityHeaders as addRateLimiterSecurityHeaders,
  // Types
  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limiter";

// =============================================================================
// Circuit Breaker
// =============================================================================

export {
  checkCircuitBreaker,
  isCircuitBreakerTripped,
  tripCircuitBreaker,
  resetCircuitBreaker,
  getCircuitBreakerState,
  getCircuitBreakerStats,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
  type CircuitBreakerResult,
} from "./circuit-breaker";

// =============================================================================
// Redis Client
// =============================================================================

export {
  getRedisClient,
  getRedisClientSync,
  closeRedisConnection,
  getRedisConnectionInfo,
  type RedisClientWrapper,
  type ConnectionInfo,
} from "./redis-client";

// =============================================================================
// Cron & Job Utilities
// =============================================================================

export {
  acquireCronLock,
  releaseCronLock,
  withCronLock,
} from "./cron-lock";

// =============================================================================
// Helpers & Formatters
// =============================================================================

export {
  // Safe parsing
  safeParseFloat,
  safeParseInt,
  safeParseBool,
  // String utilities
  truncate,
  normalizeShopDomain,
  // Note: getErrorMessage also exported from ./errors/index with more features
  getErrorMessage as getErrorMessageSimple,
  maskSensitive,
  // Object utilities
  getNestedValue,
  isObject,
  removeNullish,
  // Array utilities
  chunk,
  unique,
  groupBy,
  // Date utilities
  isWithinTimeWindow,
  getCurrentYearMonth,
  daysAgo,
  daysAgoUTC,
  // Async utilities
  delay,
  retry,
  parallelLimit,
  // Validation utilities
  isValidEmail,
  isValidUrl,
  isShopifyDomain,
  // ID utilities
  generateSimpleId,
  extractShopifyId,
} from "./helpers";

export {
  sanitizeString,
  sanitizeUrl,
  sanitizeObject,
  escapeHtml,
  containsSqlInjectionPattern,
  validateDatabaseInput,
  SecureShopDomainSchema,
  SecureEmailSchema,
  SecureOrderIdSchema,
  SecureUrlSchema,
  SafeStringSchema,
} from "./security";

// =============================================================================
// PII & Consent
// =============================================================================

export {
  maskEmail,
  maskPhone,
  maskName,
  maskPII,
  extractPIISafely,
  detectPII,
  hasPII,
  calculatePIIQuality,
  getPIIQualityLabel,
  logPIIStatus,
  PII_PATTERNS,
  PII_FIELD_NAMES,
  type ExtractedPII,
} from "./pii";

export {
  evaluatePlatformConsent,
  evaluatePlatformConsentWithStrategy,
  getPlatformConsentRequirements,
  getAllPlatformConsentRequirements,
  getPlatformConsentCategory,
  getEffectiveConsentCategory,
  getAllowedPlatforms,
  isMarketingPlatform,
  isAnalyticsPlatform,
  PLATFORM_CONSENT_CONFIG,
  type ConsentDecision,
  type ConsentState,
  type ConsentCategory,
  type PlatformConsentConfig,
} from "./platform-consent";

// =============================================================================
// Action Response Helpers
// =============================================================================

export {
  // Note: successResponse and errorResponse also exported from ./errors/index for Result pattern
  // These are for simple action responses (not Result-based)
  successResponse as actionSuccessResponse,
  successMessage,
  errorResponse as actionErrorResponse,
  jsonSuccess,
  jsonSuccessMessage,
  jsonError,
  jsonValidationError,
  jsonNotFound,
  jsonUnauthorized,
  jsonForbidden,
  jsonRateLimited,
  jsonInternalError,
  isActionSuccess,
  isActionError,
  unwrapResponse,
  unwrapResponseOr,
  type ActionSuccess,
  type ActionError,
  type ActionResponse,
  type VoidActionResponse,
} from "./action-response";

// =============================================================================
// HTTP & Response Utilities
// =============================================================================

export {
  httpRequest,
  fetchWithTimeout,
  getJson,
  postJson,
  isRetryableStatus,
  classifyHttpResponse,
  extractRetryAfter,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  type HttpRequestOptions,
  type HttpResponse,
  type HttpError,
} from "./http";

export {
  getPixelEventsCorsHeaders,
  getPixelEventsCorsHeadersForShop,
  handleCorsPreFlight,
  addCorsHeaders,
  getDynamicCorsHeaders,
  jsonWithCors,
  STATIC_CORS_HEADERS,
  type CorsResponseInit,
} from "./cors";

export {
  // JSON utilities
  safeJsonParse,
  safeJsonStringify,
  deepClone,
  deepMerge,
  // String utilities
  capitalize,
  camelToKebab,
  kebabToCamel,
  slugify,
  truncate as truncateCommon,
  maskString,
  // Number utilities
  clamp,
  roundTo,
  formatCurrency,
  formatNumber,
  formatPercentage,
  sum,
  average,
  // Date utilities
  formatDate,
  formatDateTime,
  getRelativeTime,
  getDayBounds,
  getUTCDayBounds,
  getMonthBounds,
  isDateInRange,
  // Object utilities
  pick,
  omit,
  isEmpty,
  isNullish,
  isNonEmptyString,
  // Array utilities
  flatten,
  uniqueBy,
  chunk as chunkCommon,
  unique as uniqueCommon,
  groupBy as groupByCommon,
  debounce,
  throttle,
  // Async utilities
  sleep,
  retry as retryCommon,
  parallelLimit as parallelLimitCommon,
  // Validation utilities
  isValidEmail as isValidEmailCommon,
  isValidUrl as isValidUrlCommon,
  // Environment utilities
  getEnv as getEnvCommon,
  getEnvBoolean,
  getEnvNumber,
  isProduction as isProductionCommon,
  isDevelopment as isDevelopmentCommon,
  isTest,
} from "./common";

// =============================================================================
// Metrics & Monitoring
// =============================================================================

export {
  incrementCounter,
  setGauge,
  recordHistogram,
  getCounters,
  getGauges,
  getHistogramStats,
  getAggregatedMetrics,
  resetMetrics,
  appMetrics,
} from "./metrics-collector";

// Re-export MetricLabels type for compatibility
export type MetricLabels = Record<string, string>;

// =============================================================================
// Tracing (P3)
// =============================================================================

export {
  // Span management
  startSpan,
  withSpan,
  withSpanAsync,
  getCurrentSpan,
  getCurrentTraceId,
  addSpanEvent,
  setSpanAttributes,
  // HTTP tracing
  startServerSpan,
  endServerSpan,
  extractTraceContext,
  injectTraceContext,
  // Database tracing
  startDbSpan,
  traceDbOperation,
  // External service tracing
  startExternalHttpSpan,
  traceExternalHttp,
  // Processor registration
  registerSpanProcessor,
  removeSpanProcessor,
  // Combined export
  tracing,
  // Enums
  SpanStatus,
  SpanKind,
  // Types
  type Span,
  type ActiveSpan,
  type SpanContext,
  type SpanAttributes,
  type SpanEvent,
  type SpanLink,
  type SpanProcessor,
} from "./tracing.server";

// =============================================================================
// JWT & Session
// =============================================================================

export {
  verifyShopifyJwt,
} from "./shopify-jwt";

// =============================================================================
// Receipt & Trust
// =============================================================================

export {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  type ReceiptTrustResult,
  type VerifyReceiptOptions,
  type TrustLevel,
  type UntrustedReason,
} from "./receipt-trust";

// =============================================================================
// Secrets Management
// =============================================================================

export {
  checkSecurityViolations,
  validateSecrets,
  ensureSecretsValid,
  enforceSecurityChecks,
  getRequiredSecret,
  getOptionalSecret,
} from "./secrets";
