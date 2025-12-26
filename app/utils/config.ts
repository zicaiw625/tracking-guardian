interface EnvConfig {
    DATABASE_URL: string;
    SHOPIFY_API_KEY?: string;
    SHOPIFY_API_SECRET?: string;
    SHOPIFY_APP_URL?: string;
    ENCRYPTION_SECRET?: string;
    CRON_SECRET?: string;
    NODE_ENV: "development" | "production" | "test";
    ENCRYPTION_SALT?: string;
    RESEND_API_KEY?: string;
    EMAIL_SENDER?: string;
    REDIS_URL?: string;
    RATE_LIMIT_MAX_KEYS?: string;
}

// ============================================================================
// Application Constants
// ============================================================================

/**
 * API and request handling configuration
 */
export const API_CONFIG = {
    /** Maximum request body size for pixel events (32KB) */
    MAX_BODY_SIZE: 32 * 1024,
    
    /** Timestamp validation window (10 minutes in milliseconds) */
    TIMESTAMP_WINDOW_MS: 10 * 60 * 1000,
    
    /** Default timeout for external API calls (30 seconds) */
    DEFAULT_TIMEOUT_MS: 30 * 1000,
    
    /** JWT token expiration buffer (5 minutes) */
    JWT_EXPIRY_BUFFER_MS: 5 * 60 * 1000,
} as const;

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONFIG = {
    /** Default: 50 requests per minute for pixel events */
    PIXEL_EVENTS: {
        maxRequests: 50,
        windowMs: 60 * 1000,
    },
    
    /** Survey endpoint: 10 requests per minute */
    SURVEY: {
        maxRequests: 10,
        windowMs: 60 * 1000,
    },
    
    /** Tracking endpoint: 30 requests per minute */
    TRACKING: {
        maxRequests: 30,
        windowMs: 60 * 1000,
    },
    
    /** Webhook endpoint: 100 requests per minute */
    WEBHOOKS: {
        maxRequests: 100,
        windowMs: 60 * 1000,
    },
    
    /** Maximum keys to track for rate limiting */
    MAX_KEYS: 10000,
    
    /** Cleanup interval for rate limiter (5 minutes) */
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
} as const;

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_BREAKER_CONFIG = {
    /** Default threshold before tripping circuit */
    DEFAULT_THRESHOLD: 10000,
    
    /** Default window for circuit breaker (1 minute) */
    DEFAULT_WINDOW_MS: 60 * 1000,
    
    /** Recovery time after circuit trips (30 seconds) */
    RECOVERY_TIME_MS: 30 * 1000,
} as const;

/**
 * Retry and backoff configuration
 */
export const RETRY_CONFIG = {
    /** Maximum retry attempts for CAPI calls */
    MAX_ATTEMPTS: 5,
    
    /** Initial backoff delay (1 second) */
    INITIAL_BACKOFF_MS: 1000,
    
    /** Maximum backoff delay (5 minutes) */
    MAX_BACKOFF_MS: 5 * 60 * 1000,
    
    /** Backoff multiplier for exponential backoff */
    BACKOFF_MULTIPLIER: 2,
    
    /** Jitter factor (0-1) to add randomness to backoff */
    JITTER_FACTOR: 0.1,
} as const;

/**
 * P2-03: Data retention configuration with environment variable overrides.
 * 
 * All retention periods are auditable and can be configured via environment variables.
 * Changes to retention settings should be logged in audit trail.
 * 
 * Environment variables:
 * - RETENTION_MIN_DAYS: Minimum retention (default: 30)
 * - RETENTION_MAX_DAYS: Maximum retention (default: 365)
 * - RETENTION_DEFAULT_DAYS: Default for new shops (default: 90)
 * - RETENTION_AUDIT_LOG_DAYS: Audit log retention (default: 365, minimum: 180)
 * - RETENTION_WEBHOOK_LOG_DAYS: Webhook log retention (default: 7)
 * - RETENTION_NONCE_EXPIRY_HOURS: Nonce expiry (default: 1 hour)
 * - RETENTION_RECEIPT_DAYS: PixelEventReceipt retention (default: 90)
 * 
 * GDPR Note: These settings affect data subject access and deletion requests.
 * Shorter retention = less data to process/export, but may impact debugging.
 */
