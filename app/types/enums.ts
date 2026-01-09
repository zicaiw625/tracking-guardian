export const JobStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  LIMIT_EXCEEDED: 'limit_exceeded',
  DEAD_LETTER: 'dead_letter',
} as const;

export type JobStatusType = typeof JobStatus[keyof typeof JobStatus];

export const ConversionLogStatus = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  RETRYING: 'retrying',
  DEAD_LETTER: 'dead_letter',
} as const;

export type ConversionLogStatusType = typeof ConversionLogStatus[keyof typeof ConversionLogStatus];

export const WebhookStatus = {
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const;

export type WebhookStatusType = typeof WebhookStatus[keyof typeof WebhookStatus];

export const GDPRJobStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type GDPRJobStatusType = typeof GDPRJobStatus[keyof typeof GDPRJobStatus];

export const ScanStatus = {
  PENDING: 'pending',
  SCANNING: 'scanning',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ScanStatusType = typeof ScanStatus[keyof typeof ScanStatus];

export const MigrationStatus = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

export type MigrationStatusType = typeof MigrationStatus[keyof typeof MigrationStatus];

export const TrustLevel = {
  TRUSTED: 'trusted',
  PARTIAL: 'partial',
  UNTRUSTED: 'untrusted',
  UNKNOWN: 'unknown',
} as const;

export type TrustLevelType = typeof TrustLevel[keyof typeof TrustLevel];

export const SignatureStatus = {
  SIGNED: 'signed',
  UNSIGNED: 'unsigned',
  INVALID: 'invalid',
  KEY_MATCHED: 'key_matched',
} as const;

export type SignatureStatusType = typeof SignatureStatus[keyof typeof SignatureStatus];

export const ConsentStrategy = {
  STRICT: 'strict',
  BALANCED: 'balanced',
  WEAK: 'weak',
} as const;

export type ConsentStrategyType = typeof ConsentStrategy[keyof typeof ConsentStrategy];

export const Platform = {
  GOOGLE: 'google',
  META: 'meta',
  TIKTOK: 'tiktok',
  PINTEREST: 'pinterest',
  SNAPCHAT: 'snapchat',
  TWITTER: 'twitter',
} as const;

export type PlatformType = typeof Platform[keyof typeof Platform];

export const PLATFORM_DISPLAY_NAMES: Record<PlatformType, string> = {
  [Platform.GOOGLE]: 'Google Analytics 4 (GA4)',
  [Platform.META]: 'Meta (Facebook)',
  [Platform.TIKTOK]: 'TikTok',
  [Platform.PINTEREST]: 'Pinterest',
  [Platform.SNAPCHAT]: 'Snapchat',
  [Platform.TWITTER]: 'Twitter/X',
};

export const EventType = {
  PURCHASE: 'purchase',
  CHECKOUT_COMPLETED: 'checkout_completed',
  ADD_TO_CART: 'add_to_cart',
  PAGE_VIEW: 'page_viewed',
} as const;

export type EventTypeValue = typeof EventType[keyof typeof EventType];

export const ShopTier = {
  PLUS: 'plus',
  NON_PLUS: 'non_plus',
  UNKNOWN: 'unknown',
} as const;

export type ShopTierType = typeof ShopTier[keyof typeof ShopTier];

export const PlanId = {
  FREE: 'free',
  STARTER: 'starter',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;

export type PlanIdType = typeof PlanId[keyof typeof PlanId];

export const AlertChannel = {
  EMAIL: 'email',
  SLACK: 'slack',
  TELEGRAM: 'telegram',
} as const;

export type AlertChannelType = typeof AlertChannel[keyof typeof AlertChannel];

export const AlertFrequency = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  INSTANT: 'instant',
} as const;

export type AlertFrequencyType = typeof AlertFrequency[keyof typeof AlertFrequency];

export const ActorType = {
  USER: 'user',
  WEBHOOK: 'webhook',
  CRON: 'cron',
  API: 'api',
  SYSTEM: 'system',
} as const;

export type ActorTypeValue = typeof ActorType[keyof typeof ActorType];

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

export const PlatformResultStatus = {
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  PENDING: 'pending',
} as const;

export type PlatformResultStatusType = typeof PlatformResultStatus[keyof typeof PlatformResultStatus];

export function isValidJobStatus(value: string): value is JobStatusType {
  return Object.values(JobStatus).includes(value as JobStatusType);
}

export function isValidPlatform(value: string): value is PlatformType {
  return Object.values(Platform).includes(value as PlatformType);
}

export function isValidTrustLevel(value: string): value is TrustLevelType {
  return Object.values(TrustLevel).includes(value as TrustLevelType);
}

export function isValidConsentStrategy(value: string): value is ConsentStrategyType {
  return Object.values(ConsentStrategy).includes(value as ConsentStrategyType);
}
