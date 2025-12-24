/**
 * Platform Service Factory
 * 
 * Factory for creating platform-specific service instances.
 * Provides a unified way to get the right service for each platform.
 */

import { Platform, type PlatformType } from '../../types/enums';
import type { IPlatformService, PlatformSendResult } from './interface';
import { googleService, GooglePlatformService } from './google.service';
import { metaService, MetaPlatformService } from './meta.service';
import { tiktokService, TikTokPlatformService } from './tiktok.service';
import type {
  ConversionData,
  PlatformCredentials,
  ConversionApiResponse,
} from '../../types';

// =============================================================================
// Service Registry
// =============================================================================

/**
 * Registry of platform services.
 * Singleton instances for each platform.
 */
const platformServices: Record<PlatformType, IPlatformService> = {
  [Platform.GOOGLE]: googleService,
  [Platform.META]: metaService,
  [Platform.TIKTOK]: tiktokService,
};

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Get the platform service for a given platform type.
 * 
 * @param platform - Platform identifier
 * @returns Platform service instance
 * @throws Error if platform is not supported
 */
export function getPlatformService(platform: PlatformType | string): IPlatformService {
  const service = platformServices[platform as PlatformType];
  
  if (!service) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  
  return service;
}

/**
 * Check if a platform is supported.
 * 
 * @param platform - Platform identifier to check
 * @returns True if platform is supported
 */
export function isPlatformSupported(platform: string): platform is PlatformType {
  return platform in platformServices;
}

/**
 * Get all supported platforms.
 * 
 * @returns Array of supported platform identifiers
 */
export function getSupportedPlatforms(): PlatformType[] {
  return Object.keys(platformServices) as PlatformType[];
}

/**
 * Get all platform services.
 * 
 * @returns Map of platform to service
 */
export function getAllPlatformServices(): Record<PlatformType, IPlatformService> {
  return { ...platformServices };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Send conversion to a specific platform.
 * 
 * This is a convenience function that wraps the factory pattern.
 * 
 * @param platform - Target platform
 * @param credentials - Platform credentials
 * @param data - Conversion data
 * @param eventId - Deduplication event ID
 * @returns Promise resolving to send result
 */
export async function sendConversionToPlatform(
  platform: PlatformType | string,
  credentials: PlatformCredentials,
  data: ConversionData,
  eventId: string
): Promise<PlatformSendResult> {
  const service = getPlatformService(platform);
  return service.sendConversion(credentials, data, eventId);
}

/**
 * Send conversion to multiple platforms.
 * 
 * @param platforms - Array of platform configurations
 * @param data - Conversion data
 * @param eventId - Deduplication event ID
 * @returns Promise resolving to results for each platform
 */
export async function sendConversionToMultiplePlatforms(
  platforms: Array<{
    platform: PlatformType | string;
    credentials: PlatformCredentials;
  }>,
  data: ConversionData,
  eventId: string
): Promise<Record<string, PlatformSendResult>> {
  const results: Record<string, PlatformSendResult> = {};
  
  // Send to all platforms in parallel
  const promises = platforms.map(async ({ platform, credentials }) => {
    try {
      const result = await sendConversionToPlatform(
        platform,
        credentials,
        data,
        eventId
      );
      results[platform] = result;
    } catch (error) {
      results[platform] = {
        success: false,
        error: {
          type: 'unknown',
          message: error instanceof Error ? error.message : String(error),
          isRetryable: true,
        },
      };
    }
  });
  
  await Promise.all(promises);
  
  return results;
}

/**
 * Validate credentials for a specific platform.
 * 
 * @param platform - Target platform
 * @param credentials - Credentials to validate
 * @returns Validation result
 */
export function validatePlatformCredentials(
  platform: PlatformType | string,
  credentials: unknown
): { valid: boolean; errors: string[] } {
  const service = getPlatformService(platform);
  return service.validateCredentials(credentials);
}

// =============================================================================
// Platform Service Classes Export
// =============================================================================

export {
  GooglePlatformService,
  MetaPlatformService,
  TikTokPlatformService,
  googleService,
  metaService,
  tiktokService,
};

// =============================================================================
// Legacy Function Re-exports (Backwards Compatibility)
// These are deprecated but still in use - prefer using service instances instead.
// =============================================================================

export { sendConversionToGoogle } from './google.service';
export { sendConversionToMeta, extractMetaError } from './meta.service';
export { sendConversionToTikTok } from './tiktok.service';

// =============================================================================
// Utility Re-exports
// =============================================================================

export {
  // Error classification
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
} from './base-platform.service';