function getRetentionDays(envKey: string, defaultValue: number, minValue?: number): number {
    const envValue = process.env[envKey];
    if (!envValue) return defaultValue;
    const parsed = parseInt(envValue, 10);
    if (isNaN(parsed)) return defaultValue;
    if (minValue !== undefined && parsed < minValue) {
        // eslint-disable-next-line no-console
        console.warn(`[P2-03] ${envKey}=${parsed} is below minimum ${minValue}, using minimum`);
        return minValue;
    }
    return parsed;
}

export const RETENTION_CONFIG = {
    /** Minimum retention period (30 days) - cannot be set lower */
    MIN_DAYS: getRetentionDays("RETENTION_MIN_DAYS", 30, 1),
    
    /** Maximum retention period (365 days) */
    MAX_DAYS: getRetentionDays("RETENTION_MAX_DAYS", 365),
    
    /** Default retention period (90 days) for new shops */
    DEFAULT_DAYS: getRetentionDays("RETENTION_DEFAULT_DAYS", 90),
    
    /** Audit log retention (min 180 days for compliance) */
    AUDIT_LOG_DAYS: getRetentionDays("RETENTION_AUDIT_LOG_DAYS", 365, 180),
    
    /** Nonce expiration (1 hour by default) */
    NONCE_EXPIRY_MS: getRetentionDays("RETENTION_NONCE_EXPIRY_HOURS", 1) * 60 * 60 * 1000,
    
    /** Webhook log retention (7 days) */
    WEBHOOK_LOG_DAYS: getRetentionDays("RETENTION_WEBHOOK_LOG_DAYS", 7),
    
    /** PixelEventReceipt retention (same as default by default) */
    RECEIPT_DAYS: getRetentionDays("RETENTION_RECEIPT_DAYS", 90),
} as const;

/**
 * P2-03: Get retention config summary for auditing/documentation.
 */
export function getRetentionConfigSummary(): Record<string, { value: number | string; unit: string; source: "default" | "env" }> {
    return {
        minDays: { 
            value: RETENTION_CONFIG.MIN_DAYS, 
            unit: "days",
            source: process.env.RETENTION_MIN_DAYS ? "env" : "default"
        },
        maxDays: { 
            value: RETENTION_CONFIG.MAX_DAYS, 
            unit: "days",
            source: process.env.RETENTION_MAX_DAYS ? "env" : "default"
        },
        defaultDays: { 
            value: RETENTION_CONFIG.DEFAULT_DAYS, 
            unit: "days",
            source: process.env.RETENTION_DEFAULT_DAYS ? "env" : "default"
        },
        auditLogDays: { 
            value: RETENTION_CONFIG.AUDIT_LOG_DAYS, 
            unit: "days",
            source: process.env.RETENTION_AUDIT_LOG_DAYS ? "env" : "default"
        },
        nonceExpiry: { 
            value: RETENTION_CONFIG.NONCE_EXPIRY_MS / (60 * 60 * 1000), 
            unit: "hours",
            source: process.env.RETENTION_NONCE_EXPIRY_HOURS ? "env" : "default"
        },
        webhookLogDays: { 
            value: RETENTION_CONFIG.WEBHOOK_LOG_DAYS, 
            unit: "days",
            source: process.env.RETENTION_WEBHOOK_LOG_DAYS ? "env" : "default"
        },
        receiptDays: { 
            value: RETENTION_CONFIG.RECEIPT_DAYS, 
            unit: "days",
            source: process.env.RETENTION_RECEIPT_DAYS ? "env" : "default"
        },
    };
}

/**
 * Ingestion key configuration
 */
export const INGESTION_KEY_CONFIG = {
    /** Key length in bytes (32 bytes = 256 bits) */
    KEY_LENGTH_BYTES: 32,
    
    /** Grace period for key rotation (30 minutes) */
    GRACE_PERIOD_MINUTES: 30,
    
    /** Extended grace period for banner display (72 hours) */
    EXTENDED_GRACE_HOURS: 72,
} as const;

/**
 * Encryption configuration
 */
export const ENCRYPTION_CONFIG = {
    /** Algorithm used for encryption */
    ALGORITHM: "aes-256-gcm",
    
    /** IV length in bytes */
    IV_LENGTH: 16,
    
    /** Auth tag length in bytes */
    AUTH_TAG_LENGTH: 16,
    
    /** Scrypt parameters for key derivation */
    SCRYPT_PARAMS: {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
    },
    
    /** Minimum recommended secret length */
    MIN_SECRET_LENGTH: 32,
} as const;

