

export {

  getPlatformService,
  isPlatformSupported,
  getSupportedPlatforms,
  getAllPlatformServices,

  sendConversionToPlatform,
  sendConversionToMultiplePlatforms,
  validatePlatformCredentials,

  GooglePlatformService,
  MetaPlatformService,
  TikTokPlatformService,

  googleService,
  metaService,
  tiktokService,

  sendConversionToGoogle,
  sendConversionToMeta,
  extractMetaError,
  sendConversionToTikTok,

  classifyHttpError,
  classifyJsError,
  parseMetaError,
  parseGoogleError,
  parseTikTokError,

  calculateBackoff,
  shouldRetry,
  formatErrorForLog,

  // P0-3: v1.0 版本不包含任何 PCD/PII 处理，因此移除 buildMetaHashedUserData 和 buildTikTokHashedUserData 导出

  sendToMultiplePlatforms,

  type MetaUserData,
  type TikTokUserData,
  type PiiQuality,
  type BatchSendResult,
  type PlatformServiceOptions,
} from "./factory";

export {
  type IPlatformService,
  type PlatformSendResult,
  type CredentialsValidationResult,
  fetchWithTimeout,
  generateDedupeEventId,
  measureDuration,
  DEFAULT_API_TIMEOUT_MS,
} from "./interface";

export { BasePlatformService } from "./base-platform.service";

