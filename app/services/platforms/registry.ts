import type {
  IPlatformService,
  IPlatformRegistry,
  IPlatformOrchestrator,
  MultiPlatformSendResult,
  Platform,
  PlatformCredentials,
  ConversionData,
  PlatformSendResult,
  PlatformError,
} from "../../domain/platform";
import { ok, err, type AsyncResult } from "../../types/result";
import { AppError, ErrorCode } from "../../utils/errors";
import { logger, createTimer } from "../../utils/logger.server";

class PlatformRegistry implements IPlatformRegistry {
  private readonly services = new Map<Platform, IPlatformService>();
  register(platform: Platform, service: IPlatformService): void {
    if (this.services.has(platform)) {
      logger.warn(`Platform ${platform} is being re-registered`);
    }
    this.services.set(platform, service);
    logger.debug(`Registered platform service: ${platform}`);
  }
  get(platform: Platform): IPlatformService | undefined {
    return this.services.get(platform);
  }
  has(platform: Platform): boolean {
    return this.services.has(platform);
  }
  getPlatforms(): Platform[] {
    const allPlatforms = Array.from(this.services.keys());
    return allPlatforms.filter((p) => 
      p === "google" || p === "meta" || p === "tiktok"
    );
  }
  getAll(): Map<Platform, IPlatformService> {
    return new Map(this.services);
  }
  unregister(platform: Platform): boolean {
    return this.services.delete(platform);
  }
  clear(): void {
    this.services.clear();
  }
}

class PlatformOrchestrator implements IPlatformOrchestrator {
  constructor(private readonly registry: IPlatformRegistry) {}
  async sendToOne(
    platform: Platform,
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): AsyncResult<PlatformSendResult, AppError> {
    const service = this.registry.get(platform);
    if (!service) {
      return err(
        new AppError(
          ErrorCode.PLATFORM_INVALID_CONFIG,
          `Platform ${platform} is not registered`,
          false,
          { platform }
        )
      );
    }
    try {
      const timer = createTimer();
      const result = await service.sendConversion(credentials, data, eventId);
      return ok({
        ...result,
        duration: timer.elapsed(),
      });
    } catch (error) {
      const platformError: PlatformError = {
        type: "unknown",
        message: error instanceof Error ? error.message : String(error),
        isRetryable: true,
      };
      return ok({
        success: false,
        error: platformError,
      });
    }
  }
  async sendToMany(
    platforms: Array<{
      platform: Platform;
      credentials: PlatformCredentials;
    }>,
    data: ConversionData,
    eventId: string
  ): AsyncResult<MultiPlatformSendResult, AppError> {
    const overallTimer = createTimer();
    const results: Record<Platform, PlatformSendResult> = {} as Record<Platform, PlatformSendResult>;
    const promises = platforms.map(async ({ platform, credentials }) => {
      const result = await this.sendToOne(platform, credentials, data, eventId);
      if (result.ok) {
        results[platform] = result.value;
      } else {
        results[platform] = {
          success: false,
          error: {
            type: "unknown",
            message: result.error.message,
            isRetryable: true,
          },
        };
      }
    });
    await Promise.all(promises);
    let totalSucceeded = 0;
    let totalFailed = 0;
    for (const result of Object.values(results)) {
      if (result.success) {
        totalSucceeded++;
      } else {
        totalFailed++;
      }
    }
    return ok({
      results,
      totalSucceeded,
      totalFailed,
      duration: overallTimer.elapsed(),
    });
  }
}

export const platformRegistry = new PlatformRegistry();

export const platformOrchestrator = new PlatformOrchestrator(platformRegistry);

export function initializePlatformRegistry(
  services?: Partial<Record<Platform, IPlatformService>>
): void {
  const { googleService } = require("./google.service");
  const { metaService } = require("./meta.service");
  const { tiktokService } = require("./tiktok.service");
  platformRegistry.register("google", services?.google ?? googleService);
  platformRegistry.register("meta", services?.meta ?? metaService);
  platformRegistry.register("tiktok", services?.tiktok ?? tiktokService);
  logger.info("Platform registry initialized", {
    platforms: platformRegistry.getPlatforms(),
  });
}

export function getV1SupportedPlatforms(): Platform[] {
  return ["google", "meta", "tiktok"] as Platform[];
}

export function isRegistryInitialized(): boolean {
  return platformRegistry.getPlatforms().length > 0;
}

export function getPlatformService(platform: Platform): IPlatformService | undefined {
  return platformRegistry.get(platform);
}

export function requirePlatformService(platform: Platform): IPlatformService {
  const service = platformRegistry.get(platform);
  if (!service) {
    throw new Error(`Platform ${platform} is not registered`);
  }
  return service;
}

export function isPlatformSupported(platform: string): boolean {
  return platformRegistry.has(platform as Platform);
}

export function getSupportedPlatforms(): Platform[] {
  return getV1SupportedPlatforms();
}

export async function sendConversion(
  platform: Platform,
  credentials: PlatformCredentials,
  data: ConversionData,
  eventId: string
): AsyncResult<PlatformSendResult, AppError> {
  return platformOrchestrator.sendToOne(platform, credentials, data, eventId);
}

export async function sendToMultiplePlatforms(
  platforms: Array<{
    platform: Platform;
    credentials: PlatformCredentials;
  }>,
  data: ConversionData,
  eventId: string
): AsyncResult<MultiPlatformSendResult, AppError> {
  return platformOrchestrator.sendToMany(platforms, data, eventId);
}

export type {
  IPlatformService,
  IPlatformRegistry,
  IPlatformOrchestrator,
  MultiPlatformSendResult,
};

export { PlatformRegistry, PlatformOrchestrator };