/**
 * Shopify API configuration
 */
export const SHOPIFY_API_CONFIG = {
    /** API version - should match shopify.app.toml webhooks.api_version */
    VERSION: "2025-07",
    
    /** Get GraphQL endpoint for a shop */
    getGraphQLEndpoint: (shopDomain: string): string =>
        `https://${shopDomain}/admin/api/2025-07/graphql.json`,
    
    /** Get Shopify Admin URL for a shop */
    getAdminUrl: (shopDomain: string, path: string = ""): string => {
        const storeHandle = shopDomain.replace(".myshopify.com", "");
        return `https://admin.shopify.com/store/${storeHandle}${path}`;
    },
} as const;

/**
 * Platform API endpoints
 */
export const PLATFORM_ENDPOINTS = {
    /** GA4 Measurement Protocol */
    GA4_MEASUREMENT_PROTOCOL: (measurementId: string, apiSecret: string): string =>
        `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    
    /** Meta Graph API events endpoint */
    META_GRAPH_API: (pixelId: string, version: string = "v21.0"): string =>
        `https://graph.facebook.com/${version}/${pixelId}/events`,
    
    /** Telegram Bot API */
    TELEGRAM_BOT: (botToken: string): string =>
        `https://api.telegram.org/bot${botToken}/sendMessage`,
} as const;

/**
 * CAPI platform-specific configuration
 */
export const CAPI_CONFIG = {
    /** Meta CAPI */
    META: {
        apiVersion: "v21.0",
        baseUrl: "https://graph.facebook.com",
        timeout: 30000,
    },
    
    /** Google GA4 Measurement Protocol */
    GOOGLE: {
        baseUrl: "https://www.google-analytics.com/mp/collect",
        timeout: 30000,
    },
    
    /** TikTok Events API */
    TIKTOK: {
        baseUrl: "https://business-api.tiktok.com/open_api/v1.3/event/track",
        timeout: 30000,
    },
} as const;

/**
 * Webhook processing configuration
 */
export const WEBHOOK_CONFIG = {
    /** Maximum time to process a webhook before timeout (25 seconds) */
    PROCESSING_TIMEOUT_MS: 25 * 1000,
    
    /** Batch size for processing queued jobs */
    BATCH_SIZE: 50,
    
    /** Delay between batch processing (100ms) */
    BATCH_DELAY_MS: 100,
} as const;

/**
 * Scanner configuration
 */
export const SCANNER_CONFIG = {
    /** Maximum script tags to fetch per page */
    SCRIPT_TAGS_PAGE_SIZE: 100,
    
    /** Maximum script tags to process */
    MAX_SCRIPT_TAGS: 1000,
    
    /** Maximum web pixels to fetch per page */
    WEB_PIXELS_PAGE_SIZE: 50,
    
    /** Maximum web pixels to process */
    MAX_WEB_PIXELS: 200,
    
    /** Maximum content length for analysis (100KB) */
    MAX_CONTENT_LENGTH: 100 * 1024,
} as const;

/**
 * Monitoring configuration
 */
export const MONITORING_CONFIG = {
    /** Metrics aggregation interval (1 minute) */
    AGGREGATION_INTERVAL_MS: 60 * 1000,
    
    /** Maximum metrics to keep in memory */
    MAX_METRICS_SIZE: 10000,
    
    /** Health check database timeout (5 seconds) */
    HEALTH_CHECK_TIMEOUT_MS: 5000,
    
    /** High latency warning threshold (1 second) */
    HIGH_LATENCY_THRESHOLD_MS: 1000,
    
    /** High heap usage warning threshold (80%) */
    HIGH_HEAP_USAGE_PERCENT: 80,
} as const;

/**
 * Job processing configuration
 * Used by conversion-job.server.ts, job-processor.server.ts, retry.server.ts
 */
