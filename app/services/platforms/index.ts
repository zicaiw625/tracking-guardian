/**
 * Platform Services Index
 *
 * Unified exports for platform CAPI services.
 * Import from this module for clean, organized imports.
 */

// =============================================================================
// Service Exports
// =============================================================================

// Factory and service registry
export {
  // Factory functions
  getPlatformService,
  isPlatformSupported,
  getSupportedPlatforms,
  getAllPlatformServices,
  // Convenience functions
  sendConversionToPlatform,
  sendConversionToMultiplePlatforms,
  validatePlatformCredentials,
  // Service classes
  GooglePlatformService,
  MetaPlatformService,
  TikTokPlatformService,
  // Singleton instances
  googleService,
  metaService,
  tiktokService,
  // Legacy compatibility (deprecated but still in use)
  sendConversionToGoogle,
  sendConversionToMeta,
  extractMetaError,
  sendConversionToTikTok,
  // Error utilities
  classifyHttpError,
  classifyJsError,
  parseMetaError,
  parseGoogleError,
  parseTikTokError,
  // Retry helpers
  calculateBackoff,
  shouldRetry,
  formatErrorForLog,
  // PII hashing
  buildMetaHashedUserData,
  buildTikTokHashedUserData,
  // Batch operations
  sendToMultiplePlatforms,
  // Types
  type MetaUserData,
  type TikTokUserData,
  type PiiQuality,
  type BatchSendResult,
  type PlatformServiceOptions,
} from "./factory";

// =============================================================================
// Interface Exports
// =============================================================================

export {
  type IPlatformService,
  type PlatformSendResult,
  type CredentialsValidationResult,
  fetchWithTimeout,
  generateDedupeEventId,
  measureDuration,
  DEFAULT_API_TIMEOUT_MS,
} from "./interface";

// =============================================================================
// Base Class Export
// =============================================================================

export { BasePlatformService } from "./base-platform.service";

