/**
 * Centralized Enum Definitions
 * 
 * This module contains all status enums and constant values used throughout the application.
 * Using const objects with 'as const' for type safety while maintaining runtime values.
 */

// =============================================================================
// Job Status Enums
// =============================================================================

/**
 * ConversionJob processing status.
 */
export const JobStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  LIMIT_EXCEEDED: 'limit_exceeded',
  DEAD_LETTER: 'dead_letter',
} as const;

export type JobStatusType = typeof JobStatus[keyof typeof JobStatus];

/**
 * ConversionLog sending status.
 */
export const ConversionLogStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  RETRYING: 'retrying',
  DEAD_LETTER: 'dead_letter',
} as const;

export type ConversionLogStatusType = typeof ConversionLogStatus[keyof typeof ConversionLogStatus];

/**
 * Webhook processing status.
 */
export const WebhookStatus = {
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const;

export type WebhookStatusType = typeof WebhookStatus[keyof typeof WebhookStatus];

/**
 * GDPR job status.
 */
export const GDPRJobStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type GDPRJobStatusType = typeof GDPRJobStatus[keyof typeof GDPRJobStatus];

/**
 * Scan report status.
 */
export const ScanStatus = {
  PENDING: 'pending',
  SCANNING: 'scanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ScanStatusType = typeof ScanStatus[keyof typeof ScanStatus];

/**
 * Migration status for pixel configurations.
 */
export const MigrationStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

export type MigrationStatusType = typeof MigrationStatus[keyof typeof MigrationStatus];

// =============================================================================
// Trust & Consent Enums
// =============================================================================

/**
 * Trust level for pixel event receipts.
 */
export const TrustLevel = {
  TRUSTED: 'trusted',
  PARTIAL: 'partial',
  UNTRUSTED: 'untrusted',
  UNKNOWN: 'unknown',
} as const;

export type TrustLevelType = typeof TrustLevel[keyof typeof TrustLevel];

/**
 * Signature status for pixel events.
 */
export const SignatureStatus = {
  SIGNED: 'signed',
  UNSIGNED: 'unsigned',
  INVALID: 'invalid',
  KEY_MATCHED: 'key_matched',
} as const;

export type SignatureStatusType = typeof SignatureStatus[keyof typeof SignatureStatus];

/**
 * Consent strategy for shops.
 */
export const ConsentStrategy = {
  STRICT: 'strict',
  BALANCED: 'balanced',
  WEAK: 'weak',
} as const;

export type ConsentStrategyType = typeof ConsentStrategy[keyof typeof ConsentStrategy];

// =============================================================================
// Platform Enums
// =============================================================================

/**
 * Supported advertising platforms.
 */
export const Platform = {
  GOOGLE: 'google',
  META: 'meta',
  TIKTOK: 'tiktok',
} as const;

export type PlatformType = typeof Platform[keyof typeof Platform];

/**
 * Platform display names for UI.
 */
export const PLATFORM_DISPLAY_NAMES: Record<PlatformType, string> = {
  [Platform.GOOGLE]: 'Google Ads / GA4',
  [Platform.META]: 'Meta (Facebook)',
  [Platform.TIKTOK]: 'TikTok',
};

/**
 * Event types for conversion tracking.
 */
export const EventType = {
  PURCHASE: 'purchase',
  CHECKOUT_COMPLETED: 'checkout_completed',
  ADD_TO_CART: 'add_to_cart',
  PAGE_VIEW: 'page_viewed',
} as const;

export type EventTypeValue = typeof EventType[keyof typeof EventType];

// =============================================================================
// Shop & Billing Enums
// =============================================================================

/**
 * Shop tier based on Shopify plan.
 */
export const ShopTier = {
  PLUS: 'plus',
  NON_PLUS: 'non_plus',
  UNKNOWN: 'unknown',
} as const;

export type ShopTierType = typeof ShopTier[keyof typeof ShopTier];

/**
 * Billing plan IDs.
 */
export const PlanId = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;

export type PlanIdType = typeof PlanId[keyof typeof PlanId];

// =============================================================================
// Alert & Notification Enums
// =============================================================================

/**
 * Alert notification channels.
 */
export const AlertChannel = {
  EMAIL: 'email',
  SLACK: 'slack',
  TELEGRAM: 'telegram',
} as const;

export type AlertChannelType = typeof AlertChannel[keyof typeof AlertChannel];

/**
 * Alert frequency options.
 */
export const AlertFrequency = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  INSTANT: 'instant',
} as const;

export type AlertFrequencyType = typeof AlertFrequency[keyof typeof AlertFrequency];

// =============================================================================
// Audit Log Enums
// =============================================================================

/**
 * Actor types for audit logging.
 */
export const ActorType = {
  USER: 'user',
  WEBHOOK: 'webhook',
  CRON: 'cron',
  API: 'api',
  SYSTEM: 'system',
} as const;

export type ActorTypeValue = typeof ActorType[keyof typeof ActorType];

/**
 * Common audit actions.
 */
export const AuditAction = {
  TOKEN_UPDATED: 'token_updated',
  PIXEL_CONFIG_CHANGED: 'pixel_config_changed',
  THRESHOLD_CHANGED: 'threshold_changed',
  ALERT_CONFIG_UPDATED: 'alert_config_updated',
  PRIVACY_SETTINGS_UPDATED: 'privacy_settings_updated',
  INGESTION_SECRET_ROTATED: 'ingestion_secret_rotated',
  SHOP_INSTALLED: 'shop_installed',
  SHOP_UNINSTALLED: 'shop_uninstalled',
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction];

// =============================================================================
// Platform Result Status
// =============================================================================

/**
 * Platform sending result status.
 */
export const PlatformResultStatus = {
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  PENDING: 'pending',
} as const;

export type PlatformResultStatusType = typeof PlatformResultStatus[keyof typeof PlatformResultStatus];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a value is a valid JobStatus.
 */
export function isValidJobStatus(value: string): value is JobStatusType {
  return Object.values(JobStatus).includes(value as JobStatusType);
}

/**
 * Check if a value is a valid Platform.
 */
export function isValidPlatform(value: string): value is PlatformType {
  return Object.values(Platform).includes(value as PlatformType);
}

/**
 * Check if a value is a valid TrustLevel.
 */
export function isValidTrustLevel(value: string): value is TrustLevelType {
  return Object.values(TrustLevel).includes(value as TrustLevelType);
}

/**
 * Check if a value is a valid ConsentStrategy.
 */
export function isValidConsentStrategy(value: string): value is ConsentStrategyType {
  return Object.values(ConsentStrategy).includes(value as ConsentStrategyType);
}