export const JOB_PROCESSING_CONFIG = {
    /** Base delay for exponential backoff (1 minute) */
    BASE_DELAY_MS: 60 * 1000,

    /** Maximum delay for exponential backoff (2 hours) */
    MAX_DELAY_MS: 2 * 60 * 60 * 1000,

    /** Backoff multiplier */
    BACKOFF_MULTIPLIER: 5,

    /** Maximum retry attempts for conversion jobs */
    MAX_ATTEMPTS: 5,

    /** Batch size for processing jobs */
    BATCH_SIZE: 50,

    /** Transaction timeout for job claiming (10 seconds) */
    CLAIM_TIMEOUT_MS: 10 * 1000,
} as const;

/**
 * Pixel validation configuration
 * Used by pixel-events route, validation schemas
 */
export const PIXEL_VALIDATION_CONFIG = {
    /** Maximum length for checkout token */
    CHECKOUT_TOKEN_MAX_LENGTH: 128,

    /** Maximum future timestamp offset allowed (24 hours) */
    MAX_FUTURE_TIMESTAMP_MS: 24 * 60 * 60 * 1000,

    /** Maximum order ID length */
    MAX_ORDER_ID_LENGTH: 64,

    /** Maximum order number length */
    MAX_ORDER_NUMBER_LENGTH: 32,
} as const;

/**
 * Query performance configuration
 * Used by repositories and monitoring
 */
export const QUERY_PERFORMANCE_CONFIG = {
    /** Threshold for slow query logging (100ms) */
    SLOW_QUERY_THRESHOLD_MS: 100,

    /** Maximum slow query logs to keep in memory */
    MAX_SLOW_QUERY_LOGS: 100,

    /** Default cache TTL (1 minute) */
    DEFAULT_CACHE_TTL_MS: 60 * 1000,

    /** Stale cache threshold (10 seconds before expiry) */
    STALE_THRESHOLD_MS: 10 * 1000,
} as const;

/**
 * Consent and trust configuration
 * Used by consent-reconciler, receipt-trust
 */
export const CONSENT_CONFIG = {
    /** Maximum time to wait for consent (24 hours) */
    CONSENT_TIMEOUT_HOURS: 24,

    /** Maximum age for pixel receipts (1 hour) */
    MAX_RECEIPT_AGE_MS: 60 * 60 * 1000,

    /** Maximum time skew allowed (15 minutes) */
    MAX_TIME_SKEW_MS: 15 * 60 * 1000,

    /** Window for tracking consent origin (1 hour) */
    TRACKING_WINDOW_MS: 60 * 60 * 1000,
} as const;

/**
 * Cron job configuration
 */
export const CRON_CONFIG = {
    /** Replay protection window (5 minutes) */
    REPLAY_PROTECTION_WINDOW_MS: 5 * 60 * 1000,

    /** Maximum batches per cleanup run */
    MAX_BATCHES_PER_RUN: 10,

    /** Lock timeout (10 minutes) */
    LOCK_TIMEOUT_MS: 10 * 60 * 1000,

    /** Stale lock threshold (15 minutes) */
    STALE_LOCK_THRESHOLD_MS: 15 * 60 * 1000,
} as const;

const REQUIRED_IN_PRODUCTION = [
    "DATABASE_URL",
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "ENCRYPTION_SECRET",
    "CRON_SECRET",
] as const;
const RECOMMENDED = [
    { key: "ENCRYPTION_SALT", reason: "for consistent encryption across deployments" },
    { key: "RESEND_API_KEY", reason: "for email notifications" },
    { key: "REDIS_URL", reason: "for shared rate limiting in multi-instance deployments" },
] as const;

/**
 * P1-5: Cron secret rotation configuration.
 * 
 * For zero-downtime secret rotation:
 * 1. Set CRON_SECRET_PREVIOUS to current CRON_SECRET value
 * 2. Set CRON_SECRET to new secret value
 * 3. Deploy application
 * 4. Update cron service to use new secret
 * 5. Remove CRON_SECRET_PREVIOUS after all clients updated
 */
export const CRON_SECRET_CONFIG = {
    /** Primary cron secret */
    SECRET: process.env.CRON_SECRET || "",
    /** Previous secret for rotation (optional) */
    SECRET_PREVIOUS: process.env.CRON_SECRET_PREVIOUS || "",
    /** Minimum recommended secret length */
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
            }
            else {
                warnings.push(`${key} not set (required in production)`);
            }
        }
    }
    for (const { key, reason } of RECOMMENDED) {
        if (!process.env[key]) {
            warnings.push(`${key} not set - ${reason}`);
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
            new URL(process.env.SHOPIFY_APP_URL);
        }
        catch {
            errors.push("SHOPIFY_APP_URL must be a valid URL");
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
    if (!value)
        return defaultValue;
    return value.toLowerCase() === "true" || value === "1";
}
export function getNumEnv(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value)
        return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
}
export function isProduction(): boolean {
    return process.env.NODE_ENV === "production";
}
export function isDevelopment(): boolean {
    return process.env.NODE_ENV !== "production";
}

