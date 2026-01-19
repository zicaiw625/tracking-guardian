import { SecureShopDomainSchema } from "./security";

function logWarn(message: string) {
  console.warn(message);
}

function logInfo(message: string) {
  console.info(message);
}

function logError(message: string) {
  console.error(message);
}

interface EnvConfig {
    DATABASE_URL: string;
    SHOPIFY_API_KEY?: string;
    SHOPIFY_API_SECRET?: string;
    SHOPIFY_APP_URL?: string;
    PUBLIC_APP_URL?: string;
    ENCRYPTION_SECRET?: string;
    CRON_SECRET?: string;
    NODE_ENV: "development" | "production" | "test";
    ENCRYPTION_SALT?: string;
    RESEND_API_KEY?: string;
    EMAIL_SENDER?: string;
    REDIS_URL?: string;
    RATE_LIMIT_MAX_KEYS?: string;
}

export const API_CONFIG = {
    MAX_BODY_SIZE: 20 * 1024,
    TIMESTAMP_WINDOW_MS: 10 * 60 * 1000,
    DEFAULT_TIMEOUT_MS: 30 * 1000,
    JWT_EXPIRY_BUFFER_MS: 5 * 60 * 1000,
} as const;

export const RATE_LIMIT_CONFIG = {
    PIXEL_EVENTS: {
        maxRequests: 50,
        windowMs: 60 * 1000,
    },
    SURVEY: {
        maxRequests: 10,
        windowMs: 60 * 1000,
    },
    TRACKING: {
        maxRequests: 30,
        windowMs: 60 * 1000,
    },
    WEBHOOKS: {
        maxRequests: 100,
        windowMs: 60 * 1000,
    },
    MAX_KEYS: 10000,
    CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
} as const;

export const CIRCUIT_BREAKER_CONFIG = {
    DEFAULT_THRESHOLD: 10000,
    DEFAULT_WINDOW_MS: 60 * 1000,
    RECOVERY_TIME_MS: 30 * 1000,
} as const;

export const RETRY_CONFIG = {
    MAX_ATTEMPTS: 5,
    INITIAL_BACKOFF_MS: 1000,
    MAX_BACKOFF_MS: 5 * 60 * 1000,
    BACKOFF_MULTIPLIER: 2,
    JITTER_FACTOR: 0.1,
} as const;

