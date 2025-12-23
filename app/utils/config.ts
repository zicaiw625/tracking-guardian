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