// ============================================================================
// P2-05: Feature Flags / Product Switches
// ============================================================================

// ============================================================================
// PCD (Protected Customer Data) Status Configuration
// ============================================================================

/**
 * PCD (Protected Customer Data) approval status.
 * 
 * This controls whether the app can claim to have PCD access and allow
 * merchants to enable PII Enhanced Matching features.
 * 
 * Environment variables:
 * - PCD_APPROVED: Set to "true" only after Shopify approves the app's PCD access
 * - PCD_STATUS_MESSAGE: Optional custom message to show in UI
 * 
 * IMPORTANT: Only set PCD_APPROVED=true after you have received confirmation
 * from Shopify that your app's PCD access request has been approved.
 * 
 * Usage:
 *   import { PCD_CONFIG } from "~/utils/config";
 *   if (PCD_CONFIG.APPROVED) { ... }
 */
export const PCD_CONFIG = {
    /**
     * Whether the app has been approved for PCD access by Shopify.
     * Default: false (not approved)
     * Set PCD_APPROVED=true in environment after approval.
     */
    APPROVED: getBoolEnv("PCD_APPROVED", false),
    
    /**
     * Custom status message to show in UI.
     * Default: empty (use standard messages based on APPROVED status)
     */
    STATUS_MESSAGE: getEnv("PCD_STATUS_MESSAGE", ""),
} as const;

/**
 * Get PCD config summary for auditing/documentation.
 */
export function getPcdConfigSummary(): {
    approved: boolean;
    hasCustomMessage: boolean;
    source: "default" | "env";
} {
    return {
        approved: PCD_CONFIG.APPROVED,
        hasCustomMessage: PCD_CONFIG.STATUS_MESSAGE.length > 0,
        source: process.env.PCD_APPROVED ? "env" : "default",
    };
}

/**
 * P2-05: Feature flags for product capabilities.
 * 
 * All flags default to OFF (disabled) for safety.
 * Enable via environment variables as needed.
 * Changes should be logged to audit trail when applicable.
 * 
 * Environment variables:
 * - FEATURE_FUNNEL_EVENTS: Enable funnel event collection (default: false)
 * - FEATURE_DEBUG_LOGGING: Enable verbose debug logging (default: false in prod)
 * - FEATURE_EXTENDED_PAYLOAD: Enable extended payload fields (default: false)
 * - FEATURE_TRACKING_API: Enable /api/tracking endpoint (default: false)
 * - FEATURE_PII_HASHING: Enable PII hashing for enhanced matching (default: false)
 * 
 * Usage:
 *   import { FEATURE_FLAGS } from "~/utils/config";
 *   if (FEATURE_FLAGS.FUNNEL_EVENTS) { ... }
 */
export const FEATURE_FLAGS = {
    /** 
     * Enable funnel events (checkout_started, page_viewed, etc.)
     * P0-02: Currently disabled - we only send checkout_completed
     */
    FUNNEL_EVENTS: getBoolEnv("FEATURE_FUNNEL_EVENTS", false),
    
    /**
     * Enable verbose debug logging
     * WARNING: May expose sensitive data in logs
     */
    DEBUG_LOGGING: getBoolEnv("FEATURE_DEBUG_LOGGING", false),
    
    /**
     * Enable extended payload fields in pixel events
     * E.g., line items, customer info, etc.
     */
    EXTENDED_PAYLOAD: getBoolEnv("FEATURE_EXTENDED_PAYLOAD", false),
    
    /**
     * Enable /api/tracking public endpoint
     * P0-06: Disabled by default for security
     */
    TRACKING_API: getBoolEnv("FEATURE_TRACKING_API", false),
    
    /**
     * Enable PII hashing for enhanced ad matching
     * Requires explicit merchant opt-in
     */
    PII_HASHING: getBoolEnv("FEATURE_PII_HASHING", false),
    
    /**
     * Enable experimental checkout blocks
     */
    CHECKOUT_BLOCKS: getBoolEnv("FEATURE_CHECKOUT_BLOCKS", false),
} as const;

