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
 * Data retention configuration
 */
export const RETENTION_CONFIG = {
    /** Minimum retention period (30 days) */
    MIN_DAYS: 30,
    
    /** Maximum retention period (365 days) */
    MAX_DAYS: 365,
    
    /** Default retention period (90 days) */
    DEFAULT_DAYS: 90,
    
    /** Audit log retention (always 365 days, non-configurable) */
    AUDIT_LOG_DAYS: 365,
    
    /** Nonce expiration (1 hour) */
    NONCE_EXPIRY_MS: 60 * 60 * 1000,
    
    /** Webhook log retention (7 days) */
    WEBHOOK_LOG_DAYS: 7,
} as const;

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
