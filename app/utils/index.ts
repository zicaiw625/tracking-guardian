

export * from "./errors/index";

export { logger, createRequestLogger, type RequestLogger } from "./logger.server";

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

export {

  getEnv,
  getRequiredEnv,
  getBoolEnv,
  getNumEnv,
  isProduction,
  isDevelopment,

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

  validateConfig,
  validateAllConfig,
  logConfigStatus,

  getConfigSummary,
  getRetentionConfigSummary,
  getFeatureFlagsSummary,
  getPcdConfigSummary,

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

export {

  SimpleCache,
  RedisCache,

  TTL,

  memoizeAsync,
  memoize,

  billingCache,
  shopConfigCache,
  pixelConfigCache,
  secretCache,

  clearAllCaches,
  cleanupCaches,
  getCacheStats,
  invalidateShopCaches,

  CACHE_NAMESPACES,
  CacheKeyBuilder,
  CacheKeys,

  warmCache,
  warmRedisCache,
  registerCacheWarmer,
  runCacheWarmers,

  type CacheOptions,
  type CacheStats,
  type ShopConfigCacheEntry,
  type CacheWarmerOptions,
  type CacheWarmEntry,
  type CacheWarmResult,
} from "./cache";

export {

  checkRateLimit,
  checkRateLimitAsync,
  resetRateLimit,
  createRateLimitResponse,
  addRateLimitHeaders,
  withRateLimit,
  getRateLimitConfig,
  getRateLimitStats,

  trackAnomaly,
  unblockShop,
  clearAllTracking,
  getBlockedShops,
  getAnomalyStats,
  cleanupAnomalyTrackers,

  SECURITY_HEADERS,
  addSecurityHeaders as addRateLimiterSecurityHeaders,

  type RateLimitConfig,
  type RateLimitResult,
} from "./rate-limiter";

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

export {
  getRedisClient,
  getRedisClientSync,
  closeRedisConnection,
  getRedisConnectionInfo,
  type RedisClientWrapper,
  type ConnectionInfo,
} from "./redis-client";

export {
  acquireCronLock,
  releaseCronLock,
  withCronLock,
} from "./cron-lock";

export {

  safeParseFloat,
  safeParseInt,
  safeParseBool,

  truncate,
  normalizeShopDomain,

  getErrorMessage as getErrorMessageSimple,
  maskSensitive,

  getNestedValue,
  isObject,
  removeNullish,

  chunk,
  unique,
  groupBy,

  isWithinTimeWindow,
  getCurrentYearMonth,
  daysAgo,
  daysAgoUTC,

  delay,
  retry,
  parallelLimit,

  isValidEmail,
  isValidUrl,
  isShopifyDomain,

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

export {

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

export {
  httpRequest,
  fetchWithTimeout,
  getJson,
  postJson,
  isRetryableStatus,
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

  safeJsonParse,
  safeJsonStringify,
  deepClone,
  deepMerge,

  capitalize,
  camelToKebab,
  kebabToCamel,
  slugify,
  truncate as truncateCommon,
  maskString,

  clamp,
  roundTo,
  formatCurrency,
  formatNumber,
  formatPercentage,
  sum,
  average,

  formatDate,
  formatDateTime,
  getRelativeTime,
  getDayBounds,
  getUTCDayBounds,
  getMonthBounds,
  isDateInRange,

  pick,
  omit,
  isEmpty,
  isNullish,
  isNonEmptyString,

  flatten,
  uniqueBy,
  chunk as chunkCommon,
  unique as uniqueCommon,
  groupBy as groupByCommon,
  debounce,
  throttle,

  sleep,
  retry as retryCommon,
  parallelLimit as parallelLimitCommon,

  isValidEmail as isValidEmailCommon,
  isValidUrl as isValidUrlCommon,

  getEnv as getEnvCommon,
  getEnvBoolean,
  getEnvNumber,
  isProduction as isProductionCommon,
  isDevelopment as isDevelopmentCommon,
  isTest,
} from "./common";

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

export type MetricLabels = Record<string, string>;

export {

  startSpan,
  withSpan,
  withSpanAsync,
  getCurrentSpan,
  getCurrentTraceId,
  addSpanEvent,
  setSpanAttributes,

  startServerSpan,
  endServerSpan,
  extractTraceContext,
  injectTraceContext,

  startDbSpan,
  traceDbOperation,

  startExternalHttpSpan,
  traceExternalHttp,

  registerSpanProcessor,
  removeSpanProcessor,

  tracing,

  SpanStatus,
  SpanKind,

  type Span,
  type ActiveSpan,
  type SpanContext,
  type SpanAttributes,
  type SpanEvent,
  type SpanLink,
  type SpanProcessor,
} from "./tracing.server";

export {
  verifyShopifyJwt,
} from "./shopify-jwt";

export {
  verifyReceiptTrust,
  isSendAllowedByTrust,
  buildTrustMetadata,
  type ReceiptTrustResult,
  type VerifyReceiptOptions,
  type TrustLevel,
  type UntrustedReason,
} from "./receipt-trust";

export {
  checkSecurityViolations,
  validateSecrets,
  ensureSecretsValid,
  enforceSecurityChecks,
  getRequiredSecret,
  getOptionalSecret,
} from "./secrets";