/**
 * P2-05: Get feature flags summary for auditing/documentation.
 */
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
        piiHashing: {
            enabled: FEATURE_FLAGS.PII_HASHING,
            source: process.env.FEATURE_PII_HASHING ? "env" : "default",
        },
        checkoutBlocks: {
            enabled: FEATURE_FLAGS.CHECKOUT_BLOCKS,
            source: process.env.FEATURE_CHECKOUT_BLOCKS ? "env" : "default",
        },
    };
}
/**
 * Log configuration status at startup.
 * Using console intentionally for startup diagnostics.
 */
export function logConfigStatus(): void {
    const result = validateConfig();
    // eslint-disable-next-line no-console
    console.log("\n=== Configuration Status ===");
    // eslint-disable-next-line no-console
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    if (result.errors.length > 0) {
        // eslint-disable-next-line no-console
        console.error("\n❌ Configuration Errors:");
        for (const error of result.errors) {
            // eslint-disable-next-line no-console
            console.error(`   - ${error}`);
        }
    }
    if (result.warnings.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("\n⚠️ Configuration Warnings:");
        for (const warning of result.warnings) {
            // eslint-disable-next-line no-console
            console.warn(`   - ${warning}`);
        }
    }
    if (result.valid && result.warnings.length === 0) {
        // eslint-disable-next-line no-console
        console.log("\n✅ All configuration checks passed");
    }
    // eslint-disable-next-line no-console
    console.log("============================\n");
    if (!result.valid && isProduction()) {
        throw new Error("Invalid configuration - cannot start in production");
    }
}

// ============================================================================
// Centralized Configuration Registry
// ============================================================================

/**
 * All application configuration in one place.
 * Use this object to access configuration values throughout the app.
 */
export const CONFIG = {
    // Environment
    env: {
        nodeEnv: process.env.NODE_ENV || "development",
        isProduction: isProduction(),
        isDevelopment: isDevelopment(),
    },
    
    // API Settings
    api: API_CONFIG,
    
    // Rate Limiting
    rateLimit: RATE_LIMIT_CONFIG,
    
    // Circuit Breaker
    circuitBreaker: CIRCUIT_BREAKER_CONFIG,
    
    // Retry Settings
    retry: RETRY_CONFIG,
    
    // Data Retention
    retention: RETENTION_CONFIG,
    
    // Encryption
    encryption: ENCRYPTION_CONFIG,
    
    // Ingestion Key
    ingestionKey: INGESTION_KEY_CONFIG,
    
    // Shopify API
    shopify: SHOPIFY_API_CONFIG,
    
    // Platform Endpoints
    platforms: PLATFORM_ENDPOINTS,
    
    // CAPI Settings
    capi: CAPI_CONFIG,
    
    // Webhook Processing
    webhook: WEBHOOK_CONFIG,
    
    // Scanner
    scanner: SCANNER_CONFIG,
    
    // Monitoring
    monitoring: MONITORING_CONFIG,

    // Job Processing
    jobProcessing: JOB_PROCESSING_CONFIG,

    // Pixel Validation
    pixelValidation: PIXEL_VALIDATION_CONFIG,

    // Query Performance
    queryPerformance: QUERY_PERFORMANCE_CONFIG,

    // Consent & Trust
    consent: CONSENT_CONFIG,

    // Cron Jobs
    cron: CRON_CONFIG,
    
    // Feature Flags
    features: FEATURE_FLAGS,
    
    // PCD Status
    pcd: PCD_CONFIG,
    
    // Helper functions
    getEnv,
    getRequiredEnv,
    getBoolEnv,
    getNumEnv,
} as const;

// ============================================================================
// Type-Safe Configuration Access
// ============================================================================

/**
 * Get API timeout for a specific service
 */
export function getApiTimeout(service: "google" | "meta" | "tiktok" | "default"): number {
    switch (service) {
        case "google":
            return CAPI_CONFIG.GOOGLE.timeout;
        case "meta":
            return CAPI_CONFIG.META.timeout;
        case "tiktok":
            return CAPI_CONFIG.TIKTOK.timeout;
        default:
            return API_CONFIG.DEFAULT_TIMEOUT_MS;
    }
}

