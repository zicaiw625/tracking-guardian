

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

  sendToMultiplePlatforms,

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

