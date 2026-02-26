export * from "./config.shared";

import {
  API_CONFIG,
  RATE_LIMIT_CONFIG,
  CIRCUIT_BREAKER_CONFIG,
  RETRY_CONFIG,
  ENCRYPTION_CONFIG,
  INGESTION_KEY_CONFIG,
  SHOPIFY_API_CONFIG,
  PLATFORM_ENDPOINTS,
  WEBHOOK_CONFIG,
  SCANNER_CONFIG,
  MONITORING_CONFIG,
  JOB_PROCESSING_CONFIG,
  PIXEL_VALIDATION_CONFIG,
  QUERY_PERFORMANCE_CONFIG,
  CONSENT_CONFIG,
  CRON_CONFIG,
} from "./config.shared";
import { logger } from "./logger.server";

function logWarn(message: string) {
  logger.warn(message);
}

function logInfo(message: string) {
  logger.info(message);
}

function logError(message: string) {
  logger.error(message);
}

type RetentionConfig = {
  MIN_DAYS: number;
  MAX_DAYS: number;
  DEFAULT_DAYS: number;
  AUDIT_LOG_DAYS: number;
  NONCE_EXPIRY_MS: number;
  WEBHOOK_LOG_DAYS: number;
  RECEIPT_DAYS: number;
};

function getRetentionDays(envKey: string, defaultValue: number, minValue?: number): number {
  const envValue = typeof process !== "undefined" ? process.env[envKey] : undefined;
  if (!envValue) return defaultValue;
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed)) return defaultValue;
  if (minValue !== undefined && parsed < minValue) {
    logWarn(`[P2-03] ${envKey}=${parsed} is below minimum ${minValue}, using minimum`);
    return minValue;
  }
  return parsed;
}

function normalizeRetentionConfig(config: RetentionConfig): RetentionConfig {
  const minDays = config.MIN_DAYS;
  let maxDays = config.MAX_DAYS;
  if (minDays > maxDays) {
    logWarn(`[P2-03] RETENTION_MIN_DAYS (${minDays}) exceeds RETENTION_MAX_DAYS (${maxDays}); using MIN for both`);
    maxDays = minDays;
  }
  let defaultDays = config.DEFAULT_DAYS;
  if (defaultDays < minDays) {
    logWarn(`[P2-03] RETENTION_DEFAULT_DAYS (${defaultDays}) below MIN_DAYS (${minDays}); using MIN_DAYS`);
    defaultDays = minDays;
  }
  if (defaultDays > maxDays) {
    logWarn(`[P2-03] RETENTION_DEFAULT_DAYS (${defaultDays}) above MAX_DAYS (${maxDays}); using MAX_DAYS`);
    defaultDays = maxDays;
  }
  return {
    ...config,
    MIN_DAYS: minDays,
    MAX_DAYS: maxDays,
    DEFAULT_DAYS: defaultDays,
  };
}

export const RETENTION_CONFIG = normalizeRetentionConfig({
  MIN_DAYS: getRetentionDays("RETENTION_MIN_DAYS", 30, 1),
  MAX_DAYS: getRetentionDays("RETENTION_MAX_DAYS", 365),
  DEFAULT_DAYS: getRetentionDays("RETENTION_DEFAULT_DAYS", 90),
  AUDIT_LOG_DAYS: getRetentionDays("RETENTION_AUDIT_LOG_DAYS", 365, 180),
  NONCE_EXPIRY_MS: getRetentionDays("RETENTION_NONCE_EXPIRY_HOURS", 1) * 60 * 60 * 1000,
  WEBHOOK_LOG_DAYS: getRetentionDays("RETENTION_WEBHOOK_LOG_DAYS", 7),
  RECEIPT_DAYS: getRetentionDays("RETENTION_RECEIPT_DAYS", 90),
} as RetentionConfig);

