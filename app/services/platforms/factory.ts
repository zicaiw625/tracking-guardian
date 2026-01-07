

import { Platform, type PlatformType } from '../../types/enums';
import type { IPlatformService, PlatformSendResult } from './interface';
import { googleService, GooglePlatformService } from './google.service';
import { metaService, MetaPlatformService } from './meta.service';
import { tiktokService, TikTokPlatformService } from './tiktok.service';
import { pinterestService, PinterestPlatformService } from './pinterest.service';
import { snapchatService, SnapchatPlatformService } from './snapchat.service';
import { twitterService, TwitterPlatformService } from './twitter.service';
import type {
  ConversionData,
  PlatformCredentials,
  ConversionApiResponse,
} from '../../types';

const platformServices: Record<PlatformType, IPlatformService> = {
  [Platform.GOOGLE]: googleService,
  [Platform.META]: metaService,
  [Platform.TIKTOK]: tiktokService,
  [Platform.PINTEREST]: pinterestService,
  [Platform.SNAPCHAT]: snapchatService,
  [Platform.TWITTER]: twitterService,
};

export function getPlatformService(platform: PlatformType | string): IPlatformService {
  const service = platformServices[platform as PlatformType];

  if (!service) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return service;
}

export function isPlatformSupported(platform: string): platform is PlatformType {
  return platform in platformServices;
}

export function getSupportedPlatforms(): PlatformType[] {
  return Object.keys(platformServices) as PlatformType[];
}

export function getAllPlatformServices(): Record<PlatformType, IPlatformService> {
  return { ...platformServices };
}

export async function sendConversionToPlatform(
  platform: PlatformType | string,
  credentials: PlatformCredentials,
  data: ConversionData,
  eventId: string
): Promise<PlatformSendResult> {
  const service = getPlatformService(platform);
  return service.sendConversion(credentials, data, eventId);
}

export async function sendConversionToMultiplePlatforms(
  platforms: Array<{
    platform: PlatformType | string;
    credentials: PlatformCredentials;
  }>,
  data: ConversionData,
  eventId: string
): Promise<Record<string, PlatformSendResult>> {
  const results: Record<string, PlatformSendResult> = {};

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

export function validatePlatformCredentials(
  platform: PlatformType | string,
  credentials: unknown
): { valid: boolean; errors: string[] } {
  const service = getPlatformService(platform);
  return service.validateCredentials(credentials);
}

export {
  GooglePlatformService,
  MetaPlatformService,
  TikTokPlatformService,
  PinterestPlatformService,
  SnapchatPlatformService,
  TwitterPlatformService,
  googleService,
  metaService,
  tiktokService,
  pinterestService,
  snapchatService,
  twitterService,
};

export { sendConversionToGoogle } from './google.service';
export { sendConversionToMeta, extractMetaError } from './meta.service';
export { sendConversionToTikTok } from './tiktok.service';

export {

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
} from './base-platform.service';

