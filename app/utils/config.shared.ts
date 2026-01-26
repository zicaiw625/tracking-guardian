import { SecureShopDomainSchema } from "./security";

export const API_CONFIG = {
  MAX_BODY_SIZE: 64 * 1024,
  TIMESTAMP_WINDOW_MS: 10 * 60 * 1000,
  DEFAULT_TIMEOUT_MS: 30 * 1000,
  JWT_EXPIRY_BUFFER_MS: 5 * 60 * 1000,
} as const;

export const RATE_LIMIT_CONFIG = {
  PIXEL_EVENTS_PREBODY: {
    maxRequests: 200,
    windowMs: 60 * 1000,
  },
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
  VERSION: "2026-01",
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
  MAX_RESPONSE_SIZE: 256 * 1024,
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