export function getRetentionConfigSummary(): Record<string, { value: number | string; unit: string; source: "default" | "env" }> {
  return {
    minDays: {
      value: RETENTION_CONFIG.MIN_DAYS,
      unit: "days",
      source: process.env.RETENTION_MIN_DAYS ? "env" : "default",
    },
    maxDays: {
      value: RETENTION_CONFIG.MAX_DAYS,
      unit: "days",
      source: process.env.RETENTION_MAX_DAYS ? "env" : "default",
    },
    defaultDays: {
      value: RETENTION_CONFIG.DEFAULT_DAYS,
      unit: "days",
      source: process.env.RETENTION_DEFAULT_DAYS ? "env" : "default",
    },
    auditLogDays: {
      value: RETENTION_CONFIG.AUDIT_LOG_DAYS,
      unit: "days",
      source: process.env.RETENTION_AUDIT_LOG_DAYS ? "env" : "default",
    },
    nonceExpiry: {
      value: RETENTION_CONFIG.NONCE_EXPIRY_MS / (60 * 60 * 1000),
      unit: "hours",
      source: process.env.RETENTION_NONCE_EXPIRY_HOURS ? "env" : "default",
    },
    webhookLogDays: {
      value: RETENTION_CONFIG.WEBHOOK_LOG_DAYS,
      unit: "days",
      source: process.env.RETENTION_WEBHOOK_LOG_DAYS ? "env" : "default",
    },
    receiptDays: {
      value: RETENTION_CONFIG.RECEIPT_DAYS,
      unit: "days",
      source: process.env.RETENTION_RECEIPT_DAYS ? "env" : "default",
    },
  };
}

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "ENCRYPTION_SECRET",
  "ENCRYPTION_SALT",
  "CRON_SECRET",
  "SCOPES",
] as const;

const PIXEL_INGESTION_ENABLED_CHECK = {
  key: "PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY",
  reason:
    "Production recommendation: PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=true (null/missing Origin allowed only when request has signature). When false: null/missing Origin requests are rejected (even if signed) and events are lost. If your deployment receives pixel events from Web Pixel sandbox, set =true explicitly.",
} as const;

const RECOMMENDED = [
  { key: "REDIS_URL", reason: "for shared rate limiting/locks in multi-instance deployments" },
  {
    key: "EXTENSION_BACKEND_URL_INJECTED",
    reason: "for diagnostics consistency (set true after running ext:inject in deployment pipeline)",
  },
] as const;

