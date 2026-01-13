import { Platform } from "../types/enums";

export const V1_SUPPORTED_PLATFORMS = [Platform.GOOGLE, Platform.META, Platform.TIKTOK] as const;

export type V1SupportedPlatform = typeof V1_SUPPORTED_PLATFORMS[number];

export function isV1SupportedPlatform(platform: string): platform is V1SupportedPlatform {
  return V1_SUPPORTED_PLATFORMS.includes(platform as V1SupportedPlatform);
}

export function filterV1Platforms<T extends { platform: string }>(items: T[]): T[] {
  return items.filter(item => isV1SupportedPlatform(item.platform));
}

export function getV1Platforms(): readonly V1SupportedPlatform[] {
  return V1_SUPPORTED_PLATFORMS;
}