/**
 * Get rate limit config for an endpoint
 */
export function getRateLimitForEndpoint(endpoint: string): { maxRequests: number; windowMs: number } {
    switch (endpoint) {
        case "pixel-events":
            return RATE_LIMIT_CONFIG.PIXEL_EVENTS;
        case "survey":
            return RATE_LIMIT_CONFIG.SURVEY;
        case "tracking":
            return RATE_LIMIT_CONFIG.TRACKING;
        default:
            return { maxRequests: 100, windowMs: 60 * 1000 };
    }
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof FEATURE_FLAGS): boolean {
    return FEATURE_FLAGS[feature];
}

/**
 * Get all enabled features
 */
export function getEnabledFeatures(): string[] {
    return Object.entries(FEATURE_FLAGS)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
}

// ============================================================================
// P2: Pixel Event Endpoint Configuration
// ============================================================================

/**
 * P2: Get the current pixel event ingestion URL.
 * 
 * This is used for:
 * 1. Displaying to merchants in the admin UI for verification
 * 2. Ensuring pixels are sending events to the correct endpoint
 * 
 * Returns:
 * - The SHOPIFY_APP_URL if set
 * - A default fallback URL otherwise
 */
export function getPixelEventIngestionUrl(): {
    url: string;
    isConfigured: boolean;
    isLocalhost: boolean;
    warning?: string;
} {
    const shopifyAppUrl = process.env.SHOPIFY_APP_URL;
    const fallbackUrl = "https://tracking-guardian.onrender.com";
    
    if (!shopifyAppUrl) {
        return {
            url: fallbackUrl,
            isConfigured: false,
            isLocalhost: false,
            warning: "SHOPIFY_APP_URL 未配置，使用默认的生产环境 URL。如果您运行在自己的服务器上，请确保在环境变量中设置 SHOPIFY_APP_URL。",
        };
    }
    
    try {
        const parsed = new URL(shopifyAppUrl);
        const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
        
        return {
            url: shopifyAppUrl,
            isConfigured: true,
            isLocalhost,
            warning: isLocalhost 
                ? "当前配置的是本地开发 URL，像素事件将不会发送到生产环境。" 
                : undefined,
        };
    } catch {
        return {
            url: fallbackUrl,
            isConfigured: false,
            isLocalhost: false,
            warning: `SHOPIFY_APP_URL 格式无效 (${shopifyAppUrl})，使用默认 URL。`,
        };
    }
}

/**
 * P2: Get the full pixel event endpoint for a shop.
 */
export function getPixelEventEndpoint(): string {
    const { url } = getPixelEventIngestionUrl();
    return `${url}/api/pixel-events`;
}

// ============================================================================
// Configuration Summary
// ============================================================================

/**
 * Get a complete configuration summary for debugging/auditing.
 */
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
            survey: CONFIG.rateLimit.SURVEY,
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
        pcd: getPcdConfigSummary(),
        shopifyApiVersion: CONFIG.shopify.VERSION,
    };
}

/**
 * Validate all configuration at startup.
 * Returns errors that should prevent app startup.
 */
export function validateAllConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check API timeouts are reasonable
    if (API_CONFIG.DEFAULT_TIMEOUT_MS < 1000) {
        errors.push("API timeout too short (< 1s)");
    }
    if (API_CONFIG.DEFAULT_TIMEOUT_MS > 120000) {
        errors.push("API timeout too long (> 2min)");
    }
    
    // Check rate limits are positive
    if (RATE_LIMIT_CONFIG.PIXEL_EVENTS.maxRequests <= 0) {
        errors.push("Pixel events rate limit must be positive");
    }
    
    // Check retention is within bounds
    if (RETENTION_CONFIG.MIN_DAYS > RETENTION_CONFIG.MAX_DAYS) {
        errors.push("Retention MIN_DAYS cannot exceed MAX_DAYS");
    }
    
    // Check encryption config
    if (ENCRYPTION_CONFIG.IV_LENGTH !== 16) {
        errors.push("IV length must be 16 for AES-256-GCM");
    }
    
    // Validate environment config
    const envResult = validateConfig();
    errors.push(...envResult.errors);
    
    return {
        valid: errors.length === 0,
        errors,
    };
}
