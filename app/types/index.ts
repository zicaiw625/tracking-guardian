/**
 * Centralized Type Definitions
 * 
 * This module re-exports all type definitions from domain-specific modules.
 * Import types from here for convenience, or directly from specific modules
 * for better tree-shaking.
 */

// =============================================================================
// Platform Types
// =============================================================================

export type {
  Platform,
  GoogleCredentials,
  MetaCredentials,
  TikTokCredentials,
  // P0-4: BingCredentials and ClarityCredentials removed (no CAPI support)
  PlatformCredentials,
  LineItem,
  ConversionData,
  ConversionStatus,
  ConversionLogData,
  ConversionApiResponse,
  PlatformErrorType,
  PlatformError,
  PlatformResult,
  PixelConfigData,
  MigrationConfig,
  MigrationResult,
} from "./platform";

export { PLATFORM_NAMES } from "./platform";

// =============================================================================
// Consent Types
// =============================================================================

export type {
  ConsentCategory,
  ConsentStrategy,
  ConsentState,
  ConsentDecision,
  PlatformConsentConfig,
  GDPRJobType,
  GDPRJobStatus,
  GDPRJobData,
  TrustLevel,
  TrustResult,
  TrustVerificationOptions,
} from "./consent";

// =============================================================================
// Webhook Types
// =============================================================================

export type {
  OrderWebhookPayload,
  MinimalOrderPayload,
  ApiResponse,
  SurveyResponseData,
  ShopData,
  RiskSeverity,
  RiskItem,
  ScanResult,
  ScriptTag,
  CheckoutConfig,
  AlertChannel,
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
  AlertSettings,
  AlertConfig,
  AlertData,
  ReconciliationResult,
  ReconciliationSummary,
  ReconciliationReportData,
} from "./webhook";

export { toMinimalOrderPayload } from "./webhook";