export const CRON_SECRET_CONFIG = {
  SECRET: process.env.CRON_SECRET || "",
  SECRET_PREVIOUS: process.env.CRON_SECRET_PREVIOUS || "",
  MIN_LENGTH: 32,
} as const;

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!process.env[key]) {
      if (isProduction) {
        errors.push(`Missing required environment variable: ${key}`);
      } else {
        warnings.push(`${key} not set (required in production)`);
      }
    }
  }
  for (const { key, reason } of RECOMMENDED) {
    if (!process.env[key]) {
      warnings.push(`${key} not set - ${reason}`);
    }
  }
  if (isProduction) {
    if (process.env.ALLOW_MEMORY_REDIS_IN_PROD === "true") {
      errors.push("ALLOW_MEMORY_REDIS_IN_PROD cannot be true in production. Redis is required for rate-limiting and security.");
    }
    if (!process.env.REDIS_URL) {
      errors.push("REDIS_URL is required in production (rate-limit/nonce/idempotency need shared storage).");
    }
  }
  if (isProduction && process.env.TRUST_PROXY !== "true") {
    errors.push("TRUST_PROXY must be true in production (required for correct IP rate limiting to prevent self-DoS)");
  }
  if (isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
    errors.push("ALLOW_UNSIGNED_PIXEL_EVENTS cannot be true in production");
  }
  if (isProduction && process.env.SECURITY_ENFORCEMENT?.toLowerCase().trim() === "relaxed") {
    errors.push("SECURITY_ENFORCEMENT cannot be 'relaxed' in production");
  }
  if (isProduction) {
    const raw = process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY?.toLowerCase().trim();
    if (raw == null || raw === "") {
      errors.push("PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY must be explicitly set in production (true/false/1/0)");
    } else if (!["true", "1", "false", "0"].includes(raw)) {
      errors.push(
        `PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY has invalid value in production (allowed: true/false/1/0). Current: ${process.env.PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY}`
      );
    } else if (raw === "false" || raw === "0") {
      warnings.push(
        `PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY=false in production: null/missing Origin pixel requests will be rejected (events may be lost). ${PIXEL_INGESTION_ENABLED_CHECK.reason}`
      );
    }
  }
  if (isProduction) {
    const scopesEnv = process.env.SCOPES;
    if (!scopesEnv || scopesEnv.trim() === "") {
      errors.push("SCOPES must be set in production");
    } else {
      const scopes = scopesEnv.split(",").map(s => s.trim()).filter(Boolean);
      if (scopes.length === 0) {
        errors.push("SCOPES must contain at least one scope in production");
      } else {
        const requiredScopes = ["read_script_tags", "read_pixels", "write_pixels", "read_customer_events"];
        const missingScopes = requiredScopes.filter(required => !scopes.includes(required));
        if (missingScopes.length > 0) {
          errors.push(`SCOPES must include all required scopes in production. Missing: ${missingScopes.join(", ")}`);
        }
      }
    }
  }
  if (process.env.ENCRYPTION_SECRET && process.env.ENCRYPTION_SECRET.length < 32) {
    warnings.push("ENCRYPTION_SECRET should be at least 32 characters");
  }
  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) {
    warnings.push("CRON_SECRET should be at least 32 characters");
  }
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("postgres")) {
    errors.push("DATABASE_URL must be a PostgreSQL connection string");
  }
  if (process.env.SHOPIFY_APP_URL) {
    try {
      const parsed = new URL(process.env.SHOPIFY_APP_URL);
      if (isProduction && parsed.protocol !== "https:") {
        errors.push("SHOPIFY_APP_URL must use https in production");
      }
    } catch {
      errors.push("SHOPIFY_APP_URL must be a valid URL");
    }
  }
  if (process.env.PUBLIC_APP_URL) {
    try {
      const parsed = new URL(process.env.PUBLIC_APP_URL);
      if (isProduction && parsed.protocol !== "https:") {
        errors.push("PUBLIC_APP_URL must use https in production");
      }
    } catch {
      errors.push("PUBLIC_APP_URL must be a valid URL");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || "";
}

export function getEnv(key: string, defaultValue: string = ""): string {
  return process.env[key] || defaultValue;
}

export function getBoolEnv(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

export function getNumEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

export function getSupportConfig(): {
  contactEmail: string;
  faqUrl: string;
  statusPageUrl: string;
} {
  return {
    contactEmail: getEnv("SUPPORT_EMAIL", "support@tracking-guardian.com"),
    faqUrl: getEnv("SUPPORT_FAQ_URL", ""),
    statusPageUrl: getEnv("STATUS_PAGE_URL", ""),
  };
}

export function getPublicAppDomain(): string {
  return getEnv("SHOPIFY_APP_URL", getEnv("APP_URL", "https://tracking-guardian.onrender.com"));
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isStrictSecurityMode(): boolean {
  const securityEnforcement = process.env.SECURITY_ENFORCEMENT?.toLowerCase().trim();
  if (securityEnforcement === "strict") {
    return true;
  }
  if (securityEnforcement === "relaxed") {
    return false;
  }
  const isProd = isProduction();
  const isLocalDev = process.env.LOCAL_DEV === "true" || process.env.LOCAL_DEV === "1";
  if (isProd) {
    return true;
  }
  return !isLocalDev;
}

export const PCD_CONFIG = {
  APPROVED: getBoolEnv("PCD_APPROVED", false),
} as const;

export const ORDER_WEBHOOK_ENABLED = getBoolEnv("ORDER_WEBHOOK_ENABLED", false);
export const SERVER_SIDE_CONVERSIONS_ENABLED = getBoolEnv("SERVER_SIDE_CONVERSIONS_ENABLED", false);

export const FEATURE_FLAGS = {
  FUNNEL_EVENTS: getBoolEnv("FEATURE_FUNNEL_EVENTS", false),
  DEBUG_LOGGING: getBoolEnv("FEATURE_DEBUG_LOGGING", false),
  EXTENDED_PAYLOAD: getBoolEnv("FEATURE_EXTENDED_PAYLOAD", false),
  TRACKING_API: getBoolEnv("FEATURE_TRACKING_API", false),
  CHECKOUT_BLOCKS: getBoolEnv("FEATURE_CHECKOUT_BLOCKS", false),
} as const;

export function getFeatureFlagsSummary(): Record<string, { enabled: boolean; source: "default" | "env" }> {
  return {
    funnelEvents: {
      enabled: FEATURE_FLAGS.FUNNEL_EVENTS,
      source: process.env.FEATURE_FUNNEL_EVENTS ? "env" : "default",
    },
    debugLogging: {
      enabled: FEATURE_FLAGS.DEBUG_LOGGING,
      source: process.env.FEATURE_DEBUG_LOGGING ? "env" : "default",
    },
    extendedPayload: {
      enabled: FEATURE_FLAGS.EXTENDED_PAYLOAD,
      source: process.env.FEATURE_EXTENDED_PAYLOAD ? "env" : "default",
    },
    trackingApi: {
      enabled: FEATURE_FLAGS.TRACKING_API,
      source: process.env.FEATURE_TRACKING_API ? "env" : "default",
    },
    checkoutBlocks: {
      enabled: FEATURE_FLAGS.CHECKOUT_BLOCKS,
      source: process.env.FEATURE_CHECKOUT_BLOCKS ? "env" : "default",
    },
  };
}

export function logConfigStatus(): void {
  const result = validateConfig();
  logInfo("\n=== Configuration Status ===");
  logInfo(`Environment: ${typeof process !== "undefined" ? (process.env.NODE_ENV || "development") : "unknown"}`);
  if (result.errors.length > 0) {
    logError("\n❌ Configuration Errors:");
    for (const error of result.errors) {
      logError(`   - ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    logWarn("\n⚠️ Configuration Warnings:");
    for (const warning of result.warnings) {
      logWarn(`   - ${warning}`);
    }
  }
  if (result.valid && result.warnings.length === 0) {
    logInfo("\n✅ All configuration checks passed");
  }
  logInfo("============================\n");
  if (!result.valid && isProduction()) {
    throw new Error("Invalid configuration - cannot start in production");
  }
}

export const CONFIG = {
  env: {
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: isProduction(),
    isDevelopment: isDevelopment(),
  },
  api: API_CONFIG,
  rateLimit: RATE_LIMIT_CONFIG,
  circuitBreaker: CIRCUIT_BREAKER_CONFIG,
  retry: RETRY_CONFIG,
  retention: RETENTION_CONFIG,
  encryption: ENCRYPTION_CONFIG,
  ingestionKey: INGESTION_KEY_CONFIG,
  shopify: SHOPIFY_API_CONFIG,
  platforms: PLATFORM_ENDPOINTS,
  webhook: WEBHOOK_CONFIG,
  scanner: SCANNER_CONFIG,
  monitoring: MONITORING_CONFIG,
  jobProcessing: JOB_PROCESSING_CONFIG,
  pixelValidation: PIXEL_VALIDATION_CONFIG,
  queryPerformance: QUERY_PERFORMANCE_CONFIG,
  consent: CONSENT_CONFIG,
  cron: CRON_CONFIG,
  features: FEATURE_FLAGS,
  getEnv,
  getRequiredEnv,
  getBoolEnv,
  getNumEnv,
} as const;

export function getApiTimeout(_service: "google" | "meta" | "tiktok" | "default"): number {
  return API_CONFIG.DEFAULT_TIMEOUT_MS;
}

export function getRateLimitForEndpoint(endpoint: string): { maxRequests: number; windowMs: number } {
  switch (endpoint) {
    case "pixel-events":
      return RATE_LIMIT_CONFIG.PIXEL_EVENTS;
    case "tracking":
      return RATE_LIMIT_CONFIG.TRACKING;
    default:
      return { maxRequests: 100, windowMs: 60 * 1000 };
  }
}

export function isFeatureEnabled(feature: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[feature];
}

export function getEnabledFeatures(): string[] {
  return Object.entries(FEATURE_FLAGS)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

export function getPixelEventIngestionUrl(): {
  url: string;
  isConfigured: boolean;
  isLocalhost: boolean;
  warning?: string;
  placeholderDetected?: boolean;
  pixelExtensionUrl?: string;
  allowlistStatus?: {
    inAllowlist: boolean;
    hostname: string;
    allowedHosts: string[];
    pixelExtensionHostname?: string;
  };
} {
  const shopifyAppUrl = process.env.SHOPIFY_APP_URL;
  if (!shopifyAppUrl) {
    return {
      url: "",
      isConfigured: false,
      isLocalhost: false,
      warning:
        "SHOPIFY_APP_URL is not configured. If you are running on your own server, make sure to set SHOPIFY_APP_URL in environment variables.",
    };
  }
  const placeholderDetected =
    shopifyAppUrl.includes("__BACKEND_URL_PLACEHOLDER__") || shopifyAppUrl.includes("PLACEHOLDER");
  if (placeholderDetected) {
    return {
      url: shopifyAppUrl,
      isConfigured: false,
      isLocalhost: false,
      warning:
        "Detected placeholder __BACKEND_URL_PLACEHOLDER__, URL was not replaced at build time. This is a critical configuration error that must be fixed before deployment. Run 'pnpm ext:inject' in your CI/CD pipeline or ensure SHOPIFY_APP_URL is correctly injected. If the placeholder is not replaced, the pixel extension cannot send events to the backend, causing event loss. This is a common cause of event loss and must be fixed before production deployment.",
      placeholderDetected: true,
      pixelExtensionUrl: undefined,
    };
  }
  try {
    const parsed = new URL(shopifyAppUrl);
    const hostname = parsed.hostname;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const allowedHosts: string[] = [];
    if (hostname) {
      allowedHosts.push(hostname);
    }
    const inAllowlist = !isLocalhost;
    return {
      url: shopifyAppUrl,
      isConfigured: true,
      isLocalhost,
      warning: isLocalhost
        ? "Currently configured with a local development URL. Pixel events will not be sent to the production environment."
        : undefined,
      pixelExtensionUrl: shopifyAppUrl,
      allowlistStatus: {
        inAllowlist,
        hostname,
        allowedHosts,
        pixelExtensionHostname: hostname,
      },
    };
  } catch {
    return {
      url: "",
      isConfigured: false,
      isLocalhost: false,
      warning: `SHOPIFY_APP_URL has an invalid format (${shopifyAppUrl}).`,
    };
  }
}

export function getPixelEventEndpoint(): string {
  const { url } = getPixelEventIngestionUrl();
  return `${url}/ingest`;
}

export function getConfigSummary(): Record<string, unknown> {
  return {
    environment: CONFIG.env,
    api: {
      maxBodySize: CONFIG.api.MAX_BODY_SIZE,
      timestampWindow: CONFIG.api.TIMESTAMP_WINDOW_MS,
      defaultTimeout: CONFIG.api.DEFAULT_TIMEOUT_MS,
    },
    rateLimit: {
      pixelEvents: CONFIG.rateLimit.PIXEL_EVENTS,
      maxKeys: CONFIG.rateLimit.MAX_KEYS,
    },
    circuitBreaker: {
      threshold: CONFIG.circuitBreaker.DEFAULT_THRESHOLD,
      window: CONFIG.circuitBreaker.DEFAULT_WINDOW_MS,
      recovery: CONFIG.circuitBreaker.RECOVERY_TIME_MS,
    },
    retry: {
      maxAttempts: CONFIG.retry.MAX_ATTEMPTS,
      initialBackoff: CONFIG.retry.INITIAL_BACKOFF_MS,
      maxBackoff: CONFIG.retry.MAX_BACKOFF_MS,
    },
    retention: getRetentionConfigSummary(),
    features: getFeatureFlagsSummary(),
    shopifyApiVersion: CONFIG.shopify.VERSION,
  };
}

export const getPcdConfigSummary = getConfigSummary;

export function validateAllConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (API_CONFIG.DEFAULT_TIMEOUT_MS < 1000) {
    errors.push("API timeout too short (< 1s)");
  }
  if (API_CONFIG.DEFAULT_TIMEOUT_MS > 120000) {
    errors.push("API timeout too long (> 2min)");
  }
  if (RATE_LIMIT_CONFIG.PIXEL_EVENTS.maxRequests <= 0) {
    errors.push("Pixel events rate limit must be positive");
  }
  if (RETENTION_CONFIG.MIN_DAYS > RETENTION_CONFIG.MAX_DAYS) {
    errors.push("Retention MIN_DAYS cannot exceed MAX_DAYS");
  }
  if (
    RETENTION_CONFIG.DEFAULT_DAYS < RETENTION_CONFIG.MIN_DAYS ||
    RETENTION_CONFIG.DEFAULT_DAYS > RETENTION_CONFIG.MAX_DAYS
  ) {
    errors.push("Retention DEFAULT_DAYS must be within MIN_DAYS and MAX_DAYS");
  }
  if (ENCRYPTION_CONFIG.IV_LENGTH !== 16) {
    errors.push("IV length must be 16 for AES-256-GCM");
  }
  const envResult = validateConfig();
  errors.push(...envResult.errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}