function getRetentionDays(envKey: string, defaultValue: number, minValue?: number): number {
    const envValue = typeof process !== 'undefined' ? process.env[envKey] : undefined;
    if (!envValue) return defaultValue;
    const parsed = parseInt(envValue, 10);
    if (isNaN(parsed)) return defaultValue;
    if (minValue !== undefined && parsed < minValue) {
        logWarn(`[P2-03] ${envKey}=${parsed} is below minimum ${minValue}, using minimum`);
        return minValue;
    }
    return parsed;
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

function normalizeRetentionConfig(config: RetentionConfig): RetentionConfig {
    let minDays = config.MIN_DAYS;
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

export const INGESTION_KEY_CONFIG = {
    KEY_LENGTH_BYTES: 32,
    GRACE_PERIOD_MINUTES: 30,
    EXTENDED_GRACE_HOURS: 72,
} as const;

export const ENCRYPTION_CONFIG = {
    ALGORITHM: "aes-256-gcm",
    IV_LENGTH: 16,
    AUTH_TAG_LENGTH: 16,
    SCRYPT_PARAMS: {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
    },
    MIN_SECRET_LENGTH: 32,
} as const;

export const SHOPIFY_API_CONFIG = {
    VERSION: "2025-07",
    getGraphQLEndpoint: (shopDomain: string): string => {
        const validationResult = SecureShopDomainSchema.safeParse(shopDomain);
        if (!validationResult.success) {
            throw new Error(`Invalid shop domain format: ${shopDomain}`);
        }
        return `https://${validationResult.data}/admin/api/${SHOPIFY_API_CONFIG.VERSION}/graphql.json`;
    },
    getAdminUrl: (shopDomain: string, path: string = ""): string => {
        const validationResult = SecureShopDomainSchema.safeParse(shopDomain);
        if (!validationResult.success) {
            throw new Error(`Invalid shop domain format: ${shopDomain}`);
        }
        const validatedDomain = validationResult.data;
        const storeHandle = validatedDomain.replace(".myshopify.com", "");
        return `https://${storeHandle}.myshopify.com/admin${path}`;
    },
} as const;

export const PLATFORM_ENDPOINTS = {
    GA4_MEASUREMENT_PROTOCOL: (measurementId: string, apiSecret: string): string =>
        `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    META_GRAPH_API: (pixelId: string, version: string = "v21.0"): string =>
        `https://graph.facebook.com/${version}/${pixelId}/events`,
    TELEGRAM_BOT: (botToken: string): string =>
        `https://api.telegram.org/bot${botToken}/sendMessage`,
} as const;

export const CAPI_CONFIG = {
    META: {
        apiVersion: "v21.0",
        baseUrl: "https://graph.facebook.com",
        timeout: 30000,
    },
    GOOGLE: {
        baseUrl: "https://www.google-analytics.com",
        timeout: 30000,
    },
    TIKTOK: {
        baseUrl: "https://business-api.tiktok.com",
        trackEndpoint: "https://business-api.tiktok.com/open_api/v1.3/event/track/",
        version: "v1.3",
        timeout: 30000,
    },
} as const;

export const WEBHOOK_CONFIG = {
    PROCESSING_TIMEOUT_MS: 25 * 1000,
    BATCH_SIZE: 50,
    BATCH_DELAY_MS: 100,
} as const;

export const SCANNER_CONFIG = {
    SCRIPT_TAGS_PAGE_SIZE: 100,
    MAX_SCRIPT_TAGS: 1000,
    WEB_PIXELS_PAGE_SIZE: 50,
    MAX_WEB_PIXELS: 200,
    MAX_CONTENT_LENGTH: 100 * 1024,
} as const;

export const SCRIPT_ANALYSIS_CONFIG = {
    MAX_CONTENT_LENGTH: 500000,
    CHUNK_SIZE: 50000,
} as const;

export const MONITORING_CONFIG = {
    AGGREGATION_INTERVAL_MS: 60 * 1000,
    MAX_METRICS_SIZE: 10000,
    HEALTH_CHECK_TIMEOUT_MS: 5000,
    HIGH_LATENCY_THRESHOLD_MS: 1000,
    HIGH_HEAP_USAGE_PERCENT: 80,
} as const;

export const JOB_PROCESSING_CONFIG = {
    BASE_DELAY_MS: 60 * 1000,
    MAX_DELAY_MS: 2 * 60 * 60 * 1000,
    BACKOFF_MULTIPLIER: 5,
    MAX_ATTEMPTS: 5,
    BATCH_SIZE: 50,
    CLAIM_TIMEOUT_MS: 10 * 1000,
} as const;

export const PIXEL_VALIDATION_CONFIG = {
    CHECKOUT_TOKEN_MAX_LENGTH: 128,
    MAX_FUTURE_TIMESTAMP_MS: 24 * 60 * 60 * 1000,
    MAX_ORDER_ID_LENGTH: 64,
    MAX_ORDER_NUMBER_LENGTH: 32,
} as const;

export const QUERY_PERFORMANCE_CONFIG = {
    SLOW_QUERY_THRESHOLD_MS: 100,
    MAX_SLOW_QUERY_LOGS: 100,
    DEFAULT_CACHE_TTL_MS: 60 * 1000,
    STALE_THRESHOLD_MS: 10 * 1000,
} as const;

export const CONSENT_CONFIG = {
    CONSENT_TIMEOUT_HOURS: 24,
    MAX_RECEIPT_AGE_MS: 60 * 60 * 1000,
    MAX_TIME_SKEW_MS: 15 * 60 * 1000,
    TRACKING_WINDOW_MS: 60 * 60 * 1000,
} as const;

export const CRON_CONFIG = {
    REPLAY_PROTECTION_WINDOW_MS: 5 * 60 * 1000,
    MAX_BATCHES_PER_RUN: 10,
    LOCK_TIMEOUT_MS: 10 * 60 * 1000,
    STALE_LOCK_THRESHOLD_MS: 15 * 60 * 1000,
} as const;

const REQUIRED_IN_PRODUCTION = [
    "DATABASE_URL",
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "ENCRYPTION_SECRET",
    "ENCRYPTION_SALT",
    "CRON_SECRET",
] as const;

const PIXEL_INGESTION_ENABLED_CHECK = {
    key: "PIXEL_ALLOW_NULL_ORIGIN",
    reason: "When unset in production: unsigned null/missing Origin requests are rejected; signed null/missing Origin requests are allowed. Set PIXEL_ALLOW_NULL_ORIGIN=true to explicitly allow, or false to reject; explicit setting reduces ambiguity and alert noise.",
} as const;
const RECOMMENDED = [
    { key: "RESEND_API_KEY", reason: "for email notifications" },
    { key: "REDIS_URL", reason: "for shared rate limiting in multi-instance deployments" },
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
    if (isProduction && process.env.TRUST_PROXY !== "true") {
        errors.push("TRUST_PROXY must be true in production (required for correct IP rate limiting to prevent self-DoS)");
    }
    if (isProduction && process.env.ALLOW_UNSIGNED_PIXEL_EVENTS === "true") {
        errors.push("ALLOW_UNSIGNED_PIXEL_EVENTS cannot be true in production");
    }
    if (isProduction) {
        const pixelAllowNullOrigin = process.env.PIXEL_ALLOW_NULL_ORIGIN;
        if (pixelAllowNullOrigin === undefined || pixelAllowNullOrigin === "") {
            warnings.push(`PIXEL_ALLOW_NULL_ORIGIN not set in production. ${PIXEL_INGESTION_ENABLED_CHECK.reason}`);
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
        }
        catch {
            errors.push("SHOPIFY_APP_URL must be a valid URL");
        }
    }
    if (process.env.PUBLIC_APP_URL) {
        try {
            const parsed = new URL(process.env.PUBLIC_APP_URL);
            if (isProduction && parsed.protocol !== "https:") {
                errors.push("PUBLIC_APP_URL must use https in production");
            }
        }
        catch {
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

export const FEATURE_FLAGS = {
    FUNNEL_EVENTS: getBoolEnv("FEATURE_FUNNEL_EVENTS", false),
    DEBUG_LOGGING: getBoolEnv("FEATURE_DEBUG_LOGGING", false),
    EXTENDED_PAYLOAD: getBoolEnv("FEATURE_EXTENDED_PAYLOAD", false),
    TRACKING_API: getBoolEnv("FEATURE_TRACKING_API", false),
    CHECKOUT_BLOCKS: getBoolEnv("FEATURE_CHECKOUT_BLOCKS", false),
    REORDER_ENABLED: getBoolEnv("FEATURE_REORDER_ENABLED", false) && PCD_CONFIG.APPROVED,
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
        reorderEnabled: {
            enabled: FEATURE_FLAGS.REORDER_ENABLED,
            source: process.env.FEATURE_REORDER_ENABLED ? "env" : "default",
        },
    };
}

export function logConfigStatus(): void {
    const result = validateConfig();
    logInfo("\n=== Configuration Status ===");
    logInfo(`Environment: ${typeof process !== 'undefined' ? (process.env.NODE_ENV || "development") : "unknown"}`);
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
    capi: CAPI_CONFIG,
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
    const fallbackUrl = "https://app.tracking-guardian.com"
    if (!shopifyAppUrl) {
        return {
            url: fallbackUrl,
            isConfigured: false,
            isLocalhost: false,
            warning: "SHOPIFY_APP_URL 未配置，使用默认的生产环境 URL。如果您运行在自己的服务器上，请确保在环境变量中设置 SHOPIFY_APP_URL。",
        };
    }
    const placeholderDetected = shopifyAppUrl.includes("__BACKEND_URL_PLACEHOLDER__") || shopifyAppUrl.includes("PLACEHOLDER");
    if (placeholderDetected) {
        return {
            url: shopifyAppUrl,
            isConfigured: false,
            isLocalhost: false,
            warning: "检测到占位符 __BACKEND_URL_PLACEHOLDER__，URL 未在构建时替换。这是严重的配置错误，必须在上线前修复。请在 CI/CD 流程中运行 'pnpm ext:inject' 或确保 SHOPIFY_APP_URL 已正确注入。如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是导致事件丢失的常见原因，必须在生产环境部署前修复。",
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
                ? "当前配置的是本地开发 URL，像素事件将不会发送到生产环境。"
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
            url: fallbackUrl,
            isConfigured: false,
            isLocalhost: false,
            warning: `SHOPIFY_APP_URL 格式无效 (${shopifyAppUrl})，使用默认 URL。`,
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
    if (RETENTION_CONFIG.DEFAULT_DAYS < RETENTION_CONFIG.MIN_DAYS || RETENTION_CONFIG.DEFAULT_DAYS > RETENTION_CONFIG.MAX_DAYS) {
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
